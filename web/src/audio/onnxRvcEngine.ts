/**
 * Client-side neural RVC v2 ONNX inference engine via onnxruntime-web.
 *
 * Uses ContentVec (unit12 768-ch or units9 256-ch), CREPE-tiny ONNX or YIN pitch extraction,
 * and standard RVC v2 ONNX voice synthesis weights completely inside the browser.
 */
import * as ort from "onnxruntime-web/wasm";
import { clamp, resampleFloat32 } from "./dspCore";

export type OnnxVoiceModel = {
  id: string;
  name: string;
  sampleRate: number;
  credit: string;
  description: string;
  modelUrl: string;
  recommendedTune: number;
  isV1?: boolean;
};

export type PitchMethod = "yin" | "crepe";

export const CONTENTVEC_ONNX_URL =
  "https://huggingface.co/wok000/weights_gpl/resolve/main/content-vec/contentvec-f.onnx";
export const CREPE_TINY_ONNX_URL = "https://huggingface.co/wok000/weights/resolve/main/crepe/onnx/tiny.onnx";
const MODEL_CACHE_NAME = "vc-onnx-models-v1";

/** Verified CORS-enabled ONNX RVC v2 voice models downloadable directly by Chrome/Edge. */
export const BROWSER_ONNX_MODELS: OnnxVoiceModel[] = [
  {
    id: "Tsukuyomi-chan_o",
    name: "Tsukuyomi-chan (ONNX)",
    sampleRate: 40000,
    credit: "Tsukuyomi-chan Project",
    description: "Official 40 kHz RVC v2 ONNX voice (works standalone in browser)",
    modelUrl:
      "https://huggingface.co/wok000/vcclient_model/resolve/main/rvc_v2_alpha/tsukuyomi-chan/tsukuyomi_v2_40k_e100_simple.onnx",
    recommendedTune: 10,
  },
  {
    id: "KikotoKurage_o",
    name: "Kikoto Kurage (ONNX)",
    sampleRate: 40000,
    credit: "Kikoto Kurage",
    description: "Official 40 kHz RVC v2 ONNX feminine character voice",
    modelUrl:
      "https://huggingface.co/wok000/vcclient_model/resolve/main/rvc_v2_alpha/kikoto_kurage/kikoto_kurage_v2_40k_e100_simple.onnx",
    recommendedTune: 12,
  },
  {
    id: "KikotoMahiro_o",
    name: "Kikoto Mahiro (ONNX)",
    sampleRate: 40000,
    credit: "Kikoto Mahiro",
    description: "Official 40 kHz RVC v2 ONNX bright character voice",
    modelUrl:
      "https://huggingface.co/wok000/vcclient_model/resolve/main/rvc_v2_alpha/kikoto_mahiro/kikoto_mahiro_v2_40k_simple.onnx",
    recommendedTune: 10,
  },
  {
    id: "TokinaShigure_o",
    name: "Tokina Shigure (ONNX)",
    sampleRate: 40000,
    credit: "Tokina Shigure",
    description: "Official 40 kHz RVC v2 ONNX alto character voice",
    modelUrl:
      "https://huggingface.co/wok000/vcclient_model/resolve/main/rvc_v2_alpha/tokina_shigure/tokina_shigure_v2_40k_e100_simple.onnx",
    recommendedTune: 8,
  },
  {
    id: "Amitaro_o",
    name: "Amitaro (ONNX)",
    sampleRate: 40000,
    credit: "Amitaro's Voice Studio",
    description: "Official 40 kHz RVC v2 ONNX cute anime voice",
    modelUrl:
      "https://huggingface.co/wok000/vcclient_model/resolve/main/rvc_v2_alpha/amitaro/amitaro_v2_40k_e100_simple.onnx",
    recommendedTune: 12,
  },
];

let ortConfigured = false;
export const ensureOrtEnv = (): void => {
  if (ortConfigured) return;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ortConfigured = true;
};

export const assertHttpsModelUrl = (rawUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid model download URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are permitted for browser ONNX model downloads.");
  }
  return parsed.toString();
};

/** IEEE-754 float32 -> float16 bits (for CUDA-exported half-precision RVC ONNX graphs). */
export const float32ToFloat16Bits = (value: number): number => {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const x = u32[0] ?? 0;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - exp);
    return sign | ((mant + 0x1000) >>> 13);
  }
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | ((mant + 0x1000) >>> 13);
};

export const float16BitsToFloat32 = (h: number): number => {
  const sign = (h & 0x8000) !== 0 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
  if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
};

