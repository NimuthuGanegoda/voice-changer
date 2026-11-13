import { useState, useMemo } from "react";
import {
  VoiceChangerServerSetting,
  ServerInfo,
  ServerSettingKey,
  OnnxExporterInfo,
  MergeModelRequest,
  VoiceChangerType,
  DefaultServerSetting,
  DeviceSetupStatus,
} from "../const";
import { VoiceChangerClient } from "../VoiceChangerClient";

export const ModelAssetName = {
  iconFile: "iconFile",
} as const;
export type ModelAssetName =
  (typeof ModelAssetName)[keyof typeof ModelAssetName];

export const ModelFileKind = {
  mmvcv13Config: "mmvcv13Config",
  mmvcv13Model: "mmvcv13Model",
  mmvcv15Config: "mmvcv15Config",
  mmvcv15Model: "mmvcv15Model",
  mmvcv15Correspondence: "mmvcv15Correspondence",

  soVitsSvc40Config: "soVitsSvc40Config",
  soVitsSvc40Model: "soVitsSvc40Model",
  soVitsSvc40Cluster: "soVitsSvc40Cluster",

  rvcModel: "rvcModel",
  rvcIndex: "rvcIndex",

  ddspSvcModel: "ddspSvcModel",
  ddspSvcModelConfig: "ddspSvcModelConfig",
  ddspSvcDiffusion: "ddspSvcDiffusion",
  ddspSvcDiffusionConfig: "ddspSvcDiffusionConfig",

  diffusionSVCModel: "diffusionSVCModel",

  beatriceModel: "beatriceModel",

  llvcModel: "llvcModel",
  llvcConfig: "llvcConfig",

  easyVCModel: "easyVCModel",
} as const;
export type ModelFileKind = (typeof ModelFileKind)[keyof typeof ModelFileKind];

export type ModelFile = {
  file: File;
  kind: ModelFileKind;
  dir: string;
};

export type ModelUploadSetting = {
  voiceChangerType: VoiceChangerType;
  slot: number;
  isSampleMode: boolean;
  sampleId: string | null;

  files: ModelFile[];
  params: any;
};
export type ModelFileForServer = Omit<ModelFile, "file"> & {
  name: string;
  kind: ModelFileKind;
  uploadName?: string;
};
export type ModelUploadSettingForServer = Omit<ModelUploadSetting, "files"> & {
  files: ModelFileForServer[];
};

type AssetUploadSetting = {
  slot: number;
  name: ModelAssetName;
  file: string;
  uploadName?: string;
};

export type UseServerSettingProps = {
  voiceChangerClient: VoiceChangerClient | null;
};

export type ServerSettingState = {
  serverSetting: ServerInfo;
  updateServerSettings: (setting: ServerInfo) => Promise<void>;
  reloadServerInfo: () => Promise<void>;

  uploadModel: (setting: ModelUploadSetting) => Promise<void>;
  uploadProgress: number;
  isUploading: boolean;

  getOnnx: () => Promise<OnnxExporterInfo>;
  getDeviceSetupStatus: () => Promise<DeviceSetupStatus | null>;
  playSound: (filename: string) => Promise<{ status: string; message?: string } | void>;
  tts: (text: string, voice?: string) => Promise<{ status: string; message?: string } | void>;
  getSoundboardList: () => Promise<{ status: string; files?: string[]; message?: string }>;
  stopSounds: () => Promise<{ status: string; message?: string } | void>;
  deleteSound: (filename: string) => Promise<{ status: string; message?: string } | void>;
  getTtsVoices: () => Promise<{ status: string; voices?: { id: string; name: string; languages: string[] }[]; message?: string }>;
  uploadSoundboardFile: (file: File) => Promise<{ status: string; message?: string } | void>;
  mergeModel: (request: MergeModelRequest) => Promise<ServerInfo>;
  updateModelDefault: () => Promise<ServerInfo>;
  updateModelInfo: (
    slot: number,
    key: string,
    val: string
  ) => Promise<ServerInfo>;
  deleteModel: (slot: number) => Promise<ServerInfo>;
  uploadAssets: (
    slot: number,
    name: ModelAssetName,
    file: File
  ) => Promise<void>;
};

