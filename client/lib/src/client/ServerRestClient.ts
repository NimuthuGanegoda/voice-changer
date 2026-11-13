import { DeviceSetupStatus, MergeModelRequest, OnnxExporterInfo, ServerInfo, ServerSettingKey } from "../const";

export type UploadResult = { chunkNum: number; uploadId: string; storedName: string };
type StatusMessage = { status: string; message?: string; msg?: string };

export class ServerRequestError extends Error {
    constructor(public readonly status: number, public readonly payload: unknown, message: string) {
        super(message);
        this.name = "ServerRequestError";
    }
}

const encodeBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
};
const decodeBase64 = (value: string): ArrayBuffer => Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer;

export class ServerRestClient {
    constructor(private serverUrl = "", private accessToken = "") {}

    private request = async <T>(path: string, options: RequestInit = {}, timeout = 30000): Promise<T> => {
        const headers = new Headers(options.headers);
        if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
        const response = await fetch(this.serverUrl + path, {
            ...options, headers, credentials: "include", signal: options.signal ?? AbortSignal.timeout(timeout),
        });
        let payload: unknown;
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok || (payload && typeof payload === "object" && "status" in payload && payload.status === "ERROR")) {
            const message = payload && typeof payload === "object"
                ? String((payload as StatusMessage).msg ?? (payload as StatusMessage).message ?? `HTTP ${response.status}`)
                : `HTTP ${response.status}`;
            throw new ServerRequestError(response.status, payload, `${path}: ${message}`);
        }
        if (payload === null) throw new ServerRequestError(response.status, payload, `${path}: invalid JSON response`);
        return payload as T;
    };

    private form = (values: Record<string, string | Blob>): FormData => {
        const form = new FormData();
        Object.entries(values).forEach(([key, value]) => form.append(key, value));
        return form;
    };

    getSettings = () => this.request<ServerInfo>("/info");
    getDeviceSetupStatus = () => this.request<DeviceSetupStatus>("/device_setup/status");
    getPerformance = () => this.request<number[]>("/performance");
    playSound = (filename: string) => this.request<StatusMessage>("/play_sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
    tts = (text: string, voice = "") => this.request<StatusMessage>("/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) });
    getSoundboardList = () => this.request<StatusMessage & { files?: string[] }>("/soundboard/list");
    stopSounds = () => this.request<StatusMessage>("/soundboard/stop", { method: "POST" });
    deleteSound = (filename: string) => this.request<StatusMessage>("/soundboard/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
    getTtsVoices = () => this.request<StatusMessage & { voices?: { id: string; name: string; languages: string[] }[] }>("/tts/voices");
    uploadSoundboardFile = (file: File) => this.request<StatusMessage>("/soundboard/upload", { method: "POST", body: this.form({ file, filename: file.name }) }, 120000);

    updateSettings = (key: ServerSettingKey, val: string) => this.request<ServerInfo>("/update_settings", { method: "POST", body: this.form({ key, val }) });

    private uploadChunks = async (source: Blob, filename: string, uploadId: string, onprogress: (progress: number, end: boolean) => void): Promise<number> => {
        const size = 1024 * 1024;
        const chunkNum = Math.ceil(source.size / size);
        let completed = 0;
        onprogress(0, false);
        for (let first = 0; first < chunkNum; first += 4) {
            const batch = Array.from({ length: Math.min(4, chunkNum - first) }, async (_, offset) => {
                const index = first + offset;
                const chunk = source.slice(index * size, (index + 1) * size);
                await this.request("/upload_file", { method: "POST", body: this.form({ file: chunk, filename: `${filename}_${index}`, upload_id: `${uploadId}_${index}` }) }, 120000);
                completed += 1;
                onprogress(Math.floor(completed / chunkNum * 95), false);
            });
            await Promise.all(batch);
        }
        return chunkNum;
    };

    uploadFileWithId = async (dir: string, file: File, onprogress: (progress: number, end: boolean) => void): Promise<UploadResult> => {
        if (dir.includes("\\") || dir.split("/").some(part => part === ".." || part === ".")) throw new Error("unsafe model subdirectory");
        const uploadId = crypto.randomUUID().replace(/-/g, "");
        const chunkNum = await this.uploadChunks(file, dir + file.name, uploadId, onprogress);
        const result = await this.request<{ name: string }>("/concat_uploaded_file", { method: "POST", body: this.form({ filename: dir + file.name, filenameChunkNum: String(chunkNum), upload_id: uploadId, original_filename: file.name }) }, 120000);
        onprogress(100, true);
        return { chunkNum, uploadId, storedName: result.name };
    };

    // Retain the legacy public return type for existing integrations.
    uploadFile2 = async (dir: string, file: File, onprogress: (progress: number, end: boolean) => void) => (await this.uploadFileWithId(dir, file, onprogress)).chunkNum;

    uploadFile = async (buf: ArrayBuffer, filename: string, onprogress: (progress: number, end: boolean) => void) => {
        const uploadId = crypto.randomUUID().replace(/-/g, "");
        const chunkNum = await this.uploadChunks(new Blob([buf]), filename, uploadId, onprogress);
        await this.concatUploadedFile(filename, chunkNum, uploadId, filename);
        onprogress(100, true);
        return chunkNum;
    };

    concatUploadedFile = async (filename: string, chunkNum: number, uploadId?: string, originalFilename?: string) => {
        const values: Record<string, string> = { filename, filenameChunkNum: String(chunkNum) };
        if (uploadId) values.upload_id = uploadId;
        if (originalFilename) values.original_filename = originalFilename;
        return this.request<{ name: string }>("/concat_uploaded_file", { method: "POST", body: this.form(values) }, 120000);
    };

    loadModel = (slot: number, isHalf = false, params = "{}") => this.request<ServerInfo>("/load_model", { method: "POST", body: this.form({ slot: String(slot), isHalf: String(isHalf ?? false), params }) }, 300000);
    uploadAssets = (params: string) => this.request<ServerInfo>("/upload_model_assets", { method: "POST", body: this.form({ params }) });
    getModelType = () => this.request<ServerInfo>("/model_type");
    export2onnx = () => this.request<OnnxExporterInfo>("/onnx", {}, 300000);
    mergeModel = (req: MergeModelRequest) => this.request<ServerInfo>("/merge_model", { method: "POST", body: this.form({ request: JSON.stringify(req) }) }, 300000);
    updateModelDefault = () => this.request<ServerInfo>("/update_model_default", { method: "POST" });
    updateModelInfo = (slot: number, key: string, val: string) => this.request<ServerInfo>("/update_model_info", { method: "POST", body: this.form({ newData: JSON.stringify({ slot, key, val }) }) });
    deleteModel = (slot: number) => this.request<ServerInfo>("/delete_model", { method: "POST", body: this.form({ slot: String(slot) }) });

    postVoice = async (timestamp: number, buffer: ArrayBuffer) => {
        const result = await this.request<{ changedVoiceBase64: string }>("/test", {
            method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ timestamp, buffer: encodeBase64(buffer) }),
        });
        if (typeof result.changedVoiceBase64 !== "string") throw new Error("server returned no audio");
        return decodeBase64(result.changedVoiceBase64);
    };
}
