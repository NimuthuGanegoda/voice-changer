import { describe, expect, it } from "vitest";
import { concatFloat32, encodeWav } from "./wavEncoder";

describe("wavEncoder", () => {
  it("writes a valid 16-bit mono RIFF/WAVE header and clamped PCM samples", async () => {
    const merged = concatFloat32([new Float32Array([0, 0.5]), new Float32Array([-0.5, 1.2])]);
    expect(merged.length).toBe(4);

    const blob = encodeWav(merged, 48000);
    expect(blob.type).toBe("audio/wav");
    const ab = await blob.arrayBuffer();
    expect(ab.byteLength).toBe(44 + 8);

    const view = new DataView(ab);
    const tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    expect(tag).toBe("RIFF");
    expect(wave).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44 + 6, true)).toBe(32767);
  });

  it("rejects non-positive sample rates", () => {
    expect(() => encodeWav(new Float32Array([0]), 0)).toThrow(/Sample rate/);
  });
});
