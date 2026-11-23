import { DSPParams, clamp, float32ToInt16, int16ToFloat32, resampleFloat32, VoiceProcessor } from "./dspCore";
import { concatFloat32, encodeWav } from "./wavEncoder";
import { WORKLET_PROCESSOR_NAME, createWorkletModuleUrl } from "./workletSource";

export type AudioSourceKind = "mic" | "sample" | "file";
export type EngineMode = "onnx" | "browser" | "server";

export const extractMonoFloat32 = (buf: AudioBuffer): Float32Array => {
  if (buf.numberOfChannels === 1) {
    return buf.getChannelData(0).slice();
  }
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.getChannelData(1);
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    mono[i] = ((ch0[i] ?? 0) + (ch1[i] ?? 0)) * 0.5;
  }
  return mono;
};

/** Sequential chunked conversion via VC Server /test so slow CPUs never drop frames. */
export const convertBufferViaServer = async (
  mono: Float32Array,
  sampleRate: number,
  convertFn: ServerConvertFn,
  onProgress?: (doneBlocks: number, totalBlocks: number) => void,
): Promise<Blob> => {
  const at48k = resampleFloat32(mono, sampleRate, 48000);
  const blockSize = 9600; // 200 ms @ 48 kHz per request
  const totalBlocks = Math.max(1, Math.ceil(at48k.length / blockSize));
  const outChunks: Float32Array[] = [];

  for (let idx = 0; idx < totalBlocks; idx++) {
    const start = idx * blockSize;
    const end = Math.min(at48k.length, start + blockSize);
    const chunk = at48k.subarray(start, end);
    const padded = new Float32Array(blockSize);
    padded.set(chunk);
    const pcm16 = float32ToInt16(padded);
    const { output } = await convertFn(pcm16.buffer as ArrayBuffer);
    const f32 = int16ToFloat32(new Int16Array(output));
    outChunks.push(f32.subarray(0, Math.min(f32.length, chunk.length)));
    onProgress?.(idx + 1, totalBlocks);
  }
  return encodeWav(concatFloat32(outChunks), 48000);
};

export type TelemetrySnapshot = {
  running: boolean;
  inPeak: number;
  outPeak: number;
  sampleRate: number;
  latencyMs: number;
  serverRttMs: number | null;
  engineKind: "AudioWorklet" | "ScriptProcessor" | "AI Server Bridge" | "Idle";
};

export type ServerConvertFn = (pcm16Buffer: ArrayBuffer) => Promise<{ output: ArrayBuffer; rttMs: number }>;

const generateSynthesizedVocalSample = (sampleRate: number): AudioBuffer => {
  // 2.6 second natural-cadence vowel contour ("ah -> eh -> oo -> ah") synthesized cleanly via Web Audio math
  const seconds = 2.6;
  const len = Math.floor(sampleRate * seconds);
  const tmpCtx = new OfflineAudioContext(1, len, sampleRate);
  const buffer = tmpCtx.createBuffer(1, len, sampleRate);
  const data = buffer.getChannelData(0);

  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const phraseIdx = t < 0.75 ? 0 : t < 1.5 ? 1 : t < 2.2 ? 2 : 3;
    const localT = t % 0.75;
    const pause = localT > 0.62 ? 0 : Math.sin((localT / 0.62) * Math.PI);
    const f0 = 155 + 22 * Math.sin(t * 2.4) + 3.5 * Math.sin(t * 32) - phraseIdx * 7;
    phase += (2 * Math.PI * f0) / sampleRate;

    // Harmonic glottal pulse train filtered toward human formants
    let sample = 0;
    const formants =
      phraseIdx === 0
        ? [720, 1180, 2600]
        : phraseIdx === 1
          ? [530, 1780, 2550]
          : phraseIdx === 2
            ? [340, 880, 2350]
            : [640, 1120, 2520];
    for (let h = 1; h <= 18; h++) {
      const freq = f0 * h;
      if (freq > sampleRate * 0.42) break;
      let resonance = 0.25;
      for (const f of formants) {
        const dist = (freq - f) / 260;
        resonance += Math.exp(-dist * dist) * 0.9;
      }
      sample += (Math.sin(phase * h) / (1 + 0.14 * h)) * resonance;
    }
    data[i] = clamp(sample * 0.12 * pause, -0.85, 0.85);
  }
  return buffer;
};

