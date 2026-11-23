import { describe, expect, it } from "vitest";
import {
  DEFAULT_DSP_PARAMS,
  VOICE_PRESETS,
  VoiceProcessor,
  float32ToInt16,
  int16ToFloat32,
  resampleFloat32,
} from "./dspCore";
import { createWorkletModuleUrl } from "./workletSource";

const estimateFreqHz = (samples: Float32Array, sampleRate: number): number => {
  // Count positive-going zero crossings after warm-up transient
  const start = Math.floor(samples.length * 0.25);
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = start + 1; i < samples.length; i++) {
    const prev = samples[i - 1] ?? 0;
    const curr = samples[i] ?? 0;
    if (prev <= 0 && curr > 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  }
  if (crossings < 2 || last <= first) return 0;
  return ((crossings - 1) * sampleRate) / (last - first);
};

describe("VoiceProcessor DSP pitch & noise gate", () => {
  const sr = 48000;

  it("passes 0-semitone signal cleanly without distortion or NaN", () => {
    const proc = new VoiceProcessor(sr);
    const input = new Float32Array(4096);
    const output = new Float32Array(4096);
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.35 * Math.sin((2 * Math.PI * 440 * i) / sr);
    }
    const { inPeak, outPeak } = proc.processBlock(input, output, {
      ...DEFAULT_DSP_PARAMS,
      semitones: 0,
      gateThresholdDb: -80,
      bypass: false,
    });
    expect(inPeak).toBeCloseTo(0.35, 1);
    expect(outPeak).toBeCloseTo(0.35, 1);
    expect(estimateFreqHz(output, sr)).toBeCloseTo(440, 0);
    expect(output.every(Number.isFinite)).toBe(true);
  });

  it("shifts pitch upward (+12 semitones doubles frequency) and downward (-12 halves)", () => {
    const makeSine = (len: number, freq: number) => {
      const buf = new Float32Array(len);
      for (let i = 0; i < len; i++) buf[i] = 0.4 * Math.sin((2 * Math.PI * freq * i) / sr);
      return buf;
    };

    const upProc = new VoiceProcessor(sr);
    const upIn = makeSine(16384, 300);
    const upOut = new Float32Array(upIn.length);
    upProc.processBlock(upIn, upOut, { ...DEFAULT_DSP_PARAMS, semitones: 12, gateThresholdDb: -80 });
    const upFreq = estimateFreqHz(upOut, sr);
    expect(upFreq).toBeGreaterThan(560);
    expect(upFreq).toBeLessThan(640);

    const downProc = new VoiceProcessor(sr);
    const downIn = makeSine(16384, 600);
    const downOut = new Float32Array(downIn.length);
    downProc.processBlock(downIn, downOut, { ...DEFAULT_DSP_PARAMS, semitones: -12, gateThresholdDb: -80 });
    const downFreq = estimateFreqHz(downOut, sr);
    expect(downFreq).toBeGreaterThan(280);
    expect(downFreq).toBeLessThan(320);
  });

  it("attenuates quiet floor signals below the noise gate threshold", () => {
    const proc = new VoiceProcessor(sr);
    const quiet = new Float32Array(8192).fill(0.0005); // ~ -66 dBFS
    const out = new Float32Array(quiet.length);
    const res = proc.processBlock(quiet, out, {
      ...DEFAULT_DSP_PARAMS,
      semitones: 0,
      gateThresholdDb: -30,
    });
    expect(res.outPeak).toBeLessThan(0.0001);
    let tailPeak = 0;
    for (let i = 4096; i < out.length; i++) {
      tailPeak = Math.max(tailPeak, Math.abs(out[i] ?? 0));
    }
    expect(tailPeak).toBeLessThan(0.00003);
  });

  it("resamples and round-trips Int16 PCM safely", () => {
    const src = new Float32Array([0, 0.5, -0.5, 1.5, -1.5]);
    const i16 = float32ToInt16(src);
    expect(i16[3]).toBe(32767);
    expect(i16[4]).toBe(-32768);
    const f32 = int16ToFloat32(i16);
    expect(f32[1]).toBeCloseTo(0.5, 3);
    const up = resampleFloat32(new Float32Array([0, 1]), 24000, 48000);
    expect(up.length).toBe(4);
  });

  it("builds AudioWorklet module URL cleanly", () => {
    const origCreate = URL.createObjectURL;
    let seenBlob: Blob | null = null;
    URL.createObjectURL = ((obj: Blob) => {
      seenBlob = obj;
      return "blob:vc-test";
    }) as typeof URL.createObjectURL;
    try {
      expect(createWorkletModuleUrl()).toBe("blob:vc-test");
      expect(seenBlob).not.toBeNull();
    } finally {
      URL.createObjectURL = origCreate;
    }
  });

  it("exposes curated anime character DSP presets with valid finite processing", () => {
    const ids = VOICE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "zenin-maki",
        "misa-amane",
        "mikasa-ackerman",
        "hinata-hyuga",
        "power-csm",
        "makima",
        "raiden-shogun",
        "yae-miko",
        "gojo-satoru",
      ]),
    );
    const input = new Float32Array(2048);
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / sr);
    }
    for (const preset of VOICE_PRESETS) {
      const proc = new VoiceProcessor(sr);
      const output = new Float32Array(input.length);
      proc.processBlock(input, output, preset.params);
      expect(output.every(Number.isFinite)).toBe(true);
    }
  });
});
