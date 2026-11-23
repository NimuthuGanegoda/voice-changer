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

    # Null-model guards on sample rate & export2onnx must not raise AttributeError.
    empty_vc = VoiceChangerV2(VoiceChangerParams(
        model_dir="model_dir", content_vec_500="", content_vec_500_onnx="", content_vec_500_onnx_on=True,
        hubert_base="", hubert_base_jp="", hubert_soft="", nsf_hifigan="",
        crepe_onnx_full="", crepe_onnx_tiny="", rmvpe="", rmvpe_onnx="",
        sample_mode="production", whisper_tiny="", offline=True,
    ))
    empty_vc.setInputSampleRate(24000)
    empty_vc.setOutputSampleRate(24000)
    assert empty_vc.export2onnx()["status"] == "ng"


def test_rvcr2_zero_crossfade_silence_length_and_half_precision_reraise():
    import math
    import numpy as np
    import torch
    from data.ModelSlot import RVCModelSlot
    from Exceptions import DeviceCannotSupportHalfPrecisionException
    from voice_changer.RVC.RVCr2 import RVCr2
    from voice_changer.RVC.RVCSettings import RVCSettings

    rvc = RVCr2.__new__(RVCr2)
    rvc.settings = RVCSettings()
    rvc.settings.extraConvertSize = 0
    rvc.settings.silentThreshold = 0.01
    rvc.slotInfo = RVCModelSlot(samplingRate=48000, f0=True, embChannels=256)
    rvc.inputSampleRate = 48000
    rvc.outputSampleRate = 48000
    rvc.audio_buffer = None
    rvc.pitchf_buffer = None
    rvc.feature_buffer = None
    rvc.prevVol = 0.0
    rvc.rawVol = 0.0

    # crossfadeSize == 0 must not slice [-N:0] -> empty -> NaN!
    chunk_16k = np.full(1600, 1000, dtype=np.int16)
    data = rvc.generate_input(chunk_16k, crossfadeSize=0, solaSearchFrame=192, extra_frame=0)
    assert math.isfinite(rvc.rawVol) and rvc.rawVol > 0
    assert math.isfinite(data[4])

    # Silent chunk must return output-sample-rate length sufficient for VoiceChangerV2 SOLA.
    rvc.audio_buffer = None
    rvc.pitchf_buffer = None
    rvc.feature_buffer = None
    rvc.pipeline = SimpleNamespace(device=torch.device("cpu"))
    silent_in = np.zeros(4096, dtype=np.int16)
    silent_out = rvc.inference(silent_in, crossfade_frame=1024, sola_search_frame=576)
    assert silent_out.shape[0] >= 4096 + 1024 + 576
    assert np.all(silent_out == 0)

    # Half-precision fallback must set forceTensor=True, reinitialize, and re-raise (not return None).
    events = []
    class FailingPipeline:
        device = torch.device("cpu")
        def exec(self, *args, **kwargs):
            raise DeviceCannotSupportHalfPrecisionException()

    rvc.pipeline = FailingPipeline()
    rvc.deviceManager = SimpleNamespace(setForceTensor=lambda flag: events.append(("force", flag)))
    rvc.initialize = lambda: events.append(("init", True))
    loud_in = np.full(4096, 8000, dtype=np.int16)
    with pytest.raises(DeviceCannotSupportHalfPrecisionException):
        rvc.inference(loud_in, crossfade_frame=1024, sola_search_frame=576)
    assert events == [("force", True), ("init", True)]


def test_rvc_pipeline_non_f0_protect_and_single_row_index():
    import numpy as np
    import torch
    from voice_changer.RVC.pipeline.Pipeline import Pipeline

    class FakeIndex:
        ntotal = 4
        def reconstruct_n(self, _start, n):
            return np.ones((n, 4), dtype=np.float32)
        def search(self, query, k):
            # Single-row search produces shape (1, 1); must stay 2-D after indexing!
            return np.zeros((query.shape[0], k), dtype=np.float32), np.zeros((query.shape[0], k), dtype=np.int64)

    class FakeEmbedder:
        def extractFeatures(self, _feats, _layer, _proj):
            return torch.ones((1, 1, 4), dtype=torch.float32)

    class FakeInferencer:
        def infer(self, feats, _p_len, _pitch, _pitchf, _sid, _out_size):
            return torch.zeros(feats.shape[1] * 160, dtype=torch.float32)

    class FakePitch:
        def extract(self, *args, **kwargs):
            raise AssertionError("pitch extractor should not run when if_f0 == 0")

    pipeline = Pipeline(FakeEmbedder(), FakeInferencer(), FakePitch(), FakeIndex(), 48000, torch.device("cpu"), False)
    audio = torch.zeros(320, dtype=torch.float32)
    feature = np.zeros((4, 4), dtype=np.float32)
    audio_out, pitchf_buf, feats_buf = pipeline.exec(
        sid=0, audio=audio, pitchf=None, feature=feature, f0_up_key=0,
        index_rate=0.5, if_f0=0, silence_front=0.0, embOutputLayer=9,
        useFinalProj=True, repeat=0, protect=0.33, out_size=320,
    )
    assert pitchf_buf is None
    assert feats_buf.shape == (2, 4)
    assert audio_out.shape[0] == 320