/** 3-point median filter for smoothing extracted F0 contours. */
export const medianFilter3 = (values: Float32Array): Float32Array => {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const a = values[Math.max(0, i - 1)] ?? 0;
    const b = values[i] ?? 0;
    const c = values[Math.min(values.length - 1, i + 1)] ?? 0;
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
};

/** Deterministic browser YIN F0 estimator at 16 kHz with hop=160 (100 Hz). */
export const extractYinF0 = (
  audio16k: Float32Array,
  frameCount: number,
  hopSamples = 160,
  sampleRate = 16000,
  fmin = 50,
  fmax = 1100,
): Float32Array => {
  const minTau = Math.max(2, Math.floor(sampleRate / fmax));
  const maxTau = Math.min(512, Math.floor(sampleRate / fmin));
  const winLen = maxTau * 2;
  const diff = new Float32Array(maxTau + 1);
  const cmndf = new Float32Array(maxTau + 1);
  const rawF0 = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSamples - (winLen >> 1);
    let energy = 0;
    for (let i = 0; i < winLen; i++) {
      const idx = start + i;
      const v = idx >= 0 && idx < audio16k.length ? (audio16k[idx] ?? 0) : 0;
      energy += v * v;
    }
    if (energy < 1e-6) {
      rawF0[f] = 0;
      continue;
    }

    diff.fill(0);
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let j = 0; j < maxTau; j++) {
        const idxA = start + j;
        const idxB = idxA + tau;
        const a = idxA >= 0 && idxA < audio16k.length ? (audio16k[idxA] ?? 0) : 0;
        const b = idxB >= 0 && idxB < audio16k.length ? (audio16k[idxB] ?? 0) : 0;
        const d = a - b;
        sum += d * d;
      }
      diff[tau] = sum;
    }

    cmndf[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      runningSum += diff[tau] ?? 0;
      cmndf[tau] = runningSum > 0 ? ((diff[tau] ?? 0) * tau) / runningSum : 1;
    }

    let chosenTau = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if ((cmndf[tau] ?? 1) < 0.18) {
        let best = tau;
        while (best + 1 <= maxTau && (cmndf[best + 1] ?? 1) < (cmndf[best] ?? 1)) {
          best++;
        }
        chosenTau = best;
        break;
      }
    }

    if (chosenTau < minTau) {
      rawF0[f] = 0;
      continue;
    }

    // Parabolic refinement around chosenTau
    const prev = cmndf[Math.max(minTau, chosenTau - 1)] ?? 1;
    const curr = cmndf[chosenTau] ?? 1;
    const next = cmndf[Math.min(maxTau, chosenTau + 1)] ?? 1;
    const denom = 2 * (2 * curr - next - prev);
    const refinedTau = denom !== 0 ? chosenTau + clamp((next - prev) / denom, -0.5, 0.5) : chosenTau;
    const hz = sampleRate / refinedTau;
    rawF0[f] = hz >= fmin && hz <= fmax ? hz : 0;
  }

  return medianFilter3(rawF0);
};

/** Decode CREPE-tiny ONNX 360-bin probabilities using weighted argmax around peak +/-4 bins. */
export const crepeProbsToHz = (probs: Float32Array, frameCount: number, periodicityThresh = 0.1): Float32Array => {
  const bins = 360;
  const f0 = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const base = f * bins;
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let b = 0; b < bins; b++) {
      const p = probs[base + b] ?? 0;
      if (p > maxVal) {
        maxVal = p;
        maxIdx = b;
      }
    }
    if (maxVal < periodicityThresh) {
      f0[f] = 0;
      continue;
    }
    const lo = Math.max(0, maxIdx - 4);
    const hi = Math.min(bins - 1, maxIdx + 4);
    let weightedCents = 0;
    let weightSum = 0;
    for (let b = lo; b <= hi; b++) {
      const w = Math.max(0, probs[base + b] ?? 0);
      const cents = 20 * b + 1997.3794084376191;
      weightedCents += w * cents;
      weightSum += w;
    }
    if (weightSum <= 0) {
      f0[f] = 0;
      continue;
    }
    const hz = 10 * Math.pow(2, weightedCents / weightSum / 1200);
    f0[f] = hz >= 50 && hz <= 1100 ? hz : 0;
  }
  return medianFilter3(f0);
};