export const useServerSetting = (
  props: UseServerSettingProps
): ServerSettingState => {
  const [serverSetting, _setServerSetting] =
    useState<ServerInfo>(DefaultServerSetting);
  const setServerSetting = (info: ServerInfo) => {
    if (!info.modelSlots) {
      // サーバが情報を空で返したとき。Web版対策
      return;
    }
    _setServerSetting(info);
  };

  //////////////
  // 設定
  /////////////
  const updateServerSettings = useMemo(() => {
    return async (setting: ServerInfo) => {
      if (!props.voiceChangerClient) return;
      if (!(setting.crossFadeOffsetRate >= 0 && setting.crossFadeOffsetRate < setting.crossFadeEndRate && setting.crossFadeEndRate <= 1)) {
        throw new Error("crossfade rates must satisfy 0 <= start < end <= 1");
      }
      try {
      for (let i = 0; i < Object.values(ServerSettingKey).length; i++) {
        const k = Object.values(ServerSettingKey)[
          i
        ] as keyof VoiceChangerServerSetting;
        const cur_v = serverSetting[k];
        const new_v = setting[k];

        if (cur_v != new_v) {
          const res = await props.voiceChangerClient.updateServerSettings(
            k,
            "" + new_v
          );
          setServerSetting(res);
        }
      }
      } catch (error) {
        await reloadServerInfo();
        throw error;
      }
    };
  }, [props.voiceChangerClient, serverSetting]);

  //////////////
  // 操作
  /////////////
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // (e) モデルアップロード
  const _uploadFile2 = useMemo(() => {
    return async (file: File, onprogress: (progress: number, end: boolean) => void, dir = "") => {
      if (!props.voiceChangerClient) throw new Error("voice changer client is not initialized");
      // Concatenation is part of the upload: do not report success until it commits.
      return props.voiceChangerClient.uploadFileWithId(dir, file, onprogress);
    };
  }, [props.voiceChangerClient]);

  const uploadModel = useMemo(() => {
    return async (setting: ModelUploadSetting) => {
      if (!props.voiceChangerClient) throw new Error("voice changer client is not initialized");
      if (!Number.isInteger(setting.slot) || setting.slot < 0 || setting.slot >= 500) throw new Error("invalid model slot");
      if (!setting.isSampleMode && setting.files.length === 0) throw new Error("select a model file");
      setUploadProgress(0);
      setIsUploading(true);
      try {
        const files: ModelFileForServer[] = [];
        for (let i = 0; i < setting.files.length && !setting.isSampleMode; i++) {
          const entry = setting.files[i];
          const uploaded = await _uploadFile2(entry.file, progress => {
            setUploadProgress((i + progress / 100) / setting.files.length * 95);
          }, entry.dir);
          files.push({ name: entry.file.name, kind: entry.kind, dir: entry.dir, uploadName: uploaded.storedName });
        }
        const params: ModelUploadSettingForServer = { ...setting, files };
        await props.voiceChangerClient.loadModel(setting.slot, false, JSON.stringify(params));
        setServerSetting(await props.voiceChangerClient.getServerSettings());
        setUploadProgress(100);
      } finally {
        setIsUploading(false);
      }
    };
  }, [props.voiceChangerClient, _uploadFile2]);

  const uploadAssets = useMemo(() => {
    return async (slot: number, name: ModelAssetName, file: File) => {
      if (!props.voiceChangerClient) throw new Error("voice changer client is not initialized");
      setIsUploading(true);
      try {
        const uploaded = await _uploadFile2(file, setUploadProgress);
        const asset: AssetUploadSetting = { slot, name, file: file.name, uploadName: uploaded.storedName };
        const info = await props.voiceChangerClient.uploadAssets(JSON.stringify(asset));
        setServerSetting(info);
      } finally {
        setIsUploading(false);
      }
    };
  }, [props.voiceChangerClient, _uploadFile2]);

  const reloadServerInfo = useMemo(() => {
    return async () => {
      if (!props.voiceChangerClient) return;
      const res = await props.voiceChangerClient.getServerSettings();
      setServerSetting(res);
    };
  }, [props.voiceChangerClient]);

  const getOnnx = async () => {
    return props.voiceChangerClient!.getOnnx();
  };

  const getDeviceSetupStatus = async () => {
    if (!props.voiceChangerClient) return null;
    return props.voiceChangerClient.getDeviceSetupStatus();
  };

  const playSound = async (filename: string) => {
    if (!props.voiceChangerClient) return;
    return props.voiceChangerClient.playSound(filename);
  };

  const tts = async (text: string, voice: string = "") => {
    if (!props.voiceChangerClient) return;
    return props.voiceChangerClient.tts(text, voice);
  };

  const getSoundboardList = async () => {
    if (!props.voiceChangerClient) return { status: "Error", files: [] };
    return props.voiceChangerClient.getSoundboardList();
  };
  const stopSounds = async () => {
    if (!props.voiceChangerClient) return;
    return props.voiceChangerClient.stopSounds();
  };
  const deleteSound = async (filename: string) => {
    if (!props.voiceChangerClient) return;
    return props.voiceChangerClient.deleteSound(filename);
  };
  const getTtsVoices = async () => {
    if (!props.voiceChangerClient) return { status: "Error", voices: [] };
    return props.voiceChangerClient.getTtsVoices();
  };

  const uploadSoundboardFile = async (file: File) => {
    if (!props.voiceChangerClient) return;
    return props.voiceChangerClient.uploadSoundboardFile(file);
  };

  const mergeModel = async (request: MergeModelRequest) => {
    const serverInfo = await props.voiceChangerClient!.mergeModel(request);
    setServerSetting(serverInfo);
    return serverInfo;
  };

  const updateModelDefault = async () => {
    const serverInfo = await props.voiceChangerClient!.updateModelDefault();
    setServerSetting(serverInfo);
    return serverInfo;
  };
  const updateModelInfo = async (slot: number, key: string, val: string) => {
    const serverInfo = await props.voiceChangerClient!.updateModelInfo(
      slot,
      key,
      val
    );
    setServerSetting(serverInfo);
    return serverInfo;
  };
  const deleteModel = async (slot: number) => {
    const serverInfo = await props.voiceChangerClient!.deleteModel(slot);
    setServerSetting(serverInfo);
    return serverInfo;
  };

  return {
    serverSetting,
    updateServerSettings,
    reloadServerInfo,

    uploadModel,
    uploadProgress,
    isUploading,
    getOnnx,
    getDeviceSetupStatus,
    playSound,
    tts,
    getSoundboardList,
    stopSounds,
    deleteSound,
    getTtsVoices,
    uploadSoundboardFile,
    mergeModel,
    updateModelDefault,
    updateModelInfo,
    deleteModel,
    uploadAssets,
  };
};
