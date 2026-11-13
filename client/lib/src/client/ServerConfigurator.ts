import { MergeModelRequest, ServerSettingKey } from "../const";
import { ServerRestClient } from "./ServerRestClient";

export class ServerConfigurator {
    private restClient;

    constructor(serverUrl: string, accessToken = "") {
        this.restClient = new ServerRestClient(serverUrl, accessToken);
    }

    getSettings = async () => {
        return this.restClient.getSettings();
    };

    getPerformance = async () => {
        return this.restClient.getPerformance();
    };

    getDeviceSetupStatus = async () => {
        return this.restClient.getDeviceSetupStatus();
    };

    playSound = async (filename: string) => {
        return this.restClient.playSound(filename);
    };

    tts = async (text: string, voice: string = "") => {
        return this.restClient.tts(text, voice);
    };

    getSoundboardList = async () => {
        return this.restClient.getSoundboardList();
    };
    stopSounds = async () => {
        return this.restClient.stopSounds();
    };
    deleteSound = async (filename: string) => {
        return this.restClient.deleteSound(filename);
    };
    getTtsVoices = async () => {
        return this.restClient.getTtsVoices();
    };

    uploadSoundboardFile = async (file: File) => {
        return this.restClient.uploadSoundboardFile(file);
    };

    updateSettings = async (key: ServerSettingKey, val: string) => {
        return this.restClient.updateSettings(key, val);
    };

    uploadFile2 = async (dir: string, file: File, onprogress: (progress: number, end: boolean) => void) => {
        return this.restClient.uploadFile2(dir, file, onprogress);
    };

    uploadFileWithId = async (dir: string, file: File, onprogress: (progress: number, end: boolean) => void) => {
        return this.restClient.uploadFileWithId(dir, file, onprogress);
    };

    uploadFile = async (buf: ArrayBuffer, filename: string, onprogress: (progress: number, end: boolean) => void) => {
        return this.restClient.uploadFile(buf, filename, onprogress);
    };

    concatUploadedFile = async (filename: string, chunkNum: number, uploadId?: string, originalFilename?: string) => {
        return this.restClient.concatUploadedFile(filename, chunkNum, uploadId, originalFilename);
    };

    loadModel = async (slot: number, isHalf: boolean, params: string = "{}") => {
        return this.restClient.loadModel(slot, isHalf, params);
    };

    uploadAssets = async (params: string) => {
        return this.restClient.uploadAssets(params);
    };

    getModelType = async () => {
        return this.restClient.getModelType();
    };

    export2onnx = async () => {
        return this.restClient.export2onnx();
    };

    mergeModel = async (req: MergeModelRequest) => {
        return this.restClient.mergeModel(req);
    };

    updateModelDefault = async () => {
        return this.restClient.updateModelDefault();
    };

    updateModelInfo = async (slot: number, key: string, val: string) => {
        return this.restClient.updateModelInfo(slot, key, val);
    };
    deleteModel = async (slot: number) => {
        return this.restClient.deleteModel(slot);
    };
}