/** Convert F0 Hz sequence into RVC fine pitchf (Hz) and mel-quantized coarse pitch bins (1..255). */
export const quantizeF0Mel = (
  rawF0Hz: Float32Array,
  transposeSemitones: number,
): { pitch: BigInt64Array; pitchf: Float32Array } => {
  const f0MelMin = 1127 * Math.log(1 + 50 / 700);
  const f0MelMax = 1127 * Math.log(1 + 1100 / 700);
  const scale = Math.pow(2, transposeSemitones / 12);
  const pitch = new BigInt64Array(rawF0Hz.length);
  const pitchf = new Float32Array(rawF0Hz.length);

  for (let i = 0; i < rawF0Hz.length; i++) {
    const hz = (rawF0Hz[i] ?? 0) > 0 ? (rawF0Hz[i] ?? 0) * scale : 0;
    pitchf[i] = hz;
    let mel = hz > 0 ? 1127 * Math.log(1 + hz / 700) : 0;
    if (mel > 0) {
      mel = ((mel - f0MelMin) * 254) / (f0MelMax - f0MelMin) + 1;
    }
    if (mel <= 1) mel = 1;
    if (mel > 255) mel = 255;
    pitch[i] = BigInt(Math.round(mel));
  }
  return { pitch, pitchf };
};

/** Nearest-neighbor 2x temporal upsampling matching PyTorch F.interpolate(scale_factor=2). */
export const upsample2xFeatures = (feats: Float32Array, frames: number, channels: number): Float32Array => {
  const out = new Float32Array(frames * 2 * channels);
  for (let t = 0; t < frames; t++) {
    const srcOffset = t * channels;
    const dst0 = t * 2 * channels;
    const dst1 = dst0 + channels;
    for (let c = 0; c < channels; c++) {
      const val = feats[srcOffset + c] ?? 0;
      out[dst0 + c] = val;
      out[dst1 + c] = val;
    }
  }
  return out;
};

const createGaussianNoise = (length: number): Float32Array => {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const u1 = Math.max(1e-7, Math.random());
    const u2 = Math.random();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    out[i] = mag * Math.cos(2.0 * Math.PI * u2);
    if (i + 1 < length) {
      out[i + 1] = mag * Math.sin(2.0 * Math.PI * u2);
    }
  }
  return out;
};

