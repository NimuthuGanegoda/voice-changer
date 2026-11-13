from const import UPLOAD_DIR, StaticSlot
from data.ModelSlot import ModelSlots, loadAllSlotInfo, loadSlotInfo, saveSlotInfo
import json
import os
import shutil
import threading
import uuid

from voice_changer.utils.SettingValidation import finite_float, strict_int

from mods.log_control import VoiceChangaerLogger
from voice_changer.utils.ModelPaths import model_slot_path, resolve_under, safe_filename, validate_slot

logger = VoiceChangaerLogger.get_instance().getLogger()

_EDITABLE_FIELDS = {
    "name", "description", "credit", "termsOfUseUrl", "speakers", "srcId", "dstId",
    "f0Factor", "defaultTune", "defaultIndexRatio", "defaultProtect",
    "defaultClusterInferRatio", "defaultKstep", "defaultSpeedup", "noiseScale",
}
_INT_RANGES = {"srcId": (0, 9999), "dstId": (0, 9999), "defaultTune": (-48, 48), "defaultKstep": (0, 1000), "defaultSpeedup": (0, 100)}
_FLOAT_RANGES = {"defaultIndexRatio": (0, 1), "defaultProtect": (0, 0.5), "defaultClusterInferRatio": (0, 1), "f0Factor": (0.1, 10), "noiseScale": (0, 10)}
_ICON_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


class ModelSlotManager:
    _instance = None
    _instance_lock = threading.RLock()

    def __init__(self, model_dir: str):
        self.model_dir = model_dir
        self.lock = threading.RLock()
        self.modelSlots = loadAllSlotInfo(self.model_dir)
        logger.debug(f"[MODEL SLOT INFO] {self.modelSlots}")

    @classmethod
    def get_instance(cls, model_dir: str):
        with cls._instance_lock:
            if cls._instance is None or os.path.abspath(cls._instance.model_dir) != os.path.abspath(model_dir):
                cls._instance = cls(model_dir)
            return cls._instance

    def _save_model_slot(self, slotIndex: int, slotInfo: ModelSlots):
        with self.lock:
            validate_slot(slotIndex)
            slotInfo.slotIndex = slotIndex
            saveSlotInfo(self.model_dir, slotIndex, slotInfo)
            self.modelSlots[slotIndex] = loadSlotInfo(self.model_dir, slotIndex)

    def _load_model_slot(self, slotIndex: int):
        try:
            return self.modelSlots[validate_slot(slotIndex)]
        except (ValueError, IndexError):
            return None

    def _search_model_slot(self, slotIndex: StaticSlot):
        return next((x for x in self.modelSlots if x.slotIndex == slotIndex), None)

    def getAllSlotInfo(self, reload: bool = False):
        with self.lock:
            if reload:
                self.modelSlots = loadAllSlotInfo(self.model_dir)
            return self.modelSlots

    def get_slot_info(self, slotIndex: int | StaticSlot):
        with self.lock:
            if slotIndex == "Beatrice-JVS":
                return self._search_model_slot(slotIndex)
            return self._load_model_slot(slotIndex)

    def save_model_slot(self, slotIndex: int, slotInfo: ModelSlots):
        self._save_model_slot(slotIndex, slotInfo)

    def update_model_info(self, newData: str):
        logger.info(f"[Voice Changer] UPDATE MODEL INFO, {newData}")
        data = json.loads(newData)
        key = data["key"]
        if key not in _EDITABLE_FIELDS:
            raise ValueError(f"model field is not editable: {key}")
        value = json.loads(data["val"]) if key == "speakers" else data["val"]
        if key == "speakers":
            if not isinstance(value, dict) or len(value) > 10000 or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
                raise ValueError("speakers must map string ids to labels")
        elif key in _INT_RANGES:
            value = strict_int(value, key)
            low, high = _INT_RANGES[key]
            if not low <= value <= high:
                raise ValueError(f"{key} must be between {low} and {high}")
        elif key in _FLOAT_RANGES:
            value = finite_float(value, key)
            low, high = _FLOAT_RANGES[key]
            if not low <= value <= high:
                raise ValueError(f"{key} must be between {low} and {high}")
        else:
            if not isinstance(value, str) or len(value) > 10000:
                raise ValueError("metadata must be a string of at most 10000 characters")
            if key == "termsOfUseUrl" and value and not value.startswith(("https://", "http://")):
                raise ValueError("termsOfUseUrl must be an HTTP(S) URL")
        with self.lock:
            slot_info = self.get_slot_info(data["slot"])
            if slot_info is None or slot_info.voiceChangerType is None:
                raise ValueError("model slot does not exist")
            if not hasattr(slot_info, key):
                raise ValueError(f"unknown model field: {key}")
            setattr(slot_info, key, value)
            self._save_model_slot(data["slot"], slot_info)

    def store_model_assets(self, params: str):
        data = json.loads(params)
        if data.get("name") != "iconFile":
            raise ValueError("only iconFile assets are supported")
        name = safe_filename(data["file"])
        if os.path.splitext(name)[1].lower() not in _ICON_EXTENSIONS:
            raise ValueError("icon must be a PNG, JPEG, GIF or WebP image")
        with self.lock:
            slot_info = self.get_slot_info(data["slot"])
            if slot_info is None or slot_info.voiceChangerType is None:
                raise ValueError("model slot does not exist")
            source = resolve_under(UPLOAD_DIR, data.get("uploadName") or name, must_exist=True)
            target = resolve_under(model_slot_path(self.model_dir, data["slot"]), name)
            shutil.copy2(source, target)
            slot_info.iconFile = name
            self._save_model_slot(data["slot"], slot_info)
            source.unlink(missing_ok=True)

    def delete_model_slot(self, slotIndex: int):
        with self.lock:
            validate_slot(slotIndex)
            target = model_slot_path(self.model_dir, slotIndex)
            if not target.exists():
                raise ValueError("model slot does not exist")
            if target.is_symlink() or not target.is_dir():
                raise ValueError("model slot is not a regular directory")
            backup = target.parent / f".backup-delete-{slotIndex}-{uuid.uuid4().hex}"
            os.replace(target, backup)
            try:
                empty = loadSlotInfo(self.model_dir, slotIndex)
                empty.slotIndex = slotIndex
                self.modelSlots[slotIndex] = empty
            except BaseException:
                if not target.exists():
                    os.replace(backup, target)
                raise
            # The deletion is committed once the empty slot is published. A cleanup
            # failure must not roll back over a partially removed backup.
            try:
                shutil.rmtree(backup)
            except OSError:
                logger.warning("Deleted slot %s but could not remove backup %s", slotIndex, backup)
