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
