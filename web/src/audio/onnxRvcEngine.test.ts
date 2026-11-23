import { describe, expect, it } from "vitest";
import {
  BROWSER_ONNX_MODELS,
  assertHttpsModelUrl,
  crepeProbsToHz,
  extractYinF0,
  float16BitsToFloat32,
  float32ToFloat16Bits,
  quantizeF0Mel,
  upsample2xFeatures,
} from "./onnxRvcEngine";

describe("onnxRvcEngine pitch & tensor utilities", () => {
  it("lists verified HTTPS ONNX RVC models including anime characters", () => {
    expect(BROWSER_ONNX_MODELS.length).toBeGreaterThanOrEqual(14);
    const ids = BROWSER_ONNX_MODELS.map((m) => m.id);
    for (const expectedId of [
      "ZeninMaki_RVC",
      "MisaAmane_RVC",
      "MikasaAckerman_RVC",
      "HinataHyuga_RVC",
      "Power_RVC",
      "Makima_RVC",
      "RaidenShogun_RVC",
      "YaeMiko_RVC",
      "GojoSatoru_RVC",
    ]) {
      expect(ids).toContain(expectedId);
    }
    for (const model of BROWSER_ONNX_MODELS) {
      expect(assertHttpsModelUrl(model.modelUrl)).toMatch(/^https:\/\//);
      for (const partUrl of model.modelUrls ?? []) {
        expect(assertHttpsModelUrl(partUrl)).toMatch(/^https:\/\//);
      }
    }
    expect(() => assertHttpsModelUrl("http://127.0.0.1/model.onnx")).toThrow(/HTTPS/);
    expect(() => assertHttpsModelUrl("javascript:alert(1)")).toThrow(/HTTPS/);
  });

  it("estimates F0 cleanly on a clean 220 Hz sine wave with YIN", () => {
    const sr = 16000;
    const len = 3200; // 200 ms -> 20 frames @ 100 Hz
    const audio = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      audio[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr);
    }
    const f0 = extractYinF0(audio, 20, 160, sr);
    const mid = f0.slice(5, 15);
    for (const hz of mid) {
      expect(hz).toBeGreaterThan(215);
      expect(hz).toBeLessThan(225);
    }
  });

  it("decodes CREPE probabilities and mel-quantizes transposed F0", () => {
    const probs = new Float32Array(360);
    // Peak around bin 100
    probs[99] = 0.2;
    probs[100] = 0.9;
    probs[101] = 0.2;
    const hz = crepeProbsToHz(probs, 1);
    expect(hz[0]).toBeGreaterThan(95);
    expect(hz[0]).toBeLessThan(110);

    const { pitch, pitchf } = quantizeF0Mel(new Float32Array([0, 220]), 12);
    expect(pitchf[0]).toBe(0);
    expect(pitch[0]).toBe(1n);
    expect(pitchf[1]).toBeCloseTo(440, 2);
    expect(Number(pitch[1])).toBeGreaterThan(100);
    expect(Number(pitch[1])).toBeLessThanOrEqual(255);
  });

  it("upsamples ContentVec frames 2x and round-trips float16 values", () => {
    const up = upsample2xFeatures(new Float32Array([1, 2, 3, 4]), 2, 2);
    expect(Array.from(up)).toEqual([1, 2, 1, 2, 3, 4, 3, 4]);

    const vals = [0, 0.5, -0.75, 1.25];
    for (const v of vals) {
      const bits = float32ToFloat16Bits(v);
      expect(float16BitsToFloat32(bits)).toBeCloseTo(v, 2);
    }
  });
});
