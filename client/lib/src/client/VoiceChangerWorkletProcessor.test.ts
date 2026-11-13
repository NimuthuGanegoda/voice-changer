const registered: unknown[] = [];
class FakeAudioWorkletProcessor {
    port = { postMessage: jest.fn(), onmessage: null as null | ((event: { data: unknown }) => void) };
}
(global as unknown as { AudioWorkletProcessor: unknown }).AudioWorkletProcessor = FakeAudioWorkletProcessor;
(global as unknown as { registerProcessor: (name: string, ctor: unknown) => void }).registerProcessor = (_name, ctor) => registered.push(ctor);

const { VoiceChangerWorkletProcessor } = require("../../worklet/src/voice-changer-worklet-processor");

const config = (numTrancateTreshold: number) => ({
    data: { requestType: "config", numTrancateTreshold, volTrancateThreshold: 0, volTrancateLength: 0, voice: new Float32Array(0) },
});

describe("VoiceChangerWorkletProcessor", () => {
    test("config actually bounds the playback queue", () => {
        const processor = new VoiceChangerWorkletProcessor();
        processor.handleMessage(config(3));
        processor.handleMessage({ data: { requestType: "voice", voice: new Float32Array(128 * 10) } });
        expect(processor.playBuffer).toHaveLength(3);
    });

    test("partial input blocks are retained and outputs are filled", () => {
        const processor = new VoiceChangerWorkletProcessor();
        processor.handleMessage({ data: { requestType: "voice", voice: new Float32Array(100).fill(0.5) } });
        expect(processor.playBuffer).toHaveLength(0);
        processor.handleMessage({ data: { requestType: "voice", voice: new Float32Array(28).fill(0.5) } });
        expect(processor.playBuffer).toHaveLength(1);
        const output = [[new Float32Array(128), new Float32Array(128)]];
        expect(processor.process([], output, {})).toBe(true);
        expect(output[0][0][0]).toBe(0.5);
        expect(output[0][1][127]).toBe(0.5);
    });

    test("idempotent start/stop still acknowledge so client promises resolve", () => {
        const processor = new VoiceChangerWorkletProcessor();
        processor.handleMessage({ data: { requestType: "start" } });
        processor.handleMessage({ data: { requestType: "start" } });
        processor.handleMessage({ data: { requestType: "stop" } });
        processor.handleMessage({ data: { requestType: "stop" } });
        expect(processor.port.postMessage.mock.calls.map((call: [{ responseType: string }]) => call[0].responseType))
            .toEqual(["start_ok", "start_ok", "stop_ok", "stop_ok"]);
    });
});
