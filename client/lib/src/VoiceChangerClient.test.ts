jest.mock("./client/VoiceChangerWorkletNode", () => ({
    VoiceChangerWorkletNode: jest.fn().mockImplementation(() => ({
        stop: jest.fn().mockResolvedValue(undefined),
        start: jest.fn().mockResolvedValue(undefined),
        updateSetting: jest.fn(),
        getSettings: jest.fn(() => ({ serverUrl: "", protocol: "sio", sendingSampleRate: 48000, inputChunkNum: 192, downSamplingMode: "average" })),
        configure: jest.fn(),
        setOutputNode: jest.fn(),
        connect: jest.fn(),
        postReceivedVoice: jest.fn(),
    })),
}));

import { VoiceChangerClient } from "./VoiceChangerClient";
import { VoiceChangerWorkletNode } from "./client/VoiceChangerWorkletNode";
import { ServerRestClient } from "./client/ServerRestClient";
import { DefaultClientSetting } from "./const";

const makeContext = () => ({
    audioWorklet: { addModule: jest.fn().mockResolvedValue(undefined) },
    createMediaStreamDestination: jest.fn(() => ({ stream: { getTracks: () => [] } })),
    createGain: jest.fn(() => ({ gain: { value: 1 }, connect: jest.fn() })),
    createMediaStreamSource: jest.fn(() => ({ connect: jest.fn(), disconnect: jest.fn() })),
    close: jest.fn().mockResolvedValue(undefined),
});

describe("VoiceChangerClient setup and gains", () => {
    let getUserMedia: jest.Mock;
    beforeEach(() => {
        jest.clearAllMocks();
        (global as unknown as { AudioContext: unknown }).AudioContext = jest.fn().mockImplementation(makeContext);
        URL.createObjectURL = jest.fn(() => "blob:worklet");
        URL.revokeObjectURL = jest.fn();
        getUserMedia = jest.fn();
        Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    });

    test("zero is a valid mute gain and the output worklet has no socket", async () => {
        const client = new VoiceChangerClient(makeContext() as unknown as AudioContext, {
            notifyVolume: jest.fn(), notifySendBufferingTime: jest.fn(), notifyResponseTime: jest.fn(), notifyException: jest.fn(),
        });
        await client.isInitialized();
        client.setInputGain(0);
        client.setOutputGain(0);
        client.setMonitorGain(0);
        expect((client as unknown as { outputGainNode: { gain: { value: number } } }).outputGainNode.gain.value).toBe(0);
        expect((VoiceChangerWorkletNode as unknown as jest.Mock).mock.calls[1][2]).toBe(false);
        expect(() => client.setInputGain(-0.1)).toThrow();
        expect(() => client.setOutputGain(11)).toThrow();
    });

    test("a denied microphone does not leak the setup lock", async () => {
        const client = new VoiceChangerClient(makeContext() as unknown as AudioContext, {
            notifyVolume: jest.fn(), notifySendBufferingTime: jest.fn(), notifyResponseTime: jest.fn(), notifyException: jest.fn(),
        });
        await client.isInitialized();
        getUserMedia.mockRejectedValueOnce(new Error("denied"));
        await expect(client.updateClientSetting({ ...DefaultClientSetting.voiceChangerClientSetting, audioInput: "mic", inputGain: 0 })).rejects.toThrow("denied");
        const track = { stop: jest.fn() };
        getUserMedia.mockResolvedValue({ getTracks: () => [track] });
        await expect(client.setup()).resolves.toBeUndefined();
        expect((client as unknown as { inputGainNode: { gain: { value: number } } }).inputGainNode.gain.value).toBe(0);
    });
});

describe("ServerRestClient presets, TTS rate, and soundboard status", () => {
    const originalFetch = global.fetch;
    const originalHeaders = (global as unknown as { Headers?: unknown }).Headers;
    const originalAbortSignal = (global as unknown as { AbortSignal?: unknown }).AbortSignal;

    beforeEach(() => {
        if (typeof (global as unknown as { Headers?: unknown }).Headers === "undefined") {
            class SimpleHeaders {
                private map = new Map<string, string>();
                constructor(init?: Record<string, string>) {
                    if (init && typeof init === "object") {
                        Object.entries(init).forEach(([k, v]) => this.map.set(k.toLowerCase(), String(v)));
                    }
                }
                set(k: string, v: string) { this.map.set(k.toLowerCase(), v); }
                get(k: string) { return this.map.get(k.toLowerCase()) ?? null; }
            }
            (global as unknown as { Headers: unknown }).Headers = SimpleHeaders;
        }
        const abortSignal = (global as unknown as { AbortSignal?: { timeout?: unknown } }).AbortSignal;
        if (!abortSignal || typeof abortSignal.timeout !== "function") {
            (global as unknown as { AbortSignal: { timeout: () => unknown } }).AbortSignal = { timeout: () => undefined };
        }
    });

    afterEach(() => {
        global.fetch = originalFetch;
        (global as unknown as { Headers?: unknown }).Headers = originalHeaders;
        (global as unknown as { AbortSignal?: unknown }).AbortSignal = originalAbortSignal;
    });

    test("forwards TTS rate, soundboard status, and preset CRUD routes with auth header", async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(input), init: init ?? {} });
            return {
                ok: true,
                status: 200,
                json: async () => ({ status: "OK", presets: { Studio: { tran: 2 } }, active: false, queuedCount: 0, remainingSeconds: 0, volume: 0.8, bypass: true }),
            } as unknown as Response;
        }) as unknown as typeof fetch;

        const rest = new ServerRestClient("http://127.0.0.1:18888", "secret-token-123456");
        await rest.tts("hello world", "voice-1", 225);
        await rest.getSoundboardStatus();
        await rest.getPresets();
        await rest.savePreset("Studio", { tran: 2 });
        await rest.applyPreset("Studio");
        await rest.deletePreset("Studio");

        expect(calls.map((c) => c.url)).toEqual([
            "http://127.0.0.1:18888/tts",
            "http://127.0.0.1:18888/soundboard/status",
            "http://127.0.0.1:18888/presets",
            "http://127.0.0.1:18888/presets/save",
            "http://127.0.0.1:18888/presets/apply",
            "http://127.0.0.1:18888/presets/delete",
        ]);
        expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "hello world", voice: "voice-1", rate: 225 });
        expect((calls[0].init.headers as Headers).get("Authorization")).toBe("Bearer secret-token-123456");
    });
});
