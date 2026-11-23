export type SampleModelEntry = {
  id: string;
  voiceChangerType: string;
  lang?: string;
  tag?: string[];
  name: string;
  modelUrl?: string;
  termsOfUseUrl?: string;
  credit?: string;
  description?: string;
  sampleRate?: number;
  modelType?: string;
  f0?: boolean;
};

export const CURATED_AI_MODELS: SampleModelEntry[] = [
  {
    id: "ZeninMaki_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "jjk"],
    name: "Zenin Maki (Jujutsu Kaisen)",
    modelUrl: "https://huggingface.co/Kuma6/Maki-Zenin/resolve/main/Maki.zip",
    termsOfUseUrl: "https://huggingface.co/Kuma6/Maki-Zenin",
    credit: "Kuma6",
    description: "RVC v2 Maki Zenin (600 epochs) + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "MisaAmane_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "death-note"],
    name: "Misa Amane (Death Note)",
    modelUrl: "https://huggingface.co/Kuma6/Misa-Amane/resolve/main/Misa.zip",
    termsOfUseUrl: "https://huggingface.co/Kuma6/Misa-Amane",
    credit: "Kuma6",
    description: "RVC v2 Misa Amane (350 epochs) + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "MikasaAckerman_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "aot"],
    name: "Mikasa Ackerman (Attack on Titan)",
    modelUrl: "https://huggingface.co/Kuma6/Mikasa-Ackerman/resolve/main/Mikasa.zip",
    termsOfUseUrl: "https://huggingface.co/Kuma6/Mikasa-Ackerman",
    credit: "Kuma6",
    description: "RVC v2 Mikasa Ackerman (600 epochs) + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "HinataHyuga_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "naruto"],
    name: "Hinata Hyuga (Naruto)",
    modelUrl: "https://huggingface.co/Tsuinzues/hinatahyuga/resolve/main/hinatahyuga.zip",
    termsOfUseUrl: "https://huggingface.co/Tsuinzues/hinatahyuga",
    credit: "Tsuinzues",
    description: "RVC v2 Hinata Hyuga + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "Power_RVC",
    voiceChangerType: "RVC",
    lang: "en-US",
    tag: ["v2", "anime", "csm"],
    name: "Power (Chainsaw Man)",
    modelUrl: "https://huggingface.co/Tre2003/PowerENGLISH_CSM/resolve/main/PowerENG.zip",
    termsOfUseUrl: "https://huggingface.co/Tre2003/PowerENGLISH_CSM",
    credit: "Tre2003",
    description: "RVC v2 Power (Chainsaw Man) + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "Makima_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "csm"],
    name: "Makima (Chainsaw Man)",
    modelUrl: "https://huggingface.co/gorogorogorochan/MakimaRVC/resolve/main/MakimaVocal.zip",
    termsOfUseUrl: "https://huggingface.co/gorogorogorochan/MakimaRVC",
    credit: "gorogorogorochan",
    description: "RVC v2 Makima + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "RaidenShogun_RVC",
    voiceChangerType: "RVC",
    lang: "en-US",
    tag: ["v2", "anime", "genshin"],
    name: "Raiden Shogun (Genshin Impact)",
    modelUrl: "https://huggingface.co/Kamsaka/Raiden_Shogun/resolve/main/Raiden_Shogun.zip",
    termsOfUseUrl: "https://huggingface.co/Kamsaka/Raiden_Shogun",
    credit: "Kamsaka",
    description: "RVC v2 Raiden Shogun + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "YaeMiko_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "genshin"],
    name: "Yae Miko (Genshin Impact)",
    modelUrl: "https://huggingface.co/liilliliiiliil/yaemiko-RVC_V2_500Epoch/resolve/main/yaemiko-RVC_V2_500epoch.zip",
    termsOfUseUrl: "https://huggingface.co/liilliliiiliil/yaemiko-RVC_V2_500Epoch",
    credit: "liilliliiiliil",
    description: "RVC v2 Yae Miko (500 epochs) + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
  {
    id: "GojoSatoru_RVC",
    voiceChangerType: "RVC",
    lang: "ja-JP",
    tag: ["v2", "anime", "jjk"],
    name: "Gojo Satoru (Jujutsu Kaisen)",
    modelUrl: "https://huggingface.co/mikasa3939/gojorvc/resolve/main/gojorvc.zip",
    termsOfUseUrl: "https://huggingface.co/mikasa3939/gojorvc",
    credit: "mikasa3939",
    description: "RVC v2 Gojo Satoru + FAISS index",
    sampleRate: 40000,
    modelType: "rvc_v2",
    f0: true,
  },
];

