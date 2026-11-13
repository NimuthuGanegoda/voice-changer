import { VoiceChangerWorkletNode, VoiceChangerWorkletListener, InternalCallback } from "./client/VoiceChangerWorkletNode";
// @ts-ignore
import workerjs from "raw-loader!../worklet/dist/index.js";
import { validateUrl } from "./util";
import { DefaultClientSetting, MergeModelRequest, ServerSettingKey, VoiceChangerClientSetting, WorkletNodeSetting, WorkletSetting } from "./const";
import { ServerConfigurator } from "./client/ServerConfigurator";

// オーディオデータの流れ
// input node(mic or MediaStream) -> [vc node] ->
//    sio/rest server ->  [vc node] -> output node

import { BlockingQueue } from "./utils/BlockingQueue";

export class VoiceChangerClient {
    private configurator: ServerConfigurator;
    private ctx: AudioContext;

    private currentMediaStream: MediaStream | null = null;
    private currentMediaStreamAudioSourceNode: MediaStreamAudioSourceNode | null = null;
    private inputGainNode: GainNode | null = null;
    private outputGainNode: GainNode | null = null;
    private monitorGainNode: GainNode | null = null;
    private vcInNode!: VoiceChangerWorkletNode;
    private vcOutNode!: VoiceChangerWorkletNode;
    private currentMediaStreamAudioDestinationNode!: MediaStreamAudioDestinationNode;
    private currentMediaStreamAudioDestinationMonitorNode!: MediaStreamAudioDestinationNode;

    private promiseForInitialize: Promise<void>;
    private _isVoiceChanging = false;

    private setting: VoiceChangerClientSetting = { ...DefaultClientSetting.voiceChangerClientSetting };

    private sslCertified: string[] = [];

    private sem = new BlockingQueue<number>();

    constructor(ctx: AudioContext, voiceChangerWorkletListener: VoiceChangerWorkletListener) {
        this.sem.enqueue(0);
        this.configurator = new ServerConfigurator("");
        this.ctx = ctx;
        this.promiseForInitialize = this.initialize(voiceChangerWorkletListener);
    }

    private initialize = async (listener: VoiceChangerWorkletListener): Promise<void> => {
        const scriptUrl = URL.createObjectURL(new Blob([workerjs], { type: "text/javascript" }));
        const outputContext = new AudioContext({ sampleRate: 48000 });
        try {
            try {
                this.vcInNode = new VoiceChangerWorkletNode(this.ctx, listener);
            } catch {
                await this.ctx.audioWorklet.addModule(scriptUrl);
                this.vcInNode = new VoiceChangerWorkletNode(this.ctx, listener);
            }
            try {
                this.vcOutNode = new VoiceChangerWorkletNode(outputContext, listener, false);
            } catch {
                await outputContext.audioWorklet.addModule(scriptUrl);
                this.vcOutNode = new VoiceChangerWorkletNode(outputContext, listener, false);
            }
            this.currentMediaStreamAudioDestinationNode = outputContext.createMediaStreamDestination();
            this.outputGainNode = outputContext.createGain();
            this.outputGainNode.gain.value = this.setting.outputGain;
            this.vcOutNode.connect(this.outputGainNode);
            this.outputGainNode.connect(this.currentMediaStreamAudioDestinationNode);
            this.currentMediaStreamAudioDestinationMonitorNode = outputContext.createMediaStreamDestination();
            this.monitorGainNode = outputContext.createGain();
            this.monitorGainNode.gain.value = this.setting.monitorGain;
            this.vcOutNode.connect(this.monitorGainNode);
            this.monitorGainNode.connect(this.currentMediaStreamAudioDestinationMonitorNode);
        } catch (error) {
            await outputContext.close();
            throw error;
        } finally {
            URL.revokeObjectURL(scriptUrl);
        }
    };

    private lock = async () => {
        const num = await this.sem.dequeue();
        return num;
    };
    private unlock = (num: number) => {
        this.sem.enqueue(num + 1);
    };

    isInitialized = async () => {
        if (this.promiseForInitialize) {
            await this.promiseForInitialize;
        }
        return true;
    };

