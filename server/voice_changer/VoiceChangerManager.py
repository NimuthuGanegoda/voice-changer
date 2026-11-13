import json
import os
import sys
import shutil
import threading
import time
import numpy as np
from downloader.SampleDownloader import downloadSample, getSampleInfos
from mods.log_control import VoiceChangaerLogger
from voice_changer.Local.ServerDevice import ServerDevice, ServerDeviceCallbacks
from voice_changer.ModelSlotManager import ModelSlotManager
from voice_changer.RVC.RVCModelMerger import RVCModelMerger
from voice_changer.VoiceChanger import VoiceChanger
from const import STORED_SETTING_FILE, UPLOAD_DIR, SOUNDBOARD_DIR, StaticSlot, MAX_SLOT_NUM
from voice_changer.VoiceChangerV2 import VoiceChangerV2
from voice_changer.utils.LoadModelParams import LoadModelParamFile, LoadModelParams
from voice_changer.utils.ModelImport import install_model
from voice_changer.utils.Soundboard import Soundboard
from voice_changer.utils.ModelMerger import ModelMergerRequest
from voice_changer.utils.ModelPaths import MAX_MODEL_SLOTS
from voice_changer.utils.SettingValidation import strict_int
from voice_changer.utils.VoiceChangerModel import AudioInOut
from voice_changer.utils.VoiceChangerParams import VoiceChangerParams
from dataclasses import dataclass, asdict, field
import torch

from typing import Callable
from typing import Any
import re

logger = VoiceChangaerLogger.get_instance().getLogger()


@dataclass()
class GPUInfo:
    id: int
    name: str
    memory: int


@dataclass()
class VoiceChangerManagerSettings:
    modelSlotIndex: int | StaticSlot = -1
    passThrough: bool = False  # 0: off, 1: on
    # ↓mutableな物だけ列挙
    boolData: list[str] = field(default_factory=lambda: ["passThrough"])
    intData: list[str] = field(
        default_factory=lambda: [
            "modelSlotIndex",
        ]
    )


