"""Scoped compatibility loading for legacy Fairseq metadata, never a global torch patch."""
import argparse
import importlib
import os
from pathlib import Path, PosixPath, WindowsPath

import torch

_ALLOWED = {argparse.Namespace, PosixPath, WindowsPath}
_ALLOWED_PREFIXES = ("fairseq.", "omegaconf.")


def load_legacy_checkpoint(file: str):
    if os.getenv("VCCLIENT_TRUST_LEGACY_CHECKPOINTS") != "1":
        raise RuntimeError("Legacy Fairseq checkpoints require explicit trust. Use the ONNX embedder, or set VCCLIENT_TRUST_LEGACY_CHECKPOINTS=1 only for a checkpoint you trust.")
    allowed = list(_ALLOWED)
    for qualified in torch.serialization.get_unsafe_globals_in_checkpoint(file):
        module_name, _, name = qualified.rpartition(".")
        if not (module_name.startswith(_ALLOWED_PREFIXES) and ".." not in module_name):
            raise RuntimeError(f"legacy checkpoint contains an unsupported global: {qualified}; use ONNX instead")
        value = getattr(importlib.import_module(module_name), name)
        if not isinstance(value, type):
            raise RuntimeError(f"legacy checkpoint global is not a class: {qualified}")
        allowed.append(value)
    # The resulting state is passed to Fairseq so its internal weights_only=False
    # loader is not invoked. The allowlist is scoped to this load, not process-wide.
    with torch.serialization.safe_globals(allowed):
        return torch.load(file, map_location="cpu", weights_only=True)


def load_rvc_checkpoint(file: str, map_location: str = "cpu"):
    """Load plain RVC tensor checkpoints safely; unsafe pickles require explicit trust."""
    try:
        return torch.load(file, map_location=map_location, weights_only=True)
    except (FileNotFoundError, PermissionError):
        raise
    except Exception as exc:
        if os.getenv("VCCLIENT_TRUST_MODEL_PICKLES") != "1":
            raise RuntimeError(
                f"{file} could not be loaded as a safe tensor checkpoint. "
                "Re-export it with plain tensors/metadata, or set VCCLIENT_TRUST_MODEL_PICKLES=1 "
                "only for a checkpoint you trust."
            ) from exc
        return torch.load(file, map_location=map_location, weights_only=False)