    /////////////////////////////////////////////////////
    // オペレーション
    /////////////////////////////////////////////////////
    /// Operations ///
    setup = async () => {
        const lockNum = await this.lock();
        try {
            if (!this.vcInNode) throw new Error("vc node is not initialized");
            await this.vcInNode.stop();
            this._isVoiceChanging = false;
            if (this.currentMediaStream) {
                this.currentMediaStream.getTracks().forEach(track => track.stop());
                this.currentMediaStream = null;
            }
            this.currentMediaStreamAudioSourceNode?.disconnect();
            this.inputGainNode?.disconnect();
            this.currentMediaStreamAudioSourceNode = null;
            this.inputGainNode = null;
            if (!this.setting.audioInput || this.setting.audioInput === "none") {
                return;
            }
            if (typeof this.setting.audioInput === "string") {
                try {
                    this.currentMediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: this.setting.audioInput, channelCount: 1, sampleRate: this.setting.sampleRate,
                            sampleSize: 16, autoGainControl: false, echoCancellation: this.setting.echoCancel,
                            noiseSuppression: this.setting.noiseSuppression,
                        },
                    });
                } catch (error) {
                    await this.vcInNode.stop();
                    throw error;
                }
            } else {
                this.currentMediaStream = this.setting.audioInput;
            }
            this.currentMediaStreamAudioSourceNode = this.ctx.createMediaStreamSource(this.currentMediaStream);
            this.inputGainNode = this.ctx.createGain();
            this.inputGainNode.gain.value = this.setting.inputGain;
            this.currentMediaStreamAudioSourceNode.connect(this.inputGainNode);
            this.inputGainNode.connect(this.vcInNode);
            this.vcInNode.setOutputNode(this.vcOutNode);
        } finally {
            this.unlock(lockNum);
        }
    };
    get stream(): MediaStream {
        return this.currentMediaStreamAudioDestinationNode.stream;
    }
    get monitorStream(): MediaStream {
        return this.currentMediaStreamAudioDestinationMonitorNode.stream;
    }

    start = async () => {
        await this.vcInNode.start();
        this._isVoiceChanging = true;
    };
    stop = async () => {
        await this.vcInNode.stop();
        this._isVoiceChanging = false;
    };

    get isVoiceChanging(): boolean {
        return this._isVoiceChanging;
    }

    ////////////////////////
    /// 設定
    //////////////////////////////
    setServerUrl = (serverUrl: string, openTab: boolean = false, accessToken = "") => {
        const url = validateUrl(serverUrl);
        const pageUrl = `${location.protocol}//${location.host}`;

        if (url != pageUrl && url.length != 0 && location.protocol == "https:" && this.sslCertified.includes(url) == false) {
            if (openTab) {
                const value = window.confirm("MMVC Server is different from this page's origin. Open tab to open ssl connection. OK? (You can close the opened tab after ssl connection succeed.)");
                if (value) {
                    window.open(url, "_blank");
                    this.sslCertified.push(url);
                } else {
                    alert("Your voice conversion may fail...");
                }
            }
        }
        this.vcInNode.updateSetting({ ...this.vcInNode.getSettings(), serverUrl: url, accessToken });
        this.vcOutNode.updateSetting({ ...this.vcOutNode.getSettings(), serverUrl: url, accessToken });
        this.configurator = new ServerConfigurator(url, accessToken);
    };

    updateClientSetting = async (setting: VoiceChangerClientSetting) => {
        let reconstructInputRequired = false;
        if (this.setting.audioInput != setting.audioInput || this.setting.echoCancel != setting.echoCancel || this.setting.noiseSuppression != setting.noiseSuppression || this.setting.sampleRate != setting.sampleRate) {
            reconstructInputRequired = true;
        }

        if (this.setting.inputGain != setting.inputGain) {
            this.setInputGain(setting.inputGain);
        }
        if (this.setting.outputGain != setting.outputGain) {
            this.setOutputGain(setting.outputGain);
        }
        if (this.setting.monitorGain != setting.monitorGain) {
            this.setMonitorGain(setting.monitorGain);
        }

        this.setting = { ...setting };
        if (reconstructInputRequired) {
            await this.setup();
        }
    };

    setInputGain = (val: number) => {
        if (!Number.isFinite(val) || val < 0 || val > 10) throw new Error("gain must be between 0 and 10");
        this.setting.inputGain = val;
        if (this.inputGainNode) this.inputGainNode.gain.value = val;
    };

    setOutputGain = (val: number) => {
        if (!Number.isFinite(val) || val < 0 || val > 10) throw new Error("gain must be between 0 and 10");
        this.setting.outputGain = val;
        if (this.outputGainNode) this.outputGainNode.gain.value = val;
    };

    setMonitorGain = (val: number) => {
        if (!Number.isFinite(val) || val < 0 || val > 10) throw new Error("gain must be between 0 and 10");
        this.setting.monitorGain = val;
        if (this.monitorGainNode) this.monitorGainNode.gain.value = val;
    };

    /////////////////////////////////////////////////////
    // コンポーネント設定、操作
    /////////////////////////////////////////////////////
    //##  Server ##//
    getModelType = () => {
        return this.configurator.getModelType();
    };
    getOnnx = async () => {
        return this.configurator.export2onnx();
    };
    mergeModel = async (req: MergeModelRequest) => {
        return this.configurator.mergeModel(req);
    };
    updateModelDefault = async () => {
        return this.configurator.updateModelDefault();
    };
    updateModelInfo = async (slot: number, key: string, val: string) => {
        return this.configurator.updateModelInfo(slot, key, val);
    };
    deleteModel = async (slot: number) => {
        return this.configurator.deleteModel(slot);
    };

    updateServerSettings = (key: ServerSettingKey, val: string) => {
        return this.configurator.updateSettings(key, val);
    };
    uploadFileWithId = (dir: string, file: File, onprogress: (progress: number, end: boolean) => void) => {
        return this.configurator.uploadFileWithId(dir, file, onprogress);
    };
    uploadFile = (buf: ArrayBuffer, filename: string, onprogress: (progress: number, end: boolean) => void) => {
        return this.configurator.uploadFile(buf, filename, onprogress);
    };
    uploadFile2 = (dir: string, file: File, onprogress: (progress: number, end: boolean) => void) => {
        return this.configurator.uploadFile2(dir, file, onprogress);
    };
    concatUploadedFile = (filename: string, chunkNum: number, uploadId?: string, originalFilename?: string) => {
        return this.configurator.concatUploadedFile(filename, chunkNum, uploadId, originalFilename);
    };
    loadModel = (slot: number, isHalf: boolean, params: string) => {
        return this.configurator.loadModel(slot, isHalf, params);
    };
    uploadAssets = (params: string) => {
        return this.configurator.uploadAssets(params);
    };

    //##  Worklet ##//
    configureWorklet = (setting: WorkletSetting) => {
        this.vcInNode.configure(setting);
        this.vcOutNode.configure(setting);
    };
    startOutputRecording = () => {
        this.vcOutNode.startOutputRecording();
    };
    stopOutputRecording = () => {
        return this.vcOutNode.stopOutputRecording();
    };
    trancateBuffer = () => {
        this.vcOutNode.trancateBuffer();
    };
    //##  Worklet Node ##//
    updateWorkletNodeSetting = (setting: WorkletNodeSetting) => {
        this.vcInNode.updateSetting(setting);
        this.vcOutNode.updateSetting(setting);
    };
    setInternalAudioProcessCallback = (internalCallback: InternalCallback) => {
        this.vcInNode.setInternalAudioProcessCallback(internalCallback);
    };

    /////////////////////////////////////////////////////
    // 情報取得
    /////////////////////////////////////////////////////
    // Information
    getClientSettings = () => {
        return this.vcInNode.getSettings();
    };
    getServerSettings = () => {
        return this.configurator.getSettings();
    };
    getPerformance = () => {
        return this.configurator.getPerformance();
    };
    getDeviceSetupStatus = () => {
        return this.configurator.getDeviceSetupStatus();
    };
    playSound = (filename: string) => {
        return this.configurator.playSound(filename);
    };
    tts = (text: string, voice: string = "") => {
        return this.configurator.tts(text, voice);
    };
    getSoundboardList = () => {
        return this.configurator.getSoundboardList();
    };
    stopSounds = () => {
        return this.configurator.stopSounds();
    };
    deleteSound = (filename: string) => {
        return this.configurator.deleteSound(filename);
    };
    getTtsVoices = () => {
        return this.configurator.getTtsVoices();
    };
    uploadSoundboardFile = (file: File) => {
        return this.configurator.uploadSoundboardFile(file);
    };

    getSocketId = () => {
        return this.vcInNode.getSocketId();
    };
}