export type ServerModelSlot = {
  slotIndex: number | string;
  voiceChangerType?: string | null;
  name?: string;
  modelFile?: string;
  f0?: boolean;
  defaultTune?: number;
};

export type ServerHealth = {
  status?: string;
  modelLoaded?: boolean;
  serverAudioStarted?: boolean;
  uptimeSeconds?: number;
};

export type ServerInfo = {
  status?: string;
  modelSlotIndex?: number | string;
  modelSlots?: ServerModelSlot[];
  sampleModels?: SampleModelEntry[];
  tran?: number;
  indexRatio?: number;
  protect?: number;
  f0Detector?: string;
  silentThreshold?: number;
  silenceFront?: number;
  inputSampleRate?: number;
  outputSampleRate?: number;
};

export type SoundboardStatus = {
  active?: boolean;
  queuedCount?: number;
  remainingSeconds?: number;
  volume?: number;
  bypass?: boolean;
};

export type VoicePresetMap = Record<string, Record<string, unknown>>;

export const normalizeServerUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Server URL cannot be empty.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid Server URL. Example: http://127.0.0.1:18888");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must start with http:// or https://");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
};

export const encodeBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
};

export const decodeBase64 = (value: string): ArrayBuffer => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;

export class VCServerClient {
  public readonly baseUrl: string;
  private reqCounter = 1;

