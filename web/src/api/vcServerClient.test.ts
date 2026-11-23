import { describe, expect, it, vi } from "vitest";
import { VCServerClient, normalizeServerUrl } from "./vcServerClient";

describe("VCServerClient & URL validation", () => {
  it("normalizes valid HTTP(S) URLs and rejects unsafe schemes", () => {
    expect(normalizeServerUrl("http://127.0.0.1:18888/")).toBe("http://127.0.0.1:18888");
    expect(normalizeServerUrl("https://vc.example.com/sub/")).toBe("https://vc.example.com/sub");
    expect(() => normalizeServerUrl("")).toThrow();
    expect(() => normalizeServerUrl("javascript:alert(1)")).toThrow(/http/);
    expect(() => normalizeServerUrl("ftp://127.0.0.1")).toThrow(/http/);
  });

  it("sends bearer token header and converts PCM16 payload via /test", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer secret-123");
      const bytes = new Uint8Array(new Int16Array([42, -99]).buffer);
      const b64 = btoa(String.fromCharCode(...bytes));
      return new Response(JSON.stringify({ changedVoiceBase64: b64 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new VCServerClient("http://127.0.0.1:18888/", "secret-123");
      const out = await client.convertVoicePcm16(new Int16Array([10, -20]).buffer as ArrayBuffer);
      const decoded = new Int16Array(out.output);
      expect(Array.from(decoded)).toEqual([42, -99]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