export class BrowserVoiceEngine {
  private ctx: AudioContext | null = null;
  private sourceNode: AudioNode | null = null;
  private micStream: MediaStream | null = null;
  private fileSourceNode: AudioBufferSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private fallbackProc: VoiceProcessor | null = null;

  private hpfNode: BiquadFilterNode | null = null;
  private formantLowNode: BiquadFilterNode | null = null;
  private formantHighNode: BiquadFilterNode | null = null;
  private presenceNode: BiquadFilterNode | null = null;
  private compNode: DynamicsCompressorNode | null = null;
  private monitorGainNode: GainNode | null = null;

  public inputAnalyser: AnalyserNode | null = null;
  public outputAnalyser: AnalyserNode | null = null;

  private currentMode: EngineMode = "browser";
  private currentSource: AudioSourceKind = "sample";
  private params: DSPParams;
  private monitorEnabled = true;
  private monitorVolume = 1;

  private recording = false;
  private recordedChunks: Float32Array[] = [];

  private serverBridgeNode: ScriptProcessorNode | null = null;
  private serverConvertFn: ServerConvertFn | null = null;
  private serverQueue: Float32Array[] = [];
  private serverInFlight = false;
  private serverRttMs: number | null = null;
  private cachedSampleBuffer: AudioBuffer | null = null;
  private uploadedBuffer: AudioBuffer | null = null;

  private telemetry: TelemetrySnapshot = {
    running: false,
    inPeak: 0,
    outPeak: 0,
    sampleRate: 48000,
    latencyMs: 0,
    serverRttMs: null,
    engineKind: "Idle",
  };
  private onTelemetry?: (snap: TelemetrySnapshot) => void;
  private onFileEnded?: () => void;

  constructor(
    initialParams: DSPParams,
    callbacks?: { onTelemetry?: (snap: TelemetrySnapshot) => void; onFileEnded?: () => void },
  ) {
    this.params = { ...initialParams };
    this.onTelemetry = callbacks?.onTelemetry;
    this.onFileEnded = callbacks?.onFileEnded;
  }

  getUploadedBuffer(): AudioBuffer | null {
    return this.uploadedBuffer;
  }