export const fetchCachedModelBuffer = async (
  rawUrl: string,
  onProgress?: (loadedBytes: number, totalBytes: number | null) => void,
): Promise<ArrayBuffer> => {
  const url = assertHttpsModelUrl(rawUrl);
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        const buf = await cached.arrayBuffer();
        if (buf.byteLength > 0) {
          onProgress?.(buf.byteLength, buf.byteLength);
          return buf;
        }
      }
    } catch {
      // Cache storage unavailable (e.g. private browsing) - fall back cleanly to network fetch
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed downloading ONNX weights (${res.status}) from ${url}`);
  }
  const lenHdr = res.headers.get("Content-Length");
  const totalBytes = lenHdr && /^\d+$/.test(lenHdr) ? Number(lenHdr) : null;

  let buffer: ArrayBuffer;
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, totalBytes);
      }
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = merged.buffer;
  } else {
    buffer = await res.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
  }

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      await cache.put(
        url,
        new Response(buffer.slice(0), {
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
    } catch {
      // Cache write quota exceeded (ignore; in-memory inference still proceeds)
    }
  }
  return buffer;
};

const extractMetadataNumber = (meta: Record<string, string> | undefined, key: string, fallback: number): number => {
  const raw = meta?.["metadata"];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

const snapSampleRate = (derivedRate: number): number => {
  const standard = [16000, 32000, 40000, 44100, 48000];
  let best = 40000;
  let bestDist = Infinity;
  for (const sr of standard) {
    const dist = Math.abs(derivedRate - sr);
    if (dist < bestDist) {
      bestDist = dist;
      best = sr;
    }
  }
  return best;
};

export class BrowserOnnxRvcEngine {
  private contentvecSession: ort.InferenceSession | null = null;
  private crepeSession: ort.InferenceSession | null = null;
  private rvcSession: ort.InferenceSession | null = null;
  private rvcKey = "";
  private rvcChannels = 768;
  private rvcIsHalf = false;
  private rvcSampleRate = 40000;

  async ensureContentVec(
    source: string | ArrayBuffer,
    onProgress?: (loadedBytes: number, totalBytes: number | null) => void,
  ): Promise<void> {
    if (this.contentvecSession && typeof source === "string") return;
    ensureOrtEnv();
    const bytes = typeof source === "string" ? await fetchCachedModelBuffer(source, onProgress) : source;
    this.contentvecSession = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  }

  async ensureCrepe(
    source: string | ArrayBuffer,
    onProgress?: (loadedBytes: number, totalBytes: number | null) => void,
  ): Promise<void> {
    if (this.crepeSession && typeof source === "string") return;
    ensureOrtEnv();
    const bytes = typeof source === "string" ? await fetchCachedModelBuffer(source, onProgress) : source;
    this.crepeSession = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  }

  async ensureRvcModel(
    modelKey: string,
    source: string | ArrayBuffer,
    hintSampleRate = 40000,
    onProgress?: (loadedBytes: number, totalBytes: number | null) => void,
  ): Promise<{ sampleRate: number; embChannels: number; isHalf: boolean }> {
    if (this.rvcSession && this.rvcKey === modelKey && typeof source === "string") {
      return {
        sampleRate: this.rvcSampleRate,
        embChannels: this.rvcChannels,
        isHalf: this.rvcIsHalf,
      };
    }
    ensureOrtEnv();
    const bytes = typeof source === "string" ? await fetchCachedModelBuffer(source, onProgress) : source;
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    const meta = (session as unknown as { metadata?: { customMetadataMap?: Record<string, string> } }).metadata
      ?.customMetadataMap;
    const embChannels = extractMetadataNumber(meta, "embChannels", 768);
    const sr = extractMetadataNumber(meta, "samplingRate", hintSampleRate);
    const metaInputType = session.inputMetadata?.[0];
    const isHalf = metaInputType?.isTensor ? metaInputType.type === "float16" : false;

    this.rvcSession = session;
    this.rvcKey = modelKey;
    this.rvcChannels = embChannels;
    this.rvcIsHalf = isHalf;
    this.rvcSampleRate = sr;
    return { sampleRate: sr, embChannels, isHalf };
  }

  hasContentVec(): boolean {
    return this.contentvecSession !== null;
  }

  hasRvcModel(): boolean {
    return this.rvcSession !== null;
  }

  private async extractCrepeF0(audio16k: Float32Array, frameCount: number): Promise<Float32Array> {
    const crepe = this.crepeSession;
    if (!crepe) {
      return extractYinF0(audio16k, frameCount);
    }
    const win = 1024;
    const hop = 160;
    const halfWin = 512;
    const batchSize = 64;
    const probs = new Float32Array(frameCount * 360);

    for (let f0Idx = 0; f0Idx < frameCount; f0Idx += batchSize) {
      const n = Math.min(batchSize, frameCount - f0Idx);
      const frames = new Float32Array(n * win);
      for (let b = 0; b < n; b++) {
        const frameStart = (f0Idx + b) * hop - halfWin;
        const dstBase = b * win;
        for (let k = 0; k < win; k++) {
          const sIdx = frameStart + k;
          frames[dstBase + k] = sIdx >= 0 && sIdx < audio16k.length ? (audio16k[sIdx] ?? 0) : 0;
        }
      }
      const inName = crepe.inputNames[0] ?? "frames";
      const outName = crepe.outputNames[0] ?? "probabilities";
      const res = await crepe.run({ [inName]: new ort.Tensor("float32", frames, [n, win]) });
      const tensor = res[outName];
      if (tensor) {
        probs.set(tensor.data as Float32Array, f0Idx * 360);
      }
    }
    return crepeProbsToHz(probs, frameCount);
  }

  async convertMonoAudio(
    monoInput: Float32Array,
    inputSampleRate: number,
    opts: {
      transposeSemitones: number;
      pitchMethod: PitchMethod;
      onStage?: (msg: string) => void;
    },
  ): Promise<{ audio: Float32Array; sampleRate: number }> {
    const cv = this.contentvecSession;
    const rvc = this.rvcSession;
    if (!cv || !rvc) {
      throw new Error("Load ContentVec and an RVC .onnx voice model first.");
    }

    const full16k = resampleFloat32(monoInput, inputSampleRate, 16000);
    // Split into <= 8s (128,000 samples @ 16k) segments aligned to ContentVec 320-sample stride
    const segSamples = 16000 * 6; // 6s per pass keeps browser RAM compact
    const outSegments: Float32Array[] = [];
    let resolvedOutRate = this.rvcSampleRate;
    const totalSegments = Math.max(1, Math.ceil(full16k.length / segSamples));

    for (let segIdx = 0; segIdx < totalSegments; segIdx++) {
      const start = segIdx * segSamples;
      const end = Math.min(full16k.length, start + segSamples);
      const rawSeg = full16k.subarray(start, end);
      const alignedLen = Math.max(1600, Math.ceil(rawSeg.length / 320) * 320);
      const audio16k = new Float32Array(alignedLen);
      audio16k.set(rawSeg);

      opts.onStage?.(`Segment ${segIdx + 1}/${totalSegments}: extracting speech embeddings...`);
      const embedOutName =
        this.rvcChannels === 256 && cv.outputNames.includes("units9")
          ? "units9"
          : cv.outputNames.includes("unit12")
            ? "unit12"
            : (cv.outputNames[0] ?? "unit12");
      const cvRes = await cv.run(
        { audio: new ort.Tensor("float32", audio16k, [1, audio16k.length]) },
        [embedOutName],
      );
      const cvTensor = cvRes[embedOutName];
      if (!cvTensor) {
        throw new Error(`ContentVec output '${embedOutName}' missing.`);
      }
      const cvDims = cvTensor.dims;
      const cvFrames = cvDims[1] ?? Math.floor(audio16k.length / 320);
      const cvCh = cvDims[2] ?? this.rvcChannels;
      const upsampled = upsample2xFeatures(cvTensor.data as Float32Array, cvFrames, cvCh);
      const tFrames = cvFrames * 2;

      opts.onStage?.(`Segment ${segIdx + 1}/${totalSegments}: estimating pitch (${opts.pitchMethod.toUpperCase()})...`);
      const rawF0 =
        opts.pitchMethod === "crepe" && this.crepeSession
          ? await this.extractCrepeF0(audio16k, tFrames)
          : extractYinF0(audio16k, tFrames);
      const { pitch, pitchf } = quantizeF0Mel(rawF0, opts.transposeSemitones);

      opts.onStage?.(`Segment ${segIdx + 1}/${totalSegments}: synthesizing neural RVC voice...`);
      const feeds: Record<string, ort.Tensor> = {};
      if (this.rvcIsHalf) {
        const half = new Uint16Array(upsampled.length);
        for (let i = 0; i < upsampled.length; i++) {
          half[i] = float32ToFloat16Bits(upsampled[i] ?? 0);
        }
        feeds["feats"] = new ort.Tensor("float16", half, [1, tFrames, cvCh]);
      } else {
        feeds["feats"] = new ort.Tensor("float32", upsampled, [1, tFrames, cvCh]);
      }
      feeds["p_len"] = new ort.Tensor("int64", BigInt64Array.from([BigInt(tFrames)]), [1]);
      if (rvc.inputNames.includes("pitch")) {
        feeds["pitch"] = new ort.Tensor("int64", pitch, [1, tFrames]);
      }
      if (rvc.inputNames.includes("pitchf")) {
        feeds["pitchf"] = new ort.Tensor("float32", pitchf, [1, tFrames]);
      }
      if (rvc.inputNames.includes("sid")) {
        feeds["sid"] = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
      }
      if (rvc.inputNames.includes("rnd")) {
        const rndData = createGaussianNoise(192 * tFrames);
        if (this.rvcIsHalf) {
          const rndHalf = new Uint16Array(rndData.length);
          for (let i = 0; i < rndData.length; i++) rndHalf[i] = float32ToFloat16Bits(rndData[i] ?? 0);
          feeds["rnd"] = new ort.Tensor("float16", rndHalf, [1, 192, tFrames]);
        } else {
          feeds["rnd"] = new ort.Tensor("float32", rndData, [1, 192, tFrames]);
        }
      }

      const rvcOutName = rvc.outputNames[0] ?? "audio";
      const rvcRes = await rvc.run(feeds, [rvcOutName]);
      const outTensor = rvcRes[rvcOutName];
      if (!outTensor) {
        throw new Error("RVC ONNX model produced empty output.");
      }

      let pcmOut: Float32Array;
      if (outTensor.type === "float16") {
        const rawHalf = outTensor.data as Uint16Array;
        pcmOut = new Float32Array(rawHalf.length);
        for (let i = 0; i < rawHalf.length; i++) {
          pcmOut[i] = clamp(float16BitsToFloat32(rawHalf[i] ?? 0), -1, 1);
        }
      } else {
        const rawFloat = outTensor.data as Float32Array;
        pcmOut = new Float32Array(rawFloat.length);
        for (let i = 0; i < rawFloat.length; i++) {
          pcmOut[i] = clamp(rawFloat[i] ?? 0, -1, 1);
        }
      }

      resolvedOutRate = snapSampleRate((pcmOut.length / Math.max(1, tFrames)) * 100);
      const validOutLen = Math.min(pcmOut.length, Math.round((rawSeg.length / 16000) * resolvedOutRate));
      outSegments.push(pcmOut.subarray(0, validOutLen));
    }

    const totalOutLen = outSegments.reduce((acc, s) => acc + s.length, 0);
    const merged = new Float32Array(totalOutLen);
    let offset = 0;
    for (const seg of outSegments) {
      merged.set(seg, offset);
      offset += seg.length;
    }
    return { audio: merged, sampleRate: resolvedOutRate };
  }
}