  constructor(rawUrl: string, private readonly accessToken = "") {
    this.baseUrl = normalizeServerUrl(rawUrl);
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.accessToken) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok || (payload && typeof payload === "object" && "status" in payload && payload.status === "ERROR")) {
      const msg =
        payload && typeof payload === "object" && ("msg" in payload || "message" in payload)
          ? String((payload as { msg?: string; message?: string }).msg ?? (payload as { message?: string }).message)
          : `HTTP ${res.status}`;
      throw new Error(`${path}: ${msg}`);
    }
    if (payload === null) {
      throw new Error(`${path}: invalid JSON response`);
    }
    return payload as T;
  }

  getHealth(): Promise<ServerHealth> {
    return this.request<ServerHealth>("/api/health");
  }

  getInfo(): Promise<ServerInfo> {
    return this.request<ServerInfo>("/info");
  }

  updateSetting(key: string, val: string | number | boolean): Promise<ServerInfo> {
    const body = new FormData();
    body.append("key", key);
    body.append("val", String(val));
    return this.request<ServerInfo>("/update_settings", { method: "POST", body });
  }

  installSampleModel(opts: {
    slot: number;
    sampleId: string;
    voiceChangerType?: string;
    useIndex?: boolean;
    isHalf?: boolean;
  }): Promise<unknown> {
    const voiceChangerType = opts.voiceChangerType || "RVC";
    const body = new FormData();
    body.append("slot", String(opts.slot));
    body.append("isHalf", String(opts.isHalf ?? false));
    body.append(
      "params",
      JSON.stringify({
        voiceChangerType,
        slot: opts.slot,
        isSampleMode: true,
        sampleId: opts.sampleId,
        files: [],
        params: voiceChangerType === "RVC" ? { useIndex: opts.useIndex ?? true } : {},
      }),
    );
    return this.request<unknown>("/load_model", { method: "POST", body }, 300000);
  }

  getPresets(): Promise<{ presets?: VoicePresetMap }> {
    return this.request<{ presets?: VoicePresetMap }>("/presets");
  }

  applyPreset(name: string): Promise<ServerInfo> {
    return this.request<ServerInfo>("/presets/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  getSoundboardList(): Promise<{ files?: string[] }> {
    return this.request<{ files?: string[] }>("/soundboard/list");
  }

  getSoundboardStatus(): Promise<SoundboardStatus> {
    return this.request<SoundboardStatus>("/soundboard/status");
  }

  playSound(filename: string): Promise<{ status: string }> {
    return this.request<{ status: string }>("/play_sound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
  }

  stopSounds(): Promise<{ status: string }> {
    return this.request<{ status: string }>("/soundboard/stop", { method: "POST" });
  }

  async uploadChunkedFile(
    file: File,
    onProgress?: (uploadedChunks: number, totalChunks: number) => void,
  ): Promise<string> {
    const chunkSize = 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const randomPart =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const uploadId = `web_${randomPart}`.slice(0, 48);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
      const body = new FormData();
      body.append("file", chunk, file.name);
      body.append("filename", `${uploadId}_${i}`);
      body.append("upload_id", `${uploadId}_${i}`);
      await this.request<{ status?: string }>("/upload_file", { method: "POST", body }, 60000);
      onProgress?.(i + 1, totalChunks);
    }

    const concatBody = new FormData();
    concatBody.append("filename", uploadId);
    concatBody.append("filenameChunkNum", String(totalChunks));
    concatBody.append("original_filename", file.name);
    concatBody.append("upload_id", uploadId);
    await this.request<{ status?: string }>("/concat_uploaded_file", { method: "POST", body: concatBody }, 60000);

    const extMatch = file.name.match(/(\.[a-zA-Z0-9]{1,15})$/);
    return `${uploadId}${extMatch ? extMatch[1] : ""}`;
  }

  async installLocalRvcFiles(opts: {
    slot: number;
    files: File[];
    useIndex?: boolean;
    isHalf?: boolean;
    onProgress?: (label: string) => void;
  }): Promise<unknown> {
    if (opts.files.length === 0) {
      throw new Error("Select an RVC .zip bundle or .pth/.onnx (+ optional .index) files.");
    }
    const entries: Array<{ name: string; kind: "rvcModel" | "rvcIndex"; dir: string; uploadName: string }> = [];
    for (const file of opts.files) {
      const lower = file.name.toLowerCase();
      let kind: "rvcModel" | "rvcIndex";
      if (lower.endsWith(".index") || lower.endsWith(".index.bin")) {
        kind = "rvcIndex";
      } else if (lower.endsWith(".zip") || lower.endsWith(".pth") || lower.endsWith(".onnx")) {
        kind = "rvcModel";
      } else {
        throw new Error(`Unsupported model file type: ${file.name} (expected .zip, .pth, .onnx, or .index)`);
      }
      const uploadName = await this.uploadChunkedFile(file, (done, total) => {
        opts.onProgress?.(`Uploading ${file.name} (${done}/${total} MiB)...`);
      });
      entries.push({ name: file.name, kind, dir: "", uploadName });
    }

    const body = new FormData();
    body.append("slot", String(opts.slot));
    body.append("isHalf", String(opts.isHalf ?? false));
    body.append(
      "params",
      JSON.stringify({
        voiceChangerType: "RVC",
        slot: opts.slot,
        isSampleMode: false,
        files: entries,
        params: { useIndex: opts.useIndex ?? true },
      }),
    );
    opts.onProgress?.(`Loading slot #${opts.slot}...`);
    return this.request<unknown>("/load_model", { method: "POST", body }, 300000);
  }

  async convertVoicePcm16(pcm16Buffer: ArrayBuffer): Promise<{ output: ArrayBuffer; rttMs: number }> {
    const start = performance.now();
    const res = await this.request<{ changedVoiceBase64?: string }>("/test", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: this.reqCounter++,
        buffer: encodeBase64(pcm16Buffer),
      }),
    });
    if (typeof res.changedVoiceBase64 !== "string") {
      throw new Error("/test: server returned no converted audio");
    }
    return {
      output: decodeBase64(res.changedVoiceBase64),
      rttMs: Math.max(0, Math.round(performance.now() - start)),
    };
  }
}
