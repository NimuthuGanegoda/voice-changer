"""Normalize checkpoint embedder labels without importing the ML runtime."""
from __future__ import annotations

from const import EmbedderType

_ALIASES = {
    "hubert": "hubert_base",
    "hubert_base": "hubert_base",
    "contentvec": "contentvec",
    "hubert_jp": "hubert-base-japanese",
    "hubert-base-japanese": "hubert-base-japanese",
    "whisper": "whisper",
}


def normalize_embedder(name: str) -> EmbedderType:
    if not isinstance(name, str):
        raise ValueError("embedder name must be a string")
    normalized = name.strip().lower()
    if normalized.endswith("768"):
        normalized = normalized[:-3]
    try:
        return _ALIASES[normalized]  # type: ignore[return-value]
    except KeyError:
        raise ValueError(f"unknown embedder: {name}") from None
