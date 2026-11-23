export const WORKLET_PROCESSOR_NAME = "vc-dsp-processor";

export const createWorkletModuleUrl = (): string => {
  const source = `
class VoiceChangerDspWorklet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "semitones", defaultValue: 3.5, minValue: -12, maxValue: 12, automationRate: "k-rate" },
      { name: "gateThresholdDb", defaultValue: -54, minValue: -80, maxValue: -10, automationRate: "k-rate" },
      { name: "robotMix", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "echoMix", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "wetMix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "inputGain", defaultValue: 1, minValue: 0, maxValue: 3, automationRate: "k-rate" },
      { name: "outputGain", defaultValue: 1, minValue: 0, maxValue: 3, automationRate: "k-rate" },
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }
    ];
  }

  constructor() {
    super();
    this.bufferSize = Math.max(4096, Math.ceil(sampleRate * 0.25));
    this.buffer = new Float32Array(this.bufferSize);
    this.echoSize = Math.max(4096, Math.ceil(sampleRate * 0.22));
    this.echoBuf = new Float32Array(this.echoSize);
    this.writeIdx = 0;
    this.echoIdx = 0;
    this.phase = 0;
    this.robotPhase = 0;
    this.gateEnv = 0.03;
    this.rmsEnv = 0;
    this.meterFrames = 0;
    this.meterInMax = 0;
    this.meterOutMax = 0;
    this.recording = false;
    this.port.onmessage = (ev) => {
      if (ev.data && ev.data.type === "set-recording") {
        this.recording = !!ev.data.recording;
      } else if (ev.data && ev.data.type === "reset") {
        this.buffer.fill(0);
        this.echoBuf.fill(0);
        this.phase = 0;
      }
    };
  }

  readFrac(delaySamples) {
    let pos = this.writeIdx - delaySamples;
    while (pos < 0) pos += this.bufferSize;
    while (pos >= this.bufferSize) pos -= this.bufferSize;
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % this.bufferSize;
    const frac = pos - i0;
    return this.buffer[i0] + (this.buffer[i1] - this.buffer[i0]) * frac;
  }

  process(inputs, outputs, parameters) {
    const inCh = inputs[0] && inputs[0][0];
    const outCh = outputs[0] && outputs[0][0];
    if (!outCh) return true;
    const n = outCh.length;
    if (!inCh) {
      outCh.fill(0);
      return true;
    }

    const semitones = Math.max(-12, Math.min(12, parameters.semitones[0]));
    const bypass = parameters.bypass[0] >= 0.5;
    const gateDb = parameters.gateThresholdDb[0];
    const gateThresh = gateDb <= -79 ? 0 : Math.pow(10, gateDb / 20);
    const robotMix = Math.max(0, Math.min(1, parameters.robotMix[0]));
    const echoMix = Math.max(0, Math.min(1, parameters.echoMix[0]));
    const wetMix = Math.max(0, Math.min(1, parameters.wetMix[0]));
    const inGain = Math.max(0, Math.min(3, parameters.inputGain[0]));
    const outGain = Math.max(0, Math.min(3, parameters.outputGain[0]));

    const grainSamples = Math.min(Math.floor(sampleRate * 0.042), Math.floor(this.bufferSize * 0.45));
    const pitchRatio = Math.pow(2, semitones / 12);
    const phaseStep = (1 - pitchRatio) / grainSamples;
    const robotStep = (2 * Math.PI * 115) / sampleRate;

    for (let i = 0; i < n; i++) {
      const raw = inCh[i] * inGain;
      const absRaw = raw < 0 ? -raw : raw;
      if (absRaw > this.meterInMax) this.meterInMax = absRaw;

      this.rmsEnv = this.rmsEnv * 0.992 + absRaw * 0.008;
      const gateTarget = this.rmsEnv >= gateThresh ? 1 : 0.03;
      const coeff = gateTarget > this.gateEnv ? 0.08 : 0.003;
      this.gateEnv += (gateTarget - this.gateEnv) * coeff;

      const gated = raw * this.gateEnv;
      this.buffer[this.writeIdx] = gated;

      let pitched;
      if (bypass || Math.abs(semitones) < 0.01) {
        pitched = gated;
      } else {
        const phaseA = this.phase;
        const phaseB = (phaseA + 0.5) % 1;
        const winA = Math.sin(Math.PI * phaseA);
        const wA = winA * winA;
        const wB = 1 - wA;
        const sA = this.readFrac(2 + phaseA * grainSamples);
        const sB = this.readFrac(2 + phaseB * grainSamples);
        pitched = sA * wA + sB * wB;
      }

      this.phase += phaseStep;
      if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      else if (this.phase < 0) this.phase += Math.ceil(-this.phase);

      let effected = pitched;
      if (!bypass && robotMix > 0) {
        const carrier = 0.65 * Math.sin(this.robotPhase) + 0.35 * Math.sin(this.robotPhase * 2);
        this.robotPhase += robotStep;
        if (this.robotPhase > 2 * Math.PI) this.robotPhase -= 2 * Math.PI;
        effected = effected * (1 - robotMix) + effected * carrier * 1.45 * robotMix;
      }

      const prevEcho = this.echoBuf[this.echoIdx];
      this.echoBuf[this.echoIdx] = effected + prevEcho * 0.32;
      this.echoIdx = (this.echoIdx + 1) % this.echoSize;

      if (!bypass && echoMix > 0) {
        effected += prevEcho * echoMix;
      }

      let mixed = (bypass ? raw : gated * (1 - wetMix) + effected * wetMix) * outGain;
      if (mixed > 0.92 || mixed < -0.92) {
        mixed = Math.tanh(mixed);
      }

      outCh[i] = mixed;
      const absOut = mixed < 0 ? -mixed : mixed;
      if (absOut > this.meterOutMax) this.meterOutMax = absOut;
      this.writeIdx = (this.writeIdx + 1) % this.bufferSize;
    }

    if (this.recording) {
      const copy = new Float32Array(outCh);
      this.port.postMessage({ type: "record-chunk", samples: copy.buffer }, [copy.buffer]);
    }

    this.meterFrames += n;
    if (this.meterFrames >= Math.floor(sampleRate / 30)) {
      this.port.postMessage({ type: "meters", inPeak: this.meterInMax, outPeak: this.meterOutMax });
      this.meterFrames = 0;
      this.meterInMax = 0;
      this.meterOutMax = 0;
    }
    return true;
  }
}
registerProcessor("${WORKLET_PROCESSOR_NAME}", VoiceChangerDspWorklet);
`;
  const blob = new Blob([source], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};
