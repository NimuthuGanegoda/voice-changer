export const RequestType = {
    voice: "voice",
    config: "config",
    start: "start",
    stop: "stop",
    trancateBuffer: "trancateBuffer",
} as const;
export type RequestType = (typeof RequestType)[keyof typeof RequestType];

export const ResponseType = {
    volume: "volume",
    inputData: "inputData",
    start_ok: "start_ok",
    stop_ok: "stop_ok",
} as const;
export type ResponseType = (typeof ResponseType)[keyof typeof ResponseType];

export type VoiceChangerWorkletProcessorRequest = {
    requestType: RequestType;
    voice: Float32Array;
    numTrancateTreshold: number;
    volTrancateThreshold: number;
    volTrancateLength: number;
};

export type VoiceChangerWorkletProcessorResponse = {
    responseType: ResponseType;
    volume?: number;
    recordData?: Float32Array[];
    inputData?: Float32Array;
};

export class VoiceChangerWorkletProcessor extends AudioWorkletProcessor {
    private BLOCK_SIZE = 128;
    private initialized = false;
    private volume = 0;
    // Legacy WorkletSetting keeps the volatility fields for API compatibility, but
    // silent-block skipping is intentionally disabled because it caused audio gaps.
    private maxPendingBlocks = 100;
    private isRecording = false;

    playBuffer: Float32Array[] = [];
    unpushedF32Data: Float32Array = new Float32Array(0);

    constructor() {
        super();
        this.initialized = true;
        this.port.onmessage = this.handleMessage.bind(this);
    }

    calcVol = (data: Float32Array, prevVol: number) => {
        const sum = data.reduce((prev, cur) => prev + cur * cur, 0);
        const rms = Math.sqrt(sum / data.length);
        return Math.max(rms, prevVol * 0.95);
    };

    trancateBuffer = () => {
        while (this.playBuffer.length > 2) this.playBuffer.shift();
    };

    private trimOverflow = () => {
        while (this.playBuffer.length > this.maxPendingBlocks) this.playBuffer.shift();
    };

    handleMessage(event: { data: VoiceChangerWorkletProcessorRequest }) {
        const request = event.data;
        if (!request) return;
        if (request.requestType === "config") {
            const value = Number(request.numTrancateTreshold);
            this.maxPendingBlocks = Number.isFinite(value) ? Math.max(2, Math.min(4096, Math.floor(value))) : 100;
            this.trimOverflow();
            return;
        } else if (request.requestType === "start") {
            this.isRecording = true;
            this.port.postMessage({ responseType: "start_ok" } satisfies VoiceChangerWorkletProcessorResponse);
            return;
        } else if (request.requestType === "stop") {
            this.isRecording = false;
            this.port.postMessage({ responseType: "stop_ok" } satisfies VoiceChangerWorkletProcessorResponse);
            return;
        } else if (request.requestType === "trancateBuffer") {
            this.trancateBuffer();
            return;
        }

        const f32Data = request.voice;
        if (!(f32Data instanceof Float32Array)) return;
        const concatedF32Data = new Float32Array(this.unpushedF32Data.length + f32Data.length);
        concatedF32Data.set(this.unpushedF32Data);
        concatedF32Data.set(f32Data, this.unpushedF32Data.length);
        const chunkNum = Math.floor(concatedF32Data.length / this.BLOCK_SIZE);
        for (let i = 0; i < chunkNum; i++) {
            this.playBuffer.push(concatedF32Data.slice(i * this.BLOCK_SIZE, (i + 1) * this.BLOCK_SIZE));
        }
        this.unpushedF32Data = concatedF32Data.slice(chunkNum * this.BLOCK_SIZE);
        this.trimOverflow();
    }

    pushData = (inputData: Float32Array) => {
        this.port.postMessage({ responseType: ResponseType.inputData, inputData } satisfies VoiceChangerWorkletProcessorResponse);
    };

    process(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
        if (!this.initialized || outputs.length === 0 || outputs[0].length === 0) return true;
        if (this.isRecording && inputs.length > 0 && inputs[0].length > 0) {
            this.pushData(inputs[0][0]);
        }
        const voice = this.playBuffer.shift();
        if (voice) {
            this.volume = this.calcVol(voice, this.volume);
            this.port.postMessage({ responseType: ResponseType.volume, volume: this.volume } satisfies VoiceChangerWorkletProcessorResponse);
            outputs[0][0].set(voice);
            if (outputs[0].length > 1) outputs[0][1].set(voice);
        }
        return true;
    }
}

registerProcessor("voice-changer-worklet-processor", VoiceChangerWorkletProcessor);
