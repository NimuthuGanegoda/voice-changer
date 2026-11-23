"""Unit tests for OnnxContentvec embedder without requiring heavyweight torch."""
import sys
from types import SimpleNamespace

import numpy as np


class _FakeTensor:
    def __init__(self, arr):
        self._arr = np.asarray(arr, dtype=np.float32)
        self.shape = self._arr.shape

    def detach(self):
        return self

    def to(self, *args, **kwargs):
        return self

    def numpy(self):
        return self._arr


def test_onnx_contentvec_runs_and_selects_units9_or_unit12(monkeypatch):
    fake_torch = SimpleNamespace(
        device=lambda name: SimpleNamespace(type=name, index=None),
        Tensor=_FakeTensor,
        float32=np.float32,
        from_numpy=lambda arr: _FakeTensor(arr),
    )
    seen_runs = []

    class FakeSession:
        def __init__(self, path, sess_options=None, providers=None, provider_options=None):
            self.path = path

        def get_outputs(self):
            return [SimpleNamespace(name="units9"), SimpleNamespace(name="unit12")]

        def run(self, output_names, inputs):
            seen_runs.append((output_names, inputs["audio"].shape))
            dim = 256 if output_names == ["units9"] else 768
            return [np.zeros((1, 8, dim), dtype=np.float32)]

    fake_ort = SimpleNamespace(
        SessionOptions=lambda: SimpleNamespace(),
        ExecutionMode=SimpleNamespace(ORT_SEQUENTIAL=0),
        get_available_providers=lambda: ["CPUExecutionProvider"],
        InferenceSession=FakeSession,
    )
    fake_dm = SimpleNamespace(
        DeviceManager=SimpleNamespace(
            get_instance=lambda: SimpleNamespace(
                getOnnxExecutionProvider=lambda _gpu: (["CPUExecutionProvider"], [{}], None)
            )
        )
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "onnxruntime", fake_ort)
    monkeypatch.setitem(sys.modules, "voice_changer.RVC.deviceManager.DeviceManager", fake_dm)
    sys.modules.pop("voice_changer.RVC.embedder.OnnxContentvec", None)

    from voice_changer.RVC.embedder.OnnxContentvec import OnnxContentvec

    embedder = OnnxContentvec().loadModel("pretrain/content_vec_500.onnx", fake_torch.device("cpu"))
    assert embedder.matchCondition("hubert_base")
    assert embedder.matchCondition("contentvec")

    out_v1 = embedder.extractFeatures(_FakeTensor(np.zeros((1, 3200), dtype=np.float32)), embOutputLayer=9, useFinalProj=True)
    out_v2 = embedder.extractFeatures(_FakeTensor(np.zeros((1, 3200), dtype=np.float32)), embOutputLayer=12, useFinalProj=False)
    assert out_v1.shape == (1, 8, 256)
    assert out_v2.shape == (1, 8, 768)
    assert seen_runs == [(["units9"], (1, 3200)), (["unit12"], (1, 3200))]
