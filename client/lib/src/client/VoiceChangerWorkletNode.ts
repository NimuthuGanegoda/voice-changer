import { VoiceChangerWorkletProcessorRequest } from "../@types/voice-changer-worklet-processor";
import {
  DefaultClientSetting,
  DownSamplingMode,
  VOICE_CHANGER_CLIENT_EXCEPTION,
  WorkletNodeSetting,
  WorkletSetting,
} from "../const";
import { io, Socket } from "socket.io-client";
import { DefaultEventsMap } from "@socket.io/component-emitter";
import { ServerRestClient } from "./ServerRestClient";

export type VoiceChangerWorkletListener = {
  notifyVolume: (vol: number) => void;
  notifySendBufferingTime: (time: number) => void;
  notifyResponseTime: (time: number, perf?: number[]) => void;
  notifyException: (
    code: VOICE_CHANGER_CLIENT_EXCEPTION,
    message: string
  ) => void;
};

export type InternalCallback = {
  processAudio: (data: Uint8Array) => Promise<Uint8Array>;
};

export class VoiceChangerWorkletNode extends AudioWorkletNode {
  private listener: VoiceChangerWorkletListener;

  private setting: WorkletNodeSetting = { ...DefaultClientSetting.workletNodeSetting };
  private requestChunks: ArrayBuffer[] = [];
  private pendingRequests = 0;
  private recordingSamples = 0;
  private recordingTruncated = false;
  private static readonly MAX_RECORDING_SAMPLES = 48000 * 300;
  private socket: Socket<DefaultEventsMap, DefaultEventsMap> | null = null;
  // performance monitor
  private bufferStart = 0;

  private isOutputRecording = false;
  private recordingOutputChunk: Float32Array[] = [];
  private outputNode: VoiceChangerWorkletNode | null = null;

  // Promises
  private startPromiseResolve:
    | ((value: void | PromiseLike<void>) => void)
    | null = null;
  private stopPromiseResolve:
    | ((value: void | PromiseLike<void>) => void)
    | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  // InternalCallback
  private internalCallback: InternalCallback | null = null;

  constructor(context: AudioContext, listener: VoiceChangerWorkletListener, private connectSocket = true) {
    super(context, "voice-changer-worklet-processor");
    this.port.onmessage = this.handleMessage.bind(this);
    this.listener = listener;
    if (this.connectSocket) this.createSocketIO();
    console.log(`[worklet_node][voice-changer-worklet-processor] created.`);
  }

  setOutputNode = (outputNode: VoiceChangerWorkletNode | null) => {
    this.outputNode = outputNode;
  };

  // 設定
  updateSetting = (setting: WorkletNodeSetting) => {
    console.log(
      `[WorkletNode] Updating WorkletNode Setting,`,
      this.setting,
      setting
    );
    let recreateSocketIoRequired = false;
    if (
      this.setting.serverUrl != setting.serverUrl ||
      this.setting.protocol != setting.protocol ||
      this.setting.accessToken != setting.accessToken
    ) {
      recreateSocketIoRequired = true;
    }
    if (![24000, 44100, 48000].includes(setting.sendingSampleRate)) throw new Error("unsupported sending sample rate");
    if (!Number.isInteger(setting.inputChunkNum) || setting.inputChunkNum < 1 || setting.inputChunkNum > 4096) throw new Error("inputChunkNum must be an integer between 1 and 4096");
    if (!["sio", "rest", "internal"].includes(setting.protocol)) throw new Error("unknown protocol");
    if (!["decimate", "average"].includes(setting.downSamplingMode)) throw new Error("unknown downsampling mode");
    this.setting = { ...setting };
    if (recreateSocketIoRequired && this.connectSocket) {
      this.createSocketIO();
    }
  };

  setInternalAudioProcessCallback = (internalCallback: InternalCallback) => {
    this.internalCallback = internalCallback;
  };

  getSettings = (): WorkletNodeSetting => {
    return { ...this.setting };
  };

  getSocketId = () => {
    return this.socket?.id;
  };

