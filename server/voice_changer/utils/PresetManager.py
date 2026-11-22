"""Bounded, atomic storage for named voice-changer parameter presets."""
from __future__ import annotations

import copy
import json
import math
import re
import threading
from pathlib import Path
from typing import Any

from const import STORED_PRESETS_FILE
from mods.log_control import VoiceChangaerLogger
from voice_changer.utils.AtomicFile import write_json_atomic

logger = VoiceChangaerLogger.get_instance().getLogger()

PRESET_NAME_PATTERN = re.compile(r"^[A-Za-z0-9 _.-]{1,64}$")
MAX_PRESETS = 50

PRESET_ALLOWED_KEYS = frozenset(
    {
        "modelSlotIndex",
        "tran",
        "f0Detector",
        "f0Factor",
        "indexRatio",
        "protect",
        "silentThreshold",
        "extraConvertSize",
        "crossFadeOffsetRate",
        "crossFadeEndRate",
        "crossFadeOverlapSize",
        "serverInputAudioGain",
        "serverOutputAudioGain",
        "soundboardVolume",
        "soundboardBypass",
        "passThrough",
    }
)


def validate_preset_name(name: str) -> str:
    if not isinstance(name, str):
        raise ValueError("preset name must be a string")
    cleaned = name.strip()
    if not cleaned or not PRESET_NAME_PATTERN.match(cleaned) or cleaned in (".", ".."):
        raise ValueError("preset name must be 1-64 characters using letters, numbers, spaces, '.', '_' or '-'")
    return cleaned


def validate_preset_settings(settings: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(settings, dict) or not settings:
        raise ValueError("preset settings must be a non-empty JSON object")
    validated: dict[str, Any] = {}
    for key, value in settings.items():
        if key not in PRESET_ALLOWED_KEYS:
            raise ValueError(f"setting is not permitted in a preset: {key}")
        if isinstance(value, bool):
            validated[key] = value
        elif isinstance(value, (int, float)):
            if not math.isfinite(value):
                raise ValueError(f"preset value for {key} must be finite")
            validated[key] = value
        elif isinstance(value, str):
            if len(value) > 128:
                raise ValueError(f"preset string value for {key} is too long")
            validated[key] = value
        else:
            raise ValueError(f"preset value for {key} must be a scalar")
    return validated


class PresetManager:
    """Thread-safe, atomically persisted named preset store."""

    def __init__(self, path: str | Path = STORED_PRESETS_FILE):
        self.path = Path(path)
        self.lock = threading.RLock()
        self._presets: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self):
        with self.lock:
            if not self.path.exists():
                self._presets = {}
                return
            try:
                with open(self.path, "r", encoding="utf-8") as source:
                    loaded = json.load(source)
                if not isinstance(loaded, dict):
                    logger.warning("Ignoring non-object stored presets file")
                    self._presets = {}
                    return
                cleaned: dict[str, dict[str, Any]] = {}
                for raw_name, raw_settings in loaded.items():
                    try:
                        name = validate_preset_name(raw_name)
                        cleaned[name] = validate_preset_settings(raw_settings)
                    except ValueError as exc:
                        logger.warning("Skipping invalid preset %r: %s", raw_name, exc)
                self._presets = cleaned
            except (OSError, ValueError) as exc:
                logger.warning("Could not read stored presets: %s", exc)
                self._presets = {}

    def _persist(self):
        write_json_atomic(self.path, self._presets, indent=2)

    def list_presets(self) -> dict[str, dict[str, Any]]:
        with self.lock:
            return copy.deepcopy(self._presets)

    def get_preset(self, name: str) -> dict[str, Any]:
        cleaned = validate_preset_name(name)
        with self.lock:
            if cleaned not in self._presets:
                raise KeyError(f"preset not found: {cleaned}")
            return copy.deepcopy(self._presets[cleaned])

    def save_preset(self, name: str, settings: dict[str, Any]) -> dict[str, Any]:
        cleaned = validate_preset_name(name)
        validated = validate_preset_settings(settings)
        with self.lock:
            if cleaned not in self._presets and len(self._presets) >= MAX_PRESETS:
                raise ValueError(f"maximum number of presets ({MAX_PRESETS}) reached")
            self._presets[cleaned] = validated
            self._persist()
            return copy.deepcopy(validated)

    def delete_preset(self, name: str) -> bool:
        cleaned = validate_preset_name(name)
        with self.lock:
            if cleaned not in self._presets:
                raise KeyError(f"preset not found: {cleaned}")
            del self._presets[cleaned]
            self._persist()
            return True
