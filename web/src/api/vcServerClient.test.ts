import { describe, expect, it, vi } from "vitest";
import { CURATED_AI_MODELS, VCServerClient, normalizeServerUrl } from "./vcServerClient";

describe("VCServerClient & URL validation", () => {
  it("normalizes valid HTTP(S) URLs and rejects unsafe schemes", () => {
    expect(normalizeServerUrl("http://127.0.0.1:18888/")).toBe("http://127.0.0.1:18888");
    expect(normalizeServerUrl("https://vc.example.com/sub/")).toBe("https://vc.example.com/sub");
    expect(() => normalizeServerUrl("")).toThrow();
    expect(() => normalizeServerUrl("javascript:alert(1)")).toThrow(/http/);
    expect(() => normalizeServerUrl("ftp://127.0.0.1")).toThrow(/http/);
  });

  it("includes curated anime RVC models and posts sample installation params to /load_model", async () => {
    const ids = CURATED_AI_MODELS.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "ZeninMaki_RVC",
        "MisaAmane_RVC",
        "MikasaAckerman_RVC",
        "HinataHyuga_RVC",
        "Power_RVC",
        "Makima_RVC",
        "RaidenShogun_RVC",
      ]),
    );

    let capturedUrl = "";
    let capturedForm: FormData | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedForm = init?.body instanceof FormData ? init.body : undefined;
      return new Response(JSON.stringify({ status: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new VCServerClient("http://127.0.0.1:18888", "tok");
      await client.installSampleModel({ slot: 2, sampleId: "ZeninMaki_RVC" });
      expect(capturedUrl).toBe("http://127.0.0.1:18888/load_model");
      expect(capturedForm).toBeInstanceOf(FormData);
      const sent = capturedForm as unknown as FormData;
      expect(sent.get("slot")).toBe("2");
      expect(sent.get("isHalf")).toBe("false");
      const parsed = JSON.parse(String(sent.get("params")));
      expect(parsed).toEqual({
        voiceChangerType: "RVC",
        slot: 2,
        isSampleMode: true,
        sampleId: "ZeninMaki_RVC",
        files: [],
        params: { useIndex: true },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uploads local RVC .zip bundles in <=1 MiB chunks before calling /load_model", async () => {
    const calls: string[] = [];
    let loadParams: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/load_model")) {
        const body = init?.body as FormData;
        loadParams = JSON.parse(String(body.get("params")));
      }
      return new Response(JSON.stringify({ status: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new VCServerClient("http://127.0.0.1:18888");
      const zipFile = new File([new Uint8Array([0x50, 0x4b, 0x05, 0x06])], "PowerENG.zip", { type: "application/zip" });
      await client.installLocalRvcFiles({ slot: 4, files: [zipFile], useIndex: true });
      expect(calls).toEqual([
        "http://127.0.0.1:18888/upload_file",
        "http://127.0.0.1:18888/concat_uploaded_file",
        "http://127.0.0.1:18888/load_model",
      ]);
      expect(loadParams).toMatchObject({
        voiceChangerType: "RVC",
        slot: 4,
        isSampleMode: false,
        params: { useIndex: true },
      });
    } finally {
      vi.unstubAllGlobals();
    }
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
