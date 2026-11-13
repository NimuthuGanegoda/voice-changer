"""Validation shared by both real-time crossfade implementations."""
import math


def validate_crossfade(offset: float, end: float, overlap: int):
    values = (offset, end, overlap)
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError("crossfade values must be finite numbers")
    if not 0 <= offset < end <= 1:
        raise ValueError("crossfade rates must satisfy 0 <= start < end <= 1")
    if isinstance(overlap, float) and not overlap.is_integer():
        raise ValueError("crossfade overlap must be an integer")
    if not 1 <= overlap <= 192000:
        raise ValueError("crossfade overlap must be between 1 and 192000 samples")


def apply_crossfade(settings, offset: float, end: float, overlap: int):
    validate_crossfade(offset, end, overlap)
    settings.crossFadeOffsetRate = float(offset)
    settings.crossFadeEndRate = float(end)
    settings.crossFadeOverlapSize = int(overlap)


def updated_crossfade(settings, key: str, value):
    from voice_changer.utils.SettingValidation import finite_float, strict_int

    offset = finite_float(value, key) if key == "crossFadeOffsetRate" else settings.crossFadeOffsetRate
    end = finite_float(value, key) if key == "crossFadeEndRate" else settings.crossFadeEndRate
    overlap = strict_int(value, key) if key == "crossFadeOverlapSize" else settings.crossFadeOverlapSize
    validate_crossfade(offset, end, overlap)
    return offset, end, int(overlap)
