import importlib
import sys
from types import ModuleType

import pytest


@pytest.fixture
def checkpoint_module(monkeypatch):
    calls = []
    torch = ModuleType("torch")
    def load(path, **kwargs):
        calls.append(kwargs)
        if kwargs.get("weights_only") is True:
            raise RuntimeError("unsafe pickle")
        return {"weight": {}}
    torch.load = load
    monkeypatch.setitem(sys.modules, "torch", torch)
    import voice_changer.utils.TrustedCheckpoint as module
    module = importlib.reload(module)
    return module, calls


def test_rvc_checkpoint_defaults_to_weights_only(checkpoint_module, monkeypatch):
    module, calls = checkpoint_module
    monkeypatch.delenv("VCCLIENT_TRUST_MODEL_PICKLES", raising=False)
    with pytest.raises(RuntimeError, match="safe tensor checkpoint"):
        module.load_rvc_checkpoint("model.pth")
    assert calls == [{"map_location": "cpu", "weights_only": True}]


def test_unsafe_rvc_checkpoint_requires_explicit_trust(checkpoint_module, monkeypatch):
    module, calls = checkpoint_module
    monkeypatch.setenv("VCCLIENT_TRUST_MODEL_PICKLES", "1")
    assert module.load_rvc_checkpoint("model.pth") == {"weight": {}}
    assert calls[-1] == {"map_location": "cpu", "weights_only": False}


def test_mmvc_and_sovits_loaders_enforce_trusted_checkpoint(checkpoint_module, monkeypatch, tmp_path):
    _, calls = checkpoint_module
    monkeypatch.delenv("VCCLIENT_TRUST_MODEL_PICKLES", raising=False)
    ckpt = tmp_path / "model.pth"
    ckpt.write_bytes(b"stub")

    scipy = ModuleType("scipy")
    scipy_interp = ModuleType("scipy.interpolate")
    scipy_interp.interp1d = lambda *a, **k: None
    scipy_io = ModuleType("scipy.io")
    scipy_wavfile = ModuleType("scipy.io.wavfile")
    scipy_wavfile.read = lambda *a, **k: (0, b"")
    monkeypatch.setitem(sys.modules, "scipy", scipy)
    monkeypatch.setitem(sys.modules, "scipy.interpolate", scipy_interp)
    monkeypatch.setitem(sys.modules, "scipy.io", scipy_io)
    monkeypatch.setitem(sys.modules, "scipy.io.wavfile", scipy_wavfile)

    from voice_changer.MMVCv13.TrainerFunctions import load_checkpoint as load_mmvc13
    from voice_changer.MMVCv15.client_modules import load_checkpoint as load_mmvc15
    from voice_changer.SoVitsSvc40.models.utils import load_checkpoint as load_sovits

    with pytest.raises(RuntimeError, match="safe tensor checkpoint"):
        load_mmvc13(str(ckpt), None)
    with pytest.raises(RuntimeError, match="safe tensor checkpoint"):
        load_mmvc15(str(ckpt), None)
    with pytest.raises(RuntimeError, match="safe tensor checkpoint"):
        load_sovits(str(ckpt), None)
    assert len(calls) == 3
    assert all(call == {"map_location": "cpu", "weights_only": True} for call in calls)
