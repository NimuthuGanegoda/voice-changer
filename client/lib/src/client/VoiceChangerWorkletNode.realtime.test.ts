import { DefaultClientSetting, VOICE_CHANGER_CLIENT_EXCEPTION } from "../const";

const mockPostVoice = jest.fn();
jest.mock("./ServerRestClient", () => ({
    ServerRestClient: jest.fn().mockImplementation(() => ({ postVoice: mockPostVoice })),
}));
jest.mock("socket.io-client", () => ({ io: jest.fn() }));

class FakeAudioWorkletNode {
    port = { postMessage: jest.fn(), onmessage: null as null | ((event: { data: unknown }) => void) };
    connect = jest.fn();
    disconnect = jest.fn();
    constructor(public context: unknown, public name: string) {}
}
(global as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;

// Require after installing the AudioWorkletNode base-class stub.
const { VoiceChangerWorkletNode } = require("./VoiceChangerWorkletNode");
const { io } = require("socket.io-client");

const listener = () => ({
    notifyVolume: jest.fn(),
    notifySendBufferingTime: jest.fn(),
    notifyResponseTime: jest.fn(),
    notifyException: jest.fn(),
});

const pcm16 = (samples: number) => new ArrayBuffer(samples * 2);

describe("VoiceChangerWorkletNode realtime safeguards", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPostVoice.mockReset();
        io.mockReset();
    });

    test("output-only nodes do not open a second realtime socket", () => {
        const socket = { on: jest.fn(), close: jest.fn(), removeAllListeners: jest.fn(), volatile: { emit: jest.fn() } };
        io.mockReturnValue(socket);
        new VoiceChangerWorkletNode({} as AudioContext, listener(), false);
        expect(io).not.toHaveBeenCalled();
    });

    test("44.1 kHz audio is resampled to the 48 kHz worklet clock", () => {
        io.mockReturnValue({ on: jest.fn(), close: jest.fn(), removeAllListeners: jest.fn(), volatile: { emit: jest.fn() } });
        const node = new VoiceChangerWorkletNode({} as AudioContext, listener());
        node.updateSetting({ ...DefaultClientSetting.workletNodeSetting, sendingSampleRate: 44100 });
        node.postReceivedVoice(pcm16(441));
        const request = node.port.postMessage.mock.calls[0][0];
        expect(request.voice).toHaveLength(480);
    });

    test("malformed PCM is reported instead of throwing in the socket handler", () => {
        io.mockReturnValue({ on: jest.fn(), close: jest.fn(), removeAllListeners: jest.fn(), volatile: { emit: jest.fn() } });
        const log = listener();
        const node = new VoiceChangerWorkletNode({} as AudioContext, log);
        node.postReceivedVoice(new ArrayBuffer(3));
        expect(log.notifyException).toHaveBeenCalledWith(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_INVALID_RESPONSE, expect.stringContaining("even-length"));
    });

    test("REST requests are bounded and a failed request releases its slot", async () => {
        io.mockReturnValue({ on: jest.fn(), close: jest.fn(), removeAllListeners: jest.fn(), volatile: { emit: jest.fn() } });
        const resolvers: ((value: ArrayBuffer) => void)[] = [];
        mockPostVoice.mockImplementation(() => new Promise<ArrayBuffer>(resolve => resolvers.push(resolve)));
        const node = new VoiceChangerWorkletNode({} as AudioContext, listener());
        node.updateSetting({ ...DefaultClientSetting.workletNodeSetting, protocol: "rest", inputChunkNum: 1 });
        const input = { data: { responseType: "inputData", inputData: new Float32Array(128) } };
        node.handleMessage(input);
        node.handleMessage(input);
        node.handleMessage(input);
        expect(mockPostVoice).toHaveBeenCalledTimes(2);
        resolvers[0](pcm16(128));
        await new Promise(resolve => setTimeout(resolve, 0));
        node.handleMessage(input);
        expect(mockPostVoice).toHaveBeenCalledTimes(3);
        resolvers[1](pcm16(128));
        resolvers[2](pcm16(128));
    });

    test("Socket.IO backpressure and vc_error release pending slots", () => {
        const handlers: Record<string, (payload: unknown) => void> = {};
        const socket = {
            connected: true,
            on: jest.fn((event: string, handler: (payload: unknown) => void) => { handlers[event] = handler; }),
            close: jest.fn(), removeAllListeners: jest.fn(), volatile: { emit: jest.fn() },
        };
        io.mockReturnValue(socket);
        const node = new VoiceChangerWorkletNode({} as AudioContext, listener());
        node.updateSetting({ ...DefaultClientSetting.workletNodeSetting, protocol: "sio", inputChunkNum: 1 });
        const input = { data: { responseType: "inputData", inputData: new Float32Array(128) } };
        for (let i = 0; i < 5; i++) node.handleMessage(input);
        expect(socket.volatile.emit).toHaveBeenCalledTimes(4);
        handlers.vc_error({ msg: "conversion failed" });
        node.handleMessage(input);
        expect(socket.volatile.emit).toHaveBeenCalledTimes(5);
    });

    test("concurrent start calls share one acknowledgement and recording releases memory", async () => {
        io.mockReturnValue({ on: jest.fn(), close: jest.fn(), removeAllListeners: jest.fn(), volatile: { emit: jest.fn() } });
        const log = listener();
        const node = new VoiceChangerWorkletNode({} as AudioContext, log);
        node.updateSetting({ ...DefaultClientSetting.workletNodeSetting, protocol: "rest" });
        const first = node.start();
        const second = node.start();
        expect(node.port.postMessage).toHaveBeenCalledTimes(1);
        node.handleMessage({ data: { responseType: "start_ok" } });
        await Promise.all([first, second]);

        node.startOutputRecording();
        const max = (VoiceChangerWorkletNode as unknown as { MAX_RECORDING_SAMPLES: number }).MAX_RECORDING_SAMPLES;
        (node as unknown as { recordingSamples: number }).recordingSamples = max - 2;
        node.postReceivedVoice(pcm16(128));
        node.postReceivedVoice(pcm16(128));
        expect(log.notifyException).toHaveBeenCalledWith(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_RECORDING_LIMIT, expect.any(String));
        expect(node.stopOutputRecording()).toHaveLength(2);
        expect((node as unknown as { recordingOutputChunk: unknown[] }).recordingOutputChunk).toHaveLength(0);
    });
});
