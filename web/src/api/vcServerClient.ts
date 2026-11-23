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
