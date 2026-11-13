"""Runtime-backed manager tests. Skipped by the lightweight API-only environment."""
import threading
from types import SimpleNamespace

import pytest

pytest.importorskip("torch")

from voice_changer.VoiceChangerManager import VoiceChangerManager, VoiceChangerManagerSettings


class FakeDevice:
    def __init__(self):
        self.calls = []
    def update_settings(self, key, value):
        self.calls.append((key, value))
    def get_info(self):
        return {}


class FakeChanger:
    def __init__(self):
        self.settings = SimpleNamespace(crossFadeOffsetRate=0.1, crossFadeEndRate=0.9, crossFadeOverlapSize=1024, inputSampleRate=48000)
        self.calls = []
        self.crossfadeSize = 99
    def update_settings(self, key, value):
        self.calls.append((key, value))
        if key == "crossFadeOverlapSize":
            self.settings.crossFadeOverlapSize = int(value)
    def get_info(self):
        return {}


def bare_manager():
    manager = VoiceChangerManager.__new__(VoiceChangerManager)
    manager.processingLock = threading.RLock()
    manager.settings = VoiceChangerManagerSettings()
    manager.stored_setting = {}
    manager.serverDevice = FakeDevice()
    manager.voiceChanger = None
    manager.get_info = lambda: {"status": "OK"}
    manager.store_setting = lambda key, value: manager.stored_setting.__setitem__(key, value)
    return manager


def test_cached_settings_are_applied_once_when_a_slot_is_loaded(monkeypatch):
    manager = bare_manager()
    manager.stored_setting = {"gpu": 0, "extraConvertSize": 1024, "crossFadeOverlapSize": 2048}
    changer = FakeChanger()
    monkeypatch.setattr(manager, "generateVoiceChanger", lambda slot: setattr(manager, "voiceChanger", changer))
    manager.update_settings("modelSlotIndex", 1)
    assert changer.calls.count(("gpu", 0)) == 1
    assert changer.calls.count(("extraConvertSize", 1024)) == 1
    assert changer.settings.crossFadeOverlapSize == 2048
    assert changer.crossfadeSize == 0
    assert manager.settings.modelSlotIndex == 1


def test_manager_refuses_to_delete_the_loaded_slot_and_confines_sound_paths(tmp_path, monkeypatch):
    import voice_changer.VoiceChangerManager as module
    manager = bare_manager()
    manager.settings.modelSlotIndex = 2
    deleted = []
    manager.modelSlotManager = SimpleNamespace(delete_model_slot=lambda slot: deleted.append(slot))
    with pytest.raises(ValueError):
        manager.delete_model(2)
    manager.delete_model(3)
    assert deleted == [3]

    sounds = tmp_path / "sounds"
    sounds.mkdir()
    (sounds / "clip.wav").write_bytes(b"wav")
    monkeypatch.setattr(module, "SOUNDBOARD_DIR", str(sounds))
    played = []
    manager.soundboard = SimpleNamespace(add_sound=lambda path: played.append(path) or True, clear=lambda: None)
    assert manager.play_sound("clip.wav")
    with pytest.raises(ValueError):
        manager.play_sound("../escape.wav")
    manager.delete_sound("clip.wav")
    assert not (sounds / "clip.wav").exists()
    assert manager.stop_sounds() is True
