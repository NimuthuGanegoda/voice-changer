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
