"""Pickle-based auxiliary model assets are opt-in, never silently trusted."""
import os
import pickle

import numpy as np


def _trust_enabled() -> bool:
    return os.getenv("VCCLIENT_TRUST_MODEL_PICKLES") == "1"


def load_numpy_dict(path: str):
    try:
        return np.load(path, allow_pickle=False).item()
    except ValueError as exc:
        if not _trust_enabled():
            raise RuntimeError(f"{path} requires pickle deserialization. Convert it to a plain array/JSON, or set VCCLIENT_TRUST_MODEL_PICKLES=1 only for a trusted model.") from exc
        return np.load(path, allow_pickle=True).item()


def load_pickle(path: str):
    if not _trust_enabled():
        raise RuntimeError(f"{path} is a pickle index. Set VCCLIENT_TRUST_MODEL_PICKLES=1 only for a trusted model.")
    with open(path, "rb") as source:
        return pickle.load(source)
