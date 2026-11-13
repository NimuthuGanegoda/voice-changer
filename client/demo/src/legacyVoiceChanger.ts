// The published @dannadori/voice-changer-js package is a "not implemented" stub.
// Keep the unsupported browser-only edition explicit instead of importing missing
// exports. The maintained full edition uses the Python server and client/lib.
export type VoiceChangerType = "rvcv1" | "rvcv2";
export type InputLengthKey = "24000" | "16000" | "12000" | "8000";
export type VoiceChangerJSClientConfig = {
    voiceChangerType: VoiceChangerType;
    inputLength: InputLengthKey;
    baseUrl: string;
    inputSamplingRate: number;
    outputSamplingRate: number;
};
export const ProgressUpdateType = { loadPreprocessModel: "loadPreprocessModel", loadVCModel: "loadVCModel", checkResponseTime: "checkResponseTime" } as const;
export type ProgreeeUpdateCallbcckInfo = { progressUpdateType: string; progress: number };
export type ResponseTimeInfo = { responseTime: number; realDuration: number; rtf: number };
export class VoiceChangerJSClient {
    constructor() { throw new Error("The browser-only web edition is unsupported. Run the Python server and use the full edition."); }
    async initialize(..._args: unknown[]): Promise<void> { throw new Error("unsupported web edition"); }
    async checkResponseTime(): Promise<ResponseTimeInfo> { throw new Error("unsupported web edition"); }
    async convert(_audio: Float32Array): Promise<[Float32Array, ResponseTimeInfo]> { throw new Error("unsupported web edition"); }
    setUpkey(_key: number): void {}
}
// The stub package never created a database, so there is nothing to remove.
export async function removeDB(): Promise<void> {}