def test_device_manager_half_precision_allows_16gb_rtx_blocks_gtx_16xx(monkeypatch):
    import torch
    from voice_changer.RVC.deviceManager.DeviceManager import DeviceManager

    dm = DeviceManager.__new__(DeviceManager)
    dm.gpu_num = 1
    dm.forceTensor = False
    monkeypatch.setattr(torch.cuda, "get_device_capability", lambda _i: (8, 9))

    monkeypatch.setattr(torch.cuda, "get_device_name", lambda _i: "NVIDIA GeForce RTX 4060 Ti 16GB")
    assert dm.halfPrecisionAvailable(0) is True

    monkeypatch.setattr(torch.cuda, "get_device_name", lambda _i: "NVIDIA GeForce GTX 1660 SUPER")
    assert dm.halfPrecisionAvailable(0) is False

    monkeypatch.setattr(torch.cuda, "get_device_name", lambda _i: "NVIDIA GeForce GTX 1650")
    assert dm.halfPrecisionAvailable(0) is False


def test_rmvpe_onnx_short_audio_and_empty_f0_and_nono_v22():
    import numpy as np
    import torch
    from voice_changer.RVC.pitchExtractor.RMVPEOnnxPitchExtractor import RMVPEOnnxPitchExtractor
    from voice_changer.RVC.inferencer.OnnxRVCInferencerNono import OnnxRVCInferencerNono

    ext = RMVPEOnnxPitchExtractor.__new__(RMVPEOnnxPitchExtractor)
    ext.f0_min = 50
    ext.f0_max = 1100
    ext.f0_mel_min = 1127 * np.log(1 + ext.f0_min / 700)
    ext.f0_mel_max = 1127 * np.log(1 + ext.f0_max / 700)

    # 1) Scalar 1-frame output + silence_front larger than audio (triggers minimumFrames slice).
    ext.onnx_session = SimpleNamespace(run=lambda _out, _inp: [np.array([[[220.0]]], dtype=np.float32)])
    coarse, pitchf = ext.extract(np.zeros(320, dtype=np.float32), np.zeros(4, dtype=np.float32), 0, 16000, 160, silence_front=1.0)
    assert coarse.shape == (4,)
    assert pitchf[-1] == pytest.approx(220.0)

    # 2) Empty 0-frame output must not raise broadcast ValueError.
    ext.onnx_session = SimpleNamespace(run=lambda _out, _inp: [np.zeros((1, 0), dtype=np.float32)])
    coarse0, pitchf0 = ext.extract(np.zeros(320, dtype=np.float32), np.zeros(4, dtype=np.float32), 0, 16000, 160, silence_front=0.0)
    assert coarse0.shape == (4,)
    assert np.all(pitchf0 == 0)

    # 3) OnnxRVCInferencerNono v2.2 returns audio1[0] directly without 3D indexing crash.
    nono = OnnxRVCInferencerNono.__new__(OnnxRVCInferencerNono)
    nono.isHalf = False
    nono.inferencerTypeVersion = "v2.2"
    nono.model = SimpleNamespace(run=lambda _out, _inp: [np.array([0.1, -0.2], dtype=np.float32)])
    out = nono.infer(torch.zeros((1, 2, 768)), torch.tensor([2]), None, None, torch.tensor([0]), None)
    assert out.shape == (2,)

    # 4) Whisper.extractFeatures must accept Pipeline's 3-argument call signature.
    import inspect
    from voice_changer.RVC.embedder.Whisper import Whisper
    sig = inspect.signature(Whisper.extractFeatures)
    sig.bind(Whisper(), torch.zeros(160), 9, True)

    # 5) OnnxContentvec executes units9/unit12 cleanly and matches both hubert_base & contentvec.
    from voice_changer.RVC.embedder.OnnxContentvec import OnnxContentvec
    cv = OnnxContentvec()
    cv.setProps("contentvec", "contentvec-f.onnx", torch.device("cpu"), False)
    assert cv.matchCondition("hubert_base")
    assert cv.matchCondition("contentvec")
    cv.output_names = {"units9", "unit12"}
    calls = []
    def fake_run(outputs, feed):
        calls.append((outputs, feed["audio"].shape))
        dim = 256 if outputs == ["units9"] else 768
        return [np.zeros((1, 10, dim), dtype=np.float32)]
    cv.model = SimpleNamespace(run=fake_run)
    assert cv.extractFeatures(torch.zeros((1, 3200)), 9, True).shape == (1, 10, 256)
    assert cv.extractFeatures(torch.zeros((1, 3200)), 12, False).shape == (1, 10, 768)
    assert calls[0][0] == ["units9"]
    assert calls[1][0] == ["unit12"]

    # 6) _compress_float32_initializers_to_fp16 halves large weight initializers while keeping float32 Cast output.
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    from voice_changer.RVC.onnxExporter.export2onnx import _compress_float32_initializers_to_fp16

    w_arr = np.linspace(-1.0, 1.0, 512, dtype=np.float32).reshape(16, 32)
    w_init = numpy_helper.from_array(w_arr, name="weight_f32")
    x_in = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 16])
    y_out = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 32])
    mm_node = helper.make_node("MatMul", inputs=["x", "weight_f32"], outputs=["y"])
    graph = helper.make_graph([mm_node], "test_fp16_compress", [x_in], [y_out], [w_init])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    _compress_float32_initializers_to_fp16(model, min_elements=256)
    assert model.graph.initializer[0].data_type == TensorProto.FLOAT16
    assert model.graph.node[0].op_type == "Cast"
    assert model.graph.node[0].output[0] == "weight_f32"
