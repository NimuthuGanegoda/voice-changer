import { DSPParams, VoiceProcessor, clamp } from "./dspCore";

export const concatFloat32 = (chunks: Float32Array[]): Float32Array => {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Sample rate must be a positive finite number");
  }
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = clamp(samples[i] ?? 0, -1, 1);
    view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }

  return new Blob([buffer], { type: "audio/wav" });
};

/**
 * Downmix multi-channel AudioBuffer to mono Float32Array.
 */
export const extractMonoChannel = (audioBuffer: AudioBuffer): Float32Array => {
  const len = audioBuffer.length;
  const chCount = audioBuffer.numberOfChannels;
  if (chCount <= 1) {
    return audioBuffer.getChannelData(0).slice();
  }
  const mono = new Float32Array(len);
  for (let c = 0; c < chCount; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / chCount;
    }
  }
  return mono;
};

/**
 * Offline DSP + Formant Biquad rendering for instant WAV file conversion export.
 */
export const renderOfflineDsp = async (audioBuffer: AudioBuffer, params: DSPParams): Promise<Blob> => {
  const sr = audioBuffer.sampleRate;
  const mono = extractMonoChannel(audioBuffer);
  const processed = new Float32Array(mono.length);
  const proc = new VoiceProcessor(sr);
  const blockSize = 1024;
  for (let offset = 0; offset < mono.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, mono.length);
    proc.processBlock(mono.subarray(offset, end), processed.subarray(offset, end), params);
  }

  if (typeof OfflineAudioContext === "undefined") {
    return encodeWav(processed, sr);
  }

  const offline = new OfflineAudioContext(1, processed.length, sr);
  const srcBuf = offline.createBuffer(1, processed.length, sr);
  srcBuf.copyToChannel(processed as Float32Array<ArrayBuffer>, 0);

  const src = offline.createBufferSource();
  src.buffer = srcBuf;

  const hpf = offline.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = params.bypass ? 10 : clamp(params.highpassHz, 20, 400);

  const formantLow = offline.createBiquadFilter();
  formantLow.type = "lowshelf";
  formantLow.frequency.value = 320;
  formantLow.gain.value = params.bypass ? 0 : -params.formantShift * 1.1;

  const formantHigh = offline.createBiquadFilter();
  formantHigh.type = "peaking";
  formantHigh.frequency.value = 2600 + params.formantShift * 190;
  formantHigh.Q.value = 1.1;
  formantHigh.gain.value = params.bypass ? 0 : params.formantShift * 1.15;

  const presence = offline.createBiquadFilter();
  presence.type = "highshelf";
  presence.frequency.value = 5200;
  presence.gain.value = params.bypass ? 0 : params.presenceDb;

  const comp = offline.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3.2;

  src.connect(hpf);
  hpf.connect(formantLow);
  formantLow.connect(formantHigh);
  formantHigh.connect(presence);
  presence.connect(comp);
  comp.connect(offline.destination);

  src.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), sr);
};