class VoiceChangerManager(ServerDeviceCallbacks):
    _instance = None

    ############################
    # ServerDeviceCallbacks
    ############################
    def on_request(self, unpackedData: AudioInOut):
        return self.changeVoice(unpackedData)

    def emitTo(self, performance: list[float]):
        callback = getattr(self, "emitToFunc", None)
        if callback is not None:
            callback(performance)

    def get_processing_sampling_rate(self):
        return self.voiceChanger.get_processing_sampling_rate() if self.voiceChanger is not None else 0

    def setInputSamplingRate(self, sr: int):
        if self.voiceChanger is not None:
            self.voiceChanger.setInputSampleRate(sr)

    def setOutputSamplingRate(self, sr: int):
        if self.voiceChanger is not None:
            self.voiceChanger.setOutputSampleRate(sr)

    ############################
    # VoiceChangerManager
    ############################
    def __init__(self, params: VoiceChangerParams):
        logger.info("[Voice Changer] VoiceChangerManager initializing...")
        self.params = params
        self.startedAt = time.monotonic()
        # One owner at a time: REST, Socket.IO and the local audio worker share
        # mutable pipelines. Control changes wait for the current audio block.
        self.processingLock = threading.RLock()
        self.voiceChanger: VoiceChanger = None
        self.settings: VoiceChangerManagerSettings = VoiceChangerManagerSettings()

        self.modelSlotManager = ModelSlotManager.get_instance(self.params.model_dir)
        self.soundboard = Soundboard()
        os.makedirs(SOUNDBOARD_DIR, exist_ok=True)
        # スタティックな情報を収集
        self.gpus: list[GPUInfo] = self._get_gpuInfos()

        # Load persisted settings before any worker can observe the manager.
        self.stored_setting: dict[str, str | int | float] = {}
        if os.path.exists(STORED_SETTING_FILE):
            try:
                with open(STORED_SETTING_FILE, "r", encoding="utf-8") as source:
                    loaded = json.load(source)
                if isinstance(loaded, dict):
                    self.stored_setting = loaded
                else:
                    logger.warning("Ignoring non-object stored settings file")
            except (OSError, ValueError) as exc:
                logger.warning("Could not read stored settings: %s", exc)
        self.stored_setting.setdefault("gpu", 0)

        self.serverDevice = ServerDevice(self)
        if "modelSlotIndex" in self.stored_setting:
            try:
                self.update_settings("modelSlotIndex", self.stored_setting["modelSlotIndex"])
            except Exception:
                logger.exception("Could not restore the saved model slot; starting without a model")
                self.settings.modelSlotIndex = -1
        thread = threading.Thread(target=self.serverDevice.start, daemon=True, name="server-audio-device")
        thread.start()
        logger.info("[Voice Changer] VoiceChangerManager initializing... done.")

    def store_setting(self, key: str, val: str | int | float):
        saveItemForServerDevice = ["enableServerAudio", "serverAudioSampleRate", "serverInputDeviceId", "serverOutputDeviceId", "serverMonitorDeviceId", "serverReadChunkSize", "serverInputAudioGain", "serverOutputAudioGain"]
        saveItemForVoiceChanger = ["crossFadeOffsetRate", "crossFadeEndRate", "crossFadeOverlapSize"]
        saveItemForVoiceChangerManager = ["modelSlotIndex"]
        saveItemForRVC = ["extraConvertSize", "gpu", "silentThreshold"]
        saveItemForAllVoiceChanger = ["f0Detector"]  # 設定されたf0DetectorがVCに存在しない値の場合はデフォルトに落ちるように実装すること

        saveItem = []
        saveItem.extend(saveItemForServerDevice)
        saveItem.extend(saveItemForVoiceChanger)
        saveItem.extend(saveItemForVoiceChangerManager)
        saveItem.extend(saveItemForRVC)
        saveItem.extend(saveItemForAllVoiceChanger)
        if key in saveItem:
            self.stored_setting[key] = val
            from voice_changer.utils.AtomicFile import write_json_atomic
            write_json_atomic(STORED_SETTING_FILE, self.stored_setting)

    def _get_gpuInfos(self):
        devCount = torch.cuda.device_count()
        gpus = []
        for id in range(devCount):
            name = torch.cuda.get_device_name(id)
            memory = torch.cuda.get_device_properties(id).total_memory
            gpu = {"id": id, "name": name, "memory": memory}
            gpus.append(gpu)
        return gpus

    @classmethod
    def get_instance(cls, params: VoiceChangerParams):
        if cls._instance is None:
            cls._instance = cls(params)
        return cls._instance

    def loadModel(self, params: LoadModelParams):
        # Also validate direct/internal callers, not just the REST boundary.
        params = LoadModelParams.model_validate(params)
        with self.processingLock:
            if params.isSampleMode:
                logger.info(f"[Voice Changer] sample download...., {params}")
                downloadSample(self.params.sample_mode, params.sampleId, self.params.model_dir, params.slot, params.params)
                self.modelSlotManager.getAllSlotInfo(reload=True)
                return {"status": "OK"}

            generators = {
                "RVC": ("voice_changer.RVC.RVCModelSlotGenerator", "RVCModelSlotGenerator"),
                "MMVCv13": ("voice_changer.MMVCv13.MMVCv13ModelSlotGenerator", "MMVCv13ModelSlotGenerator"),
                "MMVCv15": ("voice_changer.MMVCv15.MMVCv15ModelSlotGenerator", "MMVCv15ModelSlotGenerator"),
                "so-vits-svc-40": ("voice_changer.SoVitsSvc40.SoVitsSvc40ModelSlotGenerator", "SoVitsSvc40ModelSlotGenerator"),
                "DDSP-SVC": ("voice_changer.DDSP_SVC.DDSP_SVCModelSlotGenerator", "DDSP_SVCModelSlotGenerator"),
                "Diffusion-SVC": ("voice_changer.DiffusionSVC.DiffusionSVCModelSlotGenerator", "DiffusionSVCModelSlotGenerator"),
                "Beatrice": ("voice_changer.Beatrice.BeatriceModelSlotGenerator", "BeatriceModelSlotGenerator"),
                "LLVC": ("voice_changer.LLVC.LLVCModelSlotGenerator", "LLVCModelSlotGenerator"),
                "EasyVC": ("voice_changer.EasyVC.EasyVCModelSlotGenerator", "EasyVCModelSlotGenerator"),
            }
            module_name, class_name = generators[params.voiceChangerType]
            from importlib import import_module
            generator = getattr(import_module(module_name), class_name)

            install_model(
                self.params.model_dir, UPLOAD_DIR, params, generator,
                self.modelSlotManager.save_model_slot,
            )
            self.modelSlotManager.getAllSlotInfo(reload=True)
            logger.info(f"Installed model slot {params.slot}")
            return self.get_info()

    def get_info(self):
        data = asdict(self.settings)
        data["gpus"] = self.gpus
        data["modelSlots"] = self.modelSlotManager.getAllSlotInfo()
        data["sampleModels"] = getSampleInfos(self.params.sample_mode, self.params.model_dir, self.params.offline)
        data["python"] = sys.version
        data["voiceChangerParams"] = self.params

        data["status"] = "OK"

        info = self.serverDevice.get_info()
        data.update(info)

        if self.voiceChanger is not None:
            info = self.voiceChanger.get_info()
            data.update(info)

        return data

    def get_performance(self):
        if self.voiceChanger is not None:
            info = self.voiceChanger.get_performance()
            return info
        else:
            return [0, 0, 0, 0]

    def generateVoiceChanger(self, val: int | StaticSlot):
        slotInfo = self.modelSlotManager.get_slot_info(val)
        if slotInfo is None or slotInfo.voiceChangerType is None:
            logger.info(f"[Voice Changer] model slot is not found {val}")
            raise ValueError(f"model slot is not found: {val}")
        elif slotInfo.voiceChangerType == "RVC":
            logger.info("................RVC")
            # from voice_changer.RVC.RVC import RVC

            # self.voiceChangerModel = RVC(self.params, slotInfo)
            # self.voiceChanger = VoiceChanger(self.params)
            # self.voiceChanger.setModel(self.voiceChangerModel)

            from voice_changer.RVC.RVCr2 import RVCr2

            model = RVCr2(self.params, slotInfo)
            changer = VoiceChangerV2(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer

        elif slotInfo.voiceChangerType == "MMVCv13":
            logger.info("................MMVCv13")
            from voice_changer.MMVCv13.MMVCv13 import MMVCv13

            model = MMVCv13(slotInfo)
            changer = VoiceChanger(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
        elif slotInfo.voiceChangerType == "MMVCv15":
            logger.info("................MMVCv15")
            from voice_changer.MMVCv15.MMVCv15 import MMVCv15

            model = MMVCv15(slotInfo)
            changer = VoiceChanger(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
        elif slotInfo.voiceChangerType == "so-vits-svc-40":
            logger.info("................so-vits-svc-40")
            from voice_changer.SoVitsSvc40.SoVitsSvc40 import SoVitsSvc40

            model = SoVitsSvc40(self.params, slotInfo)
            changer = VoiceChanger(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
        elif slotInfo.voiceChangerType == "DDSP-SVC":
            logger.info("................DDSP-SVC")
            from voice_changer.DDSP_SVC.DDSP_SVC import DDSP_SVC

            model = DDSP_SVC(self.params, slotInfo)
            changer = VoiceChanger(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
        elif slotInfo.voiceChangerType == "Diffusion-SVC":
            logger.info("................Diffusion-SVC")
            from voice_changer.DiffusionSVC.DiffusionSVC import DiffusionSVC

            model = DiffusionSVC(self.params, slotInfo)
            changer = VoiceChangerV2(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
        elif slotInfo.voiceChangerType == "Beatrice":
            logger.info("................Beatrice")
            from voice_changer.Beatrice.Beatrice import Beatrice

            if val == "Beatrice-JVS":
                model = Beatrice(self.params, slotInfo, static=True)
            else:
                model = Beatrice(self.params, slotInfo)
            changer = VoiceChangerV2(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
        elif slotInfo.voiceChangerType == "LLVC":
            logger.info("................LLVC")
            from voice_changer.LLVC.LLVC import LLVC

            model = LLVC(self.params, slotInfo)
            changer = VoiceChangerV2(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
            pass

        elif slotInfo.voiceChangerType == "EasyVC":
            logger.info("................EasyVC")
            from voice_changer.EasyVC.EasyVC import EasyVC

            model = EasyVC(self.params, slotInfo)
            changer = VoiceChangerV2(self.params)
            changer.setModel(model)
            self.voiceChangerModel = model
            self.voiceChanger = changer
            pass

        else:
            raise ValueError(f"unknown voice changer model: {slotInfo.voiceChangerType}")

    def update_settings(self, key: str, val: str | int | float | bool):
        with self.processingLock:
            return self._update_settings_locked(key, val)

    def _update_settings_locked(self, key: str, val: str | int | float | bool):
        from voice_changer.utils.AudioSettings import updated_crossfade
        if key in ("crossFadeOffsetRate", "crossFadeEndRate", "crossFadeOverlapSize"):
            if self.voiceChanger is not None:
                updated_crossfade(self.voiceChanger.settings, key, val)
            else:
                from types import SimpleNamespace
                updated_crossfade(SimpleNamespace(crossFadeOffsetRate=0.1, crossFadeEndRate=0.9, crossFadeOverlapSize=4096), key, val)

        if key in self.settings.boolData:
            if val in ("true", True, 1, "1"):
                newVal = True
            elif val in ("false", False, 0, "0"):
                newVal = False
            else:
                raise ValueError(f"invalid boolean value: {val}")
            setattr(self.settings, key, newVal)
        elif key in self.settings.intData:
            if key == "modelSlotIndex":
                try:
                    newVal = strict_int(val, "modelSlotIndex")
                    if not 0 <= newVal < MAX_MODEL_SLOTS:
                        raise ValueError(f"model slot must be between 0 and {MAX_MODEL_SLOTS - 1}")
                except (TypeError, ValueError):
                    if val != "Beatrice-JVS":
                        raise ValueError("invalid model slot")
                    newVal = val
                logger.info(f"[Voice Changer] model slot is changed {self.settings.modelSlotIndex} -> {newVal}")
                self.generateVoiceChanger(newVal)
                # Apply cached settings; crossfade fields are one atomic group so
                # insertion order cannot create a temporarily invalid interval.
                crossfade_keys = {"crossFadeOffsetRate", "crossFadeEndRate", "crossFadeOverlapSize"}
                for k, v in self.stored_setting.items():
                    if k != "modelSlotIndex" and k not in crossfade_keys:
                        self._apply_runtime_setting_locked(k, v)
                if self.voiceChanger is not None and crossfade_keys.intersection(self.stored_setting):
                    from voice_changer.utils.AudioSettings import apply_crossfade
                    current = self.voiceChanger.settings
                    apply_crossfade(
                        current,
                        self.stored_setting.get("crossFadeOffsetRate", current.crossFadeOffsetRate),
                        self.stored_setting.get("crossFadeEndRate", current.crossFadeEndRate),
                        self.stored_setting.get("crossFadeOverlapSize", current.crossFadeOverlapSize),
                    )
                    self.voiceChanger.crossfadeSize = 0
            else:
                newVal = strict_int(val, key)

            setattr(self.settings, key, newVal)

        self._apply_runtime_setting_locked(key, val)
        self.store_setting(key, val)
        return self.get_info()

    def _apply_runtime_setting_locked(self, key: str, val):
        self.serverDevice.update_settings(key, val)
        if self.voiceChanger is not None:
            self.voiceChanger.update_settings(key, val)

    def changeVoice(self, receivedData: AudioInOut):
        with self.processingLock:
            return self._changeVoice_locked(receivedData)

    def _changeVoice_locked(self, receivedData: AudioInOut):
        if receivedData.size == 0:
            raise ValueError("audio block must not be empty")
        # Mix soundboard audio (skip the float round-trip entirely when nothing is queued)
        if self.soundboard.is_active():
            if self.voiceChanger is not None:
                inputSampleRate = getattr(self.voiceChanger.settings, "inputSampleRate", 48000)
                self.soundboard.set_sampling_rate(inputSampleRate)
            sb_chunk = self.soundboard.get_chunk(receivedData.shape[0])
            receivedDataFloat = receivedData.astype(np.float32) / 32768.0
            mixedDataFloat = receivedDataFloat + sb_chunk
            mixedData = (np.clip(mixedDataFloat, -1.0, 1.0) * 32767.0).astype(np.int16)
        else:
            mixedData = receivedData

        if self.settings.passThrough is True:  # パススルー
            return mixedData, []

        if self.voiceChanger is not None:
            return self.voiceChanger.on_request(mixedData)
        else:
            logger.info("Voice Change is not loaded. Did you load a correct model?")
            return mixedData, []

    def stop_sounds(self):
        self.soundboard.clear()
        return True

    def play_sound(self, filename: str):
        from voice_changer.utils.ModelPaths import resolve_under, safe_filename
        name = safe_filename(filename)
        if os.path.splitext(name)[1].lower() not in {".wav", ".mp3", ".ogg", ".flac", ".m4a"}:
            raise ValueError("unsupported soundboard file type")
        path = resolve_under(SOUNDBOARD_DIR, name, must_exist=True)
        logger.info(f"[Voice Changer] Playing sound: {path}")
        return self.soundboard.add_sound(str(path))

    def delete_sound(self, filename: str):
        from voice_changer.utils.ModelPaths import resolve_under, safe_filename
        path = resolve_under(SOUNDBOARD_DIR, safe_filename(filename), must_exist=True)
        path.unlink()
        return True

    def delete_model(self, slot: int):
        from voice_changer.utils.ModelPaths import validate_slot
        with self.processingLock:
            validate_slot(slot)
            if self.settings.modelSlotIndex == slot:
                raise ValueError("cannot delete the currently loaded model slot")
            self.modelSlotManager.delete_model_slot(slot)
            return self.get_info()

    def export2onnx(self):
        with self.processingLock:
            if self.voiceChanger is None:
                raise ValueError("no model is loaded")
            return self.voiceChanger.export2onnx()

    def merge_models(self, request: str):
        with self.processingLock:
            req = ModelMergerRequest.model_validate(json.loads(request))
            if req.voiceChangerType != "RVC":
                raise ValueError("only RVC model merging is supported")
            slot = MAX_SLOT_NUM - 1
            merged = RVCModelMerger.merge_models(self.params, req, slot)
            load_param = LoadModelParams(
                voiceChangerType="RVC", slot=slot, isSampleMode=False, sampleId="",
                files=[LoadModelParamFile(name="merged.pth", kind="rvcModel", dir="", uploadName=os.path.basename(merged))],
                params={},
            )
            return self.loadModel(load_param)

    def setEmitTo(self, emitTo: Callable[[Any], None]):
        self.emitToFunc = emitTo

    def update_model_default(self):
        with self.processingLock:
            current_settings = self.voiceChangerModel.get_model_current()
            for current_setting in current_settings:
                current_setting["slot"] = self.settings.modelSlotIndex
                self.modelSlotManager.update_model_info(json.dumps(current_setting))
            return self.get_info()

    def update_model_info(self, newData: str):
        with self.processingLock:
            self.modelSlotManager.update_model_info(newData)
            return self.get_info()

    def upload_model_assets(self, params: str):
        with self.processingLock:
            self.modelSlotManager.store_model_assets(params)
            return self.get_info()