  // 処理
  private createSocketIO = () => {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
    this.pendingRequests = 0;
    this.requestChunks = [];
    if (this.setting.protocol === "sio") {
      this.socket = io(this.setting.serverUrl + "/test", { auth: { token: this.setting.accessToken ?? "" }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
      this.socket.on("connect_error", (err) => {
        this.listener.notifyException(
          VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_CONNECT_FAILED,
          `[SIO] rconnection failed ${err}`
        );
      });
      this.socket.on("connect", () => {
        console.log(`[SIO] connect to ${this.setting.serverUrl}`);
        console.log(`[SIO] ${this.socket?.id}`);
      });
      this.socket.on("disconnect", (reason) => {
        this.pendingRequests = 0;
        this.requestChunks = [];
        console.log(`[SIO] disconnected: ${reason}`);
      });
      this.socket.on("overrun", () => {
        this.pendingRequests = Math.max(0, this.pendingRequests - 1);
      });
      this.socket.on("vc_error", (error: { msg: string }) => {
        this.pendingRequests = Math.max(0, this.pendingRequests - 1);
        this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_INVALID_RESPONSE, error?.msg ?? "server conversion error");
      });

      this.socket.on("message", (response: any[]) => {
        console.log("message:", response);
      });

      this.socket.on("response", (response: any[]) => {
        if (!Array.isArray(response) || response.length < 2 || typeof response[0] !== "number") {
          this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_INVALID_RESPONSE, "malformed realtime response");
          return;
        }
        const cur = Date.now();
        const responseTime = cur - response[0];
        const result = response[1] as ArrayBuffer;
        const perf = response[2];
        if (response[0] !== 0) this.pendingRequests = Math.max(0, this.pendingRequests - 1);

        // Quick hack for server device mode
        if (response[0] == 0 && Array.isArray(perf)) {
          this.listener.notifyResponseTime(
            Math.round(perf[0] * 1000),
            perf.slice(1, 4)
          );
          return;
        }

        if (!(result instanceof ArrayBuffer) || result.byteLength < 128 * 2) {
          this.listener.notifyException(
            VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_INVALID_RESPONSE,
            `[SIO] received data is too short ${result instanceof ArrayBuffer ? result.byteLength : 0}`
          );
        } else {
          if (this.outputNode != null) {
            this.outputNode.postReceivedVoice(response[1]);
          } else {
            this.postReceivedVoice(response[1]);
          }
          this.listener.notifyResponseTime(responseTime, perf);
        }
      });
    }
  };

