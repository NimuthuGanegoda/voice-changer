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


def test_soundboard_bypass_and_volume_and_presets_and_model_default_guard(tmp_path):
    import numpy as np
    from voice_changer.utils.PresetManager import PresetManager

    manager = bare_manager()
    manager.voiceChangerModel = None
    with pytest.raises(ValueError, match="no model is loaded"):
        manager.update_model_default()

    # Fake soundboard returning constant +0.5 float32
    class FakeBoard:
        def __init__(self):
            self.volume = 1.0
            self.active = True
            self.rate = 48000
        def is_active(self):
            return self.active
        def set_sampling_rate(self, sr):
            self.rate = sr
        def set_volume(self, v):
            self.volume = v
            return v
        def get_chunk(self, size):
            return np.full(size, 0.5 * self.volume, dtype=np.float32)
        def status(self):
            return {"active": self.active, "queuedCount": 1, "remainingSeconds": 1.0, "volume": self.volume}

    seen_inputs = []
    class FakeConverter:
        def __init__(self):
            self.settings = SimpleNamespace(
                inputSampleRate=48000, outputSampleRate=48000,
                crossFadeOffsetRate=0.1, crossFadeEndRate=0.9, crossFadeOverlapSize=1024,
            )
            self.crossfadeSize = 10
        def on_request(self, pcm):
            seen_inputs.append(pcm.copy())
            # Zero-out voice to isolate pre- vs post-conversion mixing cleanly.
            return np.zeros_like(pcm), [0, 0.01, 0]
        def update_settings(self, key, val):
            pass

    manager.soundboard = FakeBoard()
    manager.voiceChanger = FakeConverter()
    manager.presetManager = PresetManager(tmp_path / "presets.json")

    # Pre-conversion mode (default bypass=False): soundboard mixed BEFORE converter.
    manager.update_settings("soundboardVolume", 0.5)
    assert manager.settings.soundboardVolume == 0.5
    assert manager.soundboard.volume == 0.5
    out_pre, _ = manager.changeVoice(np.zeros(4, dtype=np.int16))
    assert seen_inputs[-1][0] > 0
    assert out_pre.tolist() == [0, 0, 0, 0]

    # Direct/bypass mode (bypass=True): converter sees clean zeros, output gets soundboard mix!
    manager.update_settings("soundboardBypass", True)
    assert manager.get_soundboard_status()["bypass"] is True
    out_post, _ = manager.changeVoice(np.zeros(4, dtype=np.int16))
    assert seen_inputs[-1].tolist() == [0, 0, 0, 0]
    assert out_post[0] > 0

    # Preset save + apply (including atomic crossfade update).
    manager.save_preset("DirectFX", {"soundboardVolume": 0.25, "soundboardBypass": False, "crossFadeOffsetRate": 0.2, "crossFadeEndRate": 0.8})
    manager.apply_preset("DirectFX")
    assert manager.settings.soundboardVolume == 0.25
    assert manager.settings.soundboardBypass is False
    assert manager.voiceChanger.settings.crossFadeOffsetRate == 0.2
    assert manager.voiceChanger.settings.crossFadeEndRate == 0.8
    assert manager.voiceChanger.crossfadeSize == 0


def test_voice_changer_v2_sola_clipping_and_warmup_and_small_crossfade():
    import numpy as np
    from voice_changer.VoiceChangerV2 import VoiceChangerV2
    from voice_changer.utils.VoiceChangerParams import VoiceChangerParams

    vc = VoiceChangerV2(VoiceChangerParams(
        model_dir="model_dir", content_vec_500="", content_vec_500_onnx="", content_vec_500_onnx_on=True,
        hubert_base="", hubert_base_jp="", hubert_soft="", nsf_hifigan="",
        crepe_onnx_full="", crepe_onnx_tiny="", rmvpe="", rmvpe_onnx="",
        sample_mode="production", whisper_tiny="", offline=True,
    ))

    class HotModel:
        voiceChangerType = "RVC"
        def setSamplingRate(self, _in_sr, _out_sr): pass
        def get_processing_sampling_rate(self): return 48000
        def get_info(self): return {}
        def update_settings(self, _k, _v): return True
        def inference(self, data, crossfade_frame, sola_search_frame):
            # Return hot float audio (> 32767) so int16 conversion tests clipping instead of wrap-around.
            total = data.shape[0] + crossfade_frame + sola_search_frame + 128
            return np.full(total, 40000.0, dtype=np.float32)

    vc.setModel(HotModel())
    # Tight crossfade rates on a small crossfade size must never raise ZeroDivisionError.
    vc.update_settings("crossFadeOffsetRate", 0.49)
    vc.update_settings("crossFadeEndRate", 0.50)
    vc.update_settings("crossFadeOverlapSize", 8)
    vc._generate_strength(8)
    assert vc.np_prev_strength.shape == (8,)
    assert vc.np_cur_strength.shape == (8,)

    # Warmup call returns exact block_frame length (1024), not hardcoded 4096.
    vc.update_settings("crossFadeOffsetRate", 0.1)
    vc.update_settings("crossFadeEndRate", 0.9)
    vc.update_settings("crossFadeOverlapSize", 256)
    warmup, _ = vc.on_request(np.zeros(1024, dtype=np.int16))
    assert warmup.shape == (1024,)

    # Second call overlaps loud audio; must clip to 32767 instead of wrapping to negative int16!
    clipped, _ = vc.on_request(np.zeros(1024, dtype=np.int16))
    assert clipped.shape == (1024,)
    assert int(clipped.min()) >= 0
    assert int(clipped.max()) == 32767