  async decodeUploadedFile(file: File): Promise<{ buffer: AudioBuffer; duration: number }> {
    const ctx = this.ctx ?? new AudioContext();
    if (!this.ctx) {
      this.ctx = ctx;
    }
    const raw = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);
    this.uploadedBuffer = decoded;
    return { buffer: decoded, duration: decoded.duration };
  }

  setMonitor(enabled: boolean, volume = this.monitorVolume): void {
    this.monitorEnabled = enabled;
    this.monitorVolume = clamp(volume, 0, 1.5);
    if (this.monitorGainNode && this.ctx) {
      this.monitorGainNode.gain.setTargetAtTime(
        this.monitorEnabled ? this.monitorVolume : 0,
        this.ctx.currentTime,
        0.015,
      );
    }
  }

  updateParams(next: DSPParams): void {
    this.params = { ...next };
    const ctx = this.ctx;
    if (!ctx) return;

    if (this.workletNode) {
      const p = this.workletNode.parameters;
      p.get("semitones")?.setValueAtTime(next.semitones, ctx.currentTime);
      p.get("gateThresholdDb")?.setValueAtTime(next.gateThresholdDb, ctx.currentTime);
      p.get("robotMix")?.setValueAtTime(next.robotMix, ctx.currentTime);
      p.get("echoMix")?.setValueAtTime(next.echoMix, ctx.currentTime);
      p.get("wetMix")?.setValueAtTime(next.wetMix, ctx.currentTime);
      p.get("inputGain")?.setValueAtTime(next.inputGain, ctx.currentTime);
      p.get("outputGain")?.setValueAtTime(next.outputGain, ctx.currentTime);
      p.get("bypass")?.setValueAtTime(next.bypass ? 1 : 0, ctx.currentTime);
    }

    if (this.hpfNode) {
      this.hpfNode.frequency.setTargetAtTime(next.bypass ? 10 : clamp(next.highpassHz, 20, 400), ctx.currentTime, 0.02);
    }
    if (this.formantLowNode) {
      this.formantLowNode.gain.setTargetAtTime(next.bypass ? 0 : -next.formantShift * 1.1, ctx.currentTime, 0.02);
    }
    if (this.formantHighNode) {
      this.formantHighNode.frequency.setTargetAtTime(2600 + next.formantShift * 190, ctx.currentTime, 0.02);
      this.formantHighNode.gain.setTargetAtTime(next.bypass ? 0 : next.formantShift * 1.15, ctx.currentTime, 0.02);
    }
    if (this.presenceNode) {
      this.presenceNode.gain.setTargetAtTime(next.bypass ? 0 : next.presenceDb, ctx.currentTime, 0.02);
    }
  }

  startRecording(): void {
    this.recordedChunks = [];
    this.recording = true;
    this.workletNode?.port.postMessage({ type: "set-recording", recording: true });
  }

  stopRecording(): { blob: Blob; durationSec: number } | null {
    this.recording = false;
    this.workletNode?.port.postMessage({ type: "set-recording", recording: false });
    if (this.recordedChunks.length === 0 || !this.ctx) {
      return null;
    }
    const merged = concatFloat32(this.recordedChunks);
    this.recordedChunks = [];
    if (merged.length === 0) return null;
    const blob = encodeWav(merged, this.ctx.sampleRate);
    return { blob, durationSec: merged.length / this.ctx.sampleRate };
  }

  async start(opts: {
    mode: EngineMode;
    source: AudioSourceKind;
    deviceId?: string;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    serverConvert?: ServerConvertFn;
    monitorEnabled: boolean;
    monitorVolume: number;
  }): Promise<void> {
    await this.stop();

    this.currentMode = opts.mode;
    this.currentSource = opts.source;
    this.monitorEnabled = opts.monitorEnabled;
    this.monitorVolume = clamp(opts.monitorVolume, 0, 1.5);
    this.serverConvertFn = opts.serverConvert ?? null;

    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    const ctx = this.ctx;

    this.inputAnalyser = ctx.createAnalyser();
    this.inputAnalyser.fftSize = 1024;
    this.outputAnalyser = ctx.createAnalyser();
    this.outputAnalyser.fftSize = 1024;

    this.monitorGainNode = ctx.createGain();
    this.monitorGainNode.gain.value = this.monitorEnabled ? this.monitorVolume : 0;

    if (this.currentSource === "mic") {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: opts.echoCancellation ?? true,
        noiseSuppression: opts.noiseSuppression ?? false,
        autoGainControl: false,
      };
      if (opts.deviceId) {
        audioConstraints.deviceId = { exact: opts.deviceId };
      }
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      this.sourceNode = ctx.createMediaStreamSource(this.micStream);
    } else if (this.currentSource === "file") {
      if (!this.uploadedBuffer) {
        throw new Error("Please select an audio file first.");
      }
      const src = ctx.createBufferSource();
      src.buffer = this.uploadedBuffer;
      src.loop = true;
      src.onended = () => this.onFileEnded?.();
      this.fileSourceNode = src;
      this.sourceNode = src;
    } else {
      if (!this.cachedSampleBuffer || this.cachedSampleBuffer.sampleRate !== ctx.sampleRate) {
        this.cachedSampleBuffer = generateSynthesizedVocalSample(ctx.sampleRate);
      }
      const src = ctx.createBufferSource();
      src.buffer = this.cachedSampleBuffer;
      src.loop = true;
      this.fileSourceNode = src;
      this.sourceNode = src;
    }

    this.sourceNode.connect(this.inputAnalyser);

    if (this.currentMode === "server" && this.serverConvertFn) {
      await this.setupServerBridgeGraph(ctx);
    } else {
      await this.setupBrowserDspGraph(ctx);
    }

    this.fileSourceNode?.start();

    const baseLatency = ((ctx.baseLatency ?? 0.01) + (ctx.outputLatency ?? 0.01)) * 1000;
    this.telemetry = {
      ...this.telemetry,
      running: true,
      sampleRate: ctx.sampleRate,
      latencyMs: Math.round(baseLatency + (this.currentMode === "server" ? 85 : 42)),
    };
    this.emitTelemetry();
  }

  private async setupBrowserDspGraph(ctx: AudioContext): Promise<void> {
    if (!this.sourceNode || !this.outputAnalyser || !this.monitorGainNode) return;

    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = this.params.bypass ? 10 : clamp(this.params.highpassHz, 20, 400);
    this.hpfNode = hpf;

    const formantLow = ctx.createBiquadFilter();
    formantLow.type = "lowshelf";
    formantLow.frequency.value = 320;
    formantLow.gain.value = this.params.bypass ? 0 : -this.params.formantShift * 1.1;
    this.formantLowNode = formantLow;

    const formantHigh = ctx.createBiquadFilter();
    formantHigh.type = "peaking";
    formantHigh.frequency.value = 2600 + this.params.formantShift * 190;
    formantHigh.Q.value = 1.1;
    formantHigh.gain.value = this.params.bypass ? 0 : this.params.formantShift * 1.15;
    this.formantHighNode = formantHigh;

    const presence = ctx.createBiquadFilter();
    presence.type = "highshelf";
    presence.frequency.value = 5200;
    presence.gain.value = this.params.bypass ? 0 : this.params.presenceDb;
    this.presenceNode = presence;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3.2;
    this.compNode = comp;

    let processorNode: AudioNode;
    if (typeof ctx.audioWorklet !== "undefined") {
      const moduleUrl = createWorkletModuleUrl();
      try {
        await ctx.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const worklet = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      worklet.port.onmessage = (ev: MessageEvent) => {
        if (ev.data?.type === "meters") {
          this.telemetry.inPeak = ev.data.inPeak ?? 0;
          this.telemetry.outPeak = ev.data.outPeak ?? 0;
          this.emitTelemetry();
        } else if (ev.data?.type === "record-chunk" && this.recording && ev.data.samples instanceof ArrayBuffer) {
          this.recordedChunks.push(new Float32Array(ev.data.samples));
        }
      };
      worklet.port.postMessage({ type: "set-recording", recording: this.recording });
      this.workletNode = worklet;
      processorNode = worklet;
      this.telemetry.engineKind = "AudioWorklet";
      this.updateParams(this.params);
    } else {
      const block = ctx.createScriptProcessor(2048, 1, 1);
      const proc = new VoiceProcessor(ctx.sampleRate);
      this.fallbackProc = proc;
      block.onaudioprocess = (ev) => {
        const inp = ev.inputBuffer.getChannelData(0);
        const out = ev.outputBuffer.getChannelData(0);
        const { inPeak, outPeak } = proc.processBlock(inp, out, this.params);
        if (this.recording) {
          this.recordedChunks.push(out.slice());
        }
        this.telemetry.inPeak = inPeak;
        this.telemetry.outPeak = outPeak;
        this.emitTelemetry();
      };
      this.scriptNode = block;
      processorNode = block;
      this.telemetry.engineKind = "ScriptProcessor";
    }

    this.sourceNode.connect(hpf);
    hpf.connect(processorNode);
    processorNode.connect(formantLow);
    formantLow.connect(formantHigh);
    formantHigh.connect(presence);
    presence.connect(comp);
    comp.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.monitorGainNode);
    this.monitorGainNode.connect(ctx.destination);
  }

  private async setupServerBridgeGraph(ctx: AudioContext): Promise<void> {
    if (!this.sourceNode || !this.outputAnalyser || !this.monitorGainNode || !this.serverConvertFn) return;

    this.telemetry.engineKind = "AI Server Bridge";
    this.serverQueue = [];
    this.serverInFlight = false;
    this.serverRttMs = null;

    const proc = ctx.createScriptProcessor(4096, 1, 1);
    this.serverBridgeNode = proc;
    const convert = this.serverConvertFn;

    proc.onaudioprocess = (ev) => {
      const inp = ev.inputBuffer.getChannelData(0);
      const out = ev.outputBuffer.getChannelData(0);

      let inPeak = 0;
      for (let i = 0; i < inp.length; i++) {
        const a = Math.abs(inp[i] ?? 0);
        if (a > inPeak) inPeak = a;
      }

      if (this.params.bypass) {
        out.set(inp);
      } else {
        const queued = this.serverQueue.shift();
        if (queued) {
          out.set(queued.subarray(0, out.length));
          if (queued.length < out.length) out.fill(0, queued.length);
        } else {
          out.fill(0);
        }
      }

      let outPeak = 0;
      for (let i = 0; i < out.length; i++) {
        const a = Math.abs(out[i] ?? 0);
        if (a > outPeak) outPeak = a;
      }
      if (this.recording) {
        this.recordedChunks.push(out.slice());
      }
      this.telemetry.inPeak = inPeak;
      this.telemetry.outPeak = outPeak;
      this.telemetry.serverRttMs = this.serverRttMs;
      this.emitTelemetry();

      if (!this.params.bypass && !this.serverInFlight && this.serverQueue.length < 3) {
        this.serverInFlight = true;
        const scaled = new Float32Array(inp.length);
        const gain = clamp(this.params.inputGain, 0, 3);
        for (let i = 0; i < inp.length; i++) scaled[i] = (inp[i] ?? 0) * gain;
        const at48k = resampleFloat32(scaled, ctx.sampleRate, 48000);
        const pcm16 = float32ToInt16(at48k);
        void convert(pcm16.buffer as ArrayBuffer)
          .then(({ output, rttMs }) => {
            this.serverRttMs = rttMs;
            const i16 = new Int16Array(output);
            const f32 = int16ToFloat32(i16);
            const atCtxRate = resampleFloat32(f32, 48000, ctx.sampleRate);
            const outGain = clamp(this.params.outputGain, 0, 3);
            for (let i = 0; i < atCtxRate.length; i++) {
              atCtxRate[i] = clamp((atCtxRate[i] ?? 0) * outGain, -1, 1);
            }
            this.serverQueue.push(atCtxRate);
            if (this.serverQueue.length > 4) this.serverQueue.shift();
          })
          .catch(() => {
            // Transient server drop leaves buffer underrun silent cleanly
          })
          .finally(() => {
            this.serverInFlight = false;
          });
      }
    };

    this.sourceNode.connect(proc);
    proc.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.monitorGainNode);
    this.monitorGainNode.connect(ctx.destination);
  }

  async stop(): Promise<void> {
    this.fileSourceNode?.stop();
    this.fileSourceNode?.disconnect();
    this.fileSourceNode = null;

    this.sourceNode?.disconnect();
    this.sourceNode = null;

    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }

    this.workletNode?.disconnect();
    this.workletNode = null;
    this.scriptNode?.disconnect();
    this.scriptNode = null;
    this.serverBridgeNode?.disconnect();
    this.serverBridgeNode = null;
    this.fallbackProc?.reset();
    this.fallbackProc = null;

    this.hpfNode?.disconnect();
    this.hpfNode = null;
    this.formantLowNode?.disconnect();
    this.formantLowNode = null;
    this.formantHighNode?.disconnect();
    this.formantHighNode = null;
    this.presenceNode?.disconnect();
    this.presenceNode = null;
    this.compNode?.disconnect();
    this.compNode = null;
    this.inputAnalyser?.disconnect();
    this.inputAnalyser = null;
    this.outputAnalyser?.disconnect();
    this.outputAnalyser = null;
    this.monitorGainNode?.disconnect();
    this.monitorGainNode = null;

    this.telemetry = {
      ...this.telemetry,
      running: false,
      inPeak: 0,
      outPeak: 0,
      serverRttMs: null,
      engineKind: "Idle",
    };
    this.emitTelemetry();
  }

  async dispose(): Promise<void> {
    await this.stop();
    if (this.ctx && this.ctx.state !== "closed") {
      await this.ctx.close();
      this.ctx = null;
    }
  }

  private emitTelemetry(): void {
    this.onTelemetry?.({ ...this.telemetry });
  }
}