  postReceivedVoice = (data: ArrayBuffer) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength % 2 !== 0 || data.byteLength < 128 * 2) {
      this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_INVALID_RESPONSE, "audio response must be even-length PCM16 of at least 128 samples");
      return;
    }
    // Int16 to Float
    const i16Data = new Int16Array(data); // Socket.IO already decodes signed PCM16.
    const f32Data = new Float32Array(i16Data.length);
    // console.log(`[worklet] f32DataLength${f32Data.length} i16DataLength${i16Data.length}`)
    i16Data.forEach((x, i) => {
      const float = x / (x < 0 ? 0x8000 : 0x7fff);
      f32Data[i] = float;
    });

    // Upsample the server's sending rate to the worklet's 48 kHz clock.
    // This must also handle 44.1 kHz; the old code assumed every non-48k rate was 24k.
    const upSampledBuffer = this._resampleBuffer(f32Data, this.setting.sendingSampleRate, 48000);

    const req: VoiceChangerWorkletProcessorRequest = {
      requestType: "voice",
      voice: upSampledBuffer,
      numTrancateTreshold: 0,
      volTrancateThreshold: 0,
      volTrancateLength: 0,
    };
    this.port.postMessage(req);

    if (this.isOutputRecording) {
      const remaining = VoiceChangerWorkletNode.MAX_RECORDING_SAMPLES - this.recordingSamples;
      if (remaining > 0) {
        const chunk = upSampledBuffer.length <= remaining ? upSampledBuffer : upSampledBuffer.slice(0, remaining);
        this.recordingOutputChunk.push(chunk);
        this.recordingSamples += chunk.length;
      } else if (!this.recordingTruncated) {
        this.recordingTruncated = true;
        this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_RECORDING_LIMIT, "recording reached the five-minute safety limit");
      }
    }
  };

  private _resampleBuffer(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) throw new Error("sample rates must be positive");
    if (fromRate === toRate || buffer.length === 0) return buffer;
    const outLength = Math.max(1, Math.round(buffer.length * toRate / fromRate));
    const out = new Float32Array(outLength);
    const ratio = fromRate / toRate;
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const left = Math.floor(pos);
      const right = Math.min(left + 1, buffer.length - 1);
      const frac = pos - left;
      out[i] = buffer[left] * (1 - frac) + buffer[right] * frac;
    }
    return out;
  }

  private _averageDownsampleBuffer(
    buffer: Float32Array,
    originalSampleRate: number,
    destinationSamplerate: number
  ) {
    if (originalSampleRate == destinationSamplerate) {
      return buffer;
    }
    if (destinationSamplerate > originalSampleRate) {
      throw new Error("downsampling destination rate must not exceed the original rate");
    }
    const sampleRateRatio = originalSampleRate / destinationSamplerate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      // Use average value of skipped samples
      let accum = 0,
        count = 0;
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      // Or you can simply get rid of the skipped samples:
      // result[offsetResult] = buffer[nextOffsetBuffer];
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }
  handleMessage(event: any) {
    // console.log(`[Node:handleMessage_] `, event.data.volume);
    if (event.data.responseType === "start_ok") {
      if (this.startPromiseResolve) {
        this.startPromiseResolve();
        this.startPromiseResolve = null;
      }
    } else if (event.data.responseType === "stop_ok") {
      if (this.stopPromiseResolve) {
        this.stopPromiseResolve();
        this.stopPromiseResolve = null;
      }
    } else if (event.data.responseType === "volume") {
      this.listener.notifyVolume(event.data.volume as number);
    } else if (event.data.responseType === "inputData") {
      const inputData = event.data.inputData as Float32Array;
      // console.log("receive input data", inputData);

      // ダウンサンプリング
      let downsampledBuffer: Float32Array | null = null;
      if (this.setting.sendingSampleRate == 48000) {
        downsampledBuffer = inputData;
      } else if (this.setting.downSamplingMode == DownSamplingMode.decimate && this.setting.sendingSampleRate == 24000) {
        //////// (Kind 1) 間引き //////////
        //// 48000Hz で入ってくるので間引いて24000Hzに変換する。
        downsampledBuffer = new Float32Array(Math.floor(inputData.length / 2));
        for (let i = 0; i < downsampledBuffer.length; i++) {
          downsampledBuffer[i] = inputData[i * 2];
        }
      } else {
        //////// (Kind 2) 平均 //////////
        // downsampledBuffer = this._averageDownsampleBuffer(buffer, 48000, 24000)
        downsampledBuffer = this._averageDownsampleBuffer(
          inputData,
          48000,
          this.setting.sendingSampleRate
        );
      }

      // Float to Int16 (internalの場合はfloatのまま行く。)
      if (this.setting.protocol != "internal") {
        const arrayBuffer = new ArrayBuffer(downsampledBuffer.length * 2);
        const dataView = new DataView(arrayBuffer);
        for (let i = 0; i < downsampledBuffer.length; i++) {
          let s = Math.max(-1, Math.min(1, downsampledBuffer[i]));
          s = s < 0 ? s * 0x8000 : s * 0x7fff;
          dataView.setInt16(i * 2, s, true);
        }
        // バッファリング
        this.requestChunks.push(arrayBuffer);
      } else {
        // internal
        // console.log("downsampledBuffer.buffer", downsampledBuffer.buffer);
        this.requestChunks.push(downsampledBuffer.buffer as ArrayBuffer);
      }

      const maxChunks = Math.max(1, this.setting.inputChunkNum) * 2;
      if (this.requestChunks.length > maxChunks) this.requestChunks.splice(0, this.requestChunks.length - maxChunks);
      //// リクエストバッファの中身が、リクエスト送信数と違う場合は処理終了。
      if (this.requestChunks.length < this.setting.inputChunkNum) {
        return;
      }

      // リクエスト用の入れ物を作成
      const windowByteLength = this.requestChunks.reduce((prev, cur) => {
        return prev + cur.byteLength;
      }, 0);
      const newBuffer = new Uint8Array(windowByteLength);

      // リクエストのデータをセット
      this.requestChunks.reduce((prev, cur) => {
        newBuffer.set(new Uint8Array(cur), prev);
        return prev + cur.byteLength;
      }, 0);

      this.sendBuffer(newBuffer);
      this.requestChunks = [];

      this.listener.notifySendBufferingTime(Date.now() - this.bufferStart);
      this.bufferStart = Date.now();
    } else {
      console.warn(
        `[worklet_node][voice-changer-worklet-processor] unknown response ${event.data.responseType}`,
        event.data
      );
    }
  }

  private sendBuffer = async (newBuffer: Uint8Array) => {
    const timestamp = Date.now();
    if (this.setting.protocol === "sio") {
      if (!this.socket || !this.socket.connected || this.pendingRequests >= 4) return;
      this.pendingRequests += 1;
      this.socket.volatile.emit("request_message", [timestamp, newBuffer.buffer as ArrayBuffer]);
    } else if (this.setting.protocol === "rest") {
      if (this.pendingRequests >= 2) return;
      this.pendingRequests += 1;
      const restClient = new ServerRestClient(this.setting.serverUrl, this.setting.accessToken);
      try {
        const res = await restClient.postVoice(timestamp, newBuffer.buffer as ArrayBuffer);
        if (res.byteLength < 128 * 2) {
          this.listener.notifyException(
            VOICE_CHANGER_CLIENT_EXCEPTION.ERR_REST_INVALID_RESPONSE,
            `[REST] received data is too short ${res.byteLength}`
          );
        } else {
          if (this.outputNode != null) {
            this.outputNode.postReceivedVoice(res);
          } else {
            this.postReceivedVoice(res);
          }
          this.listener.notifyResponseTime(Date.now() - timestamp);
        }
      } catch (error) {
        this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_REST_INVALID_RESPONSE, String(error));
      } finally {
        this.pendingRequests -= 1;
      }
    } else if (this.setting.protocol == "internal") {
      if (!this.internalCallback) {
        this.listener.notifyException(
          VOICE_CHANGER_CLIENT_EXCEPTION.ERR_INTERNAL_AUDIO_PROCESS_CALLBACK_IS_NOT_INITIALIZED,
          `[AudioWorkletNode] internal audio process callback is not initialized`
        );
        return;
      }
      // const res = await this.internalCallback.processAudio(newBuffer);
      // if (res.length < 128 * 2) {
      //     return;
      // }
      // if (this.outputNode != null) {
      //     this.outputNode.postReceivedVoice(res.buffer as ArrayBuffer);
      // } else {
      //     this.postReceivedVoice(res.buffer as ArrayBuffer);
      // }
      this.internalCallback.processAudio(newBuffer).then((res) => {
        if (res.length < 128 * 2) {
          return;
        }
        if (this.outputNode != null) {
          this.outputNode.postReceivedVoice(res.buffer as ArrayBuffer);
        } else {
          this.postReceivedVoice(res.buffer as ArrayBuffer);
        }
      }).catch((error) => {
        this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_INTERNAL_AUDIO_PROCESS_CALLBACK_IS_NOT_INITIALIZED, String(error));
      });
    } else {
      this.listener.notifyException(VOICE_CHANGER_CLIENT_EXCEPTION.ERR_SIO_INVALID_RESPONSE, `unknown protocol ${this.setting.protocol}`);
    }
  };

  // Worklet操作
  configure = (setting: WorkletSetting) => {
    const req: VoiceChangerWorkletProcessorRequest = {
      requestType: "config",
      voice: new Float32Array(1),
      numTrancateTreshold: setting.numTrancateTreshold,
      volTrancateThreshold: setting.volTrancateThreshold,
      volTrancateLength: setting.volTrancateLength,
    };
    this.port.postMessage(req);
  };

  start = async () => {
    if (this.startPromise) return this.startPromise;
    const p = new Promise<void>((resolve) => {
      this.startPromiseResolve = resolve;
    });
    this.startPromise = p;
    const req: VoiceChangerWorkletProcessorRequest = {
      requestType: "start",
      voice: new Float32Array(1),
      numTrancateTreshold: 0,
      volTrancateThreshold: 0,
      volTrancateLength: 0,
    };
    try {
      this.port.postMessage(req);
      await p;
    } finally {
      this.startPromise = null;
      this.startPromiseResolve = null;
    }
  };
  stop = async () => {
    if (this.stopPromise) return this.stopPromise;
    const p = new Promise<void>((resolve) => {
      this.stopPromiseResolve = resolve;
    });
    this.stopPromise = p;
    const req: VoiceChangerWorkletProcessorRequest = {
      requestType: "stop",
      voice: new Float32Array(1),
      numTrancateTreshold: 0,
      volTrancateThreshold: 0,
      volTrancateLength: 0,
    };
    try {
      this.port.postMessage(req);
      await p;
    } finally {
      this.stopPromise = null;
      this.stopPromiseResolve = null;
    }
  };
  trancateBuffer = () => {
    const req: VoiceChangerWorkletProcessorRequest = {
      requestType: "trancateBuffer",
      voice: new Float32Array(1),
      numTrancateTreshold: 0,
      volTrancateThreshold: 0,
      volTrancateLength: 0,
    };
    this.port.postMessage(req);
  };

  startOutputRecording = () => {
    this.recordingOutputChunk = [];
    this.recordingSamples = 0;
    this.recordingTruncated = false;
    this.isOutputRecording = true;
  };
  stopOutputRecording = () => {
    this.isOutputRecording = false;

    const dataSize = this.recordingOutputChunk.reduce((prev, cur) => {
      return prev + cur.length;
    }, 0);
    const samples = new Float32Array(dataSize);
    let sampleIndex = 0;
    for (let i = 0; i < this.recordingOutputChunk.length; i++) {
      for (let j = 0; j < this.recordingOutputChunk[i].length; j++) {
        samples[sampleIndex] = this.recordingOutputChunk[i][j];
        sampleIndex++;
      }
    }
    this.recordingOutputChunk = [];
    this.recordingSamples = 0;
    return samples;
  };
}
