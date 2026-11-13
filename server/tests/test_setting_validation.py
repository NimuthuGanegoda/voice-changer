import pytest

from voice_changer.RVC.RVCSettings import validate_rvc_setting
from voice_changer.utils.AudioSettings import updated_crossfade
from voice_changer.utils.SettingValidation import finite_float, strict_int


@pytest.mark.parametrize("value", [1.5, "1.5", True, float("nan"), float("inf"), None, object()])
def test_strict_int_rejects_truncation_and_non_numbers(value):
    with pytest.raises(ValueError):
        strict_int(value, "setting")


@pytest.mark.parametrize("value,expected", [(2, 2), (2.0, 2), (" 2 ", 2), ("-3", -3)])
def test_strict_int_accepts_exact_values(value, expected):
    assert strict_int(value, "setting") == expected


@pytest.mark.parametrize("value", [True, "x", None, float("nan"), float("inf")])
def test_finite_float_rejects_invalid(value):
    with pytest.raises(ValueError):
        finite_float(value, "setting")


@pytest.mark.parametrize("key,value", [
    ("extraConvertSize", 1.9), ("extraConvertSize", "1.9"), ("extraConvertSize", -1),
    ("extraConvertSize", 32769), ("tran", 49), ("gpu", -2), ("indexRatio", 1.1),
    ("protect", 0.6), ("silentThreshold", float("nan")), ("f0Detector", "unknown"),
])
def test_rvc_validation_rejects_bad_values(key, value):
    with pytest.raises(ValueError):
        validate_rvc_setting(key, value)


def test_rvc_validation_accepts_supported_detectors_and_zero_extra():
    validate_rvc_setting("extraConvertSize", 0)
    validate_rvc_setting("f0Detector", "crepe_tiny")
    validate_rvc_setting("indexRatio", 0)


def test_crossfade_fractional_overlap_is_not_truncated():
    settings = type("Settings", (), {"crossFadeOffsetRate": 0.1, "crossFadeEndRate": 0.9, "crossFadeOverlapSize": 1024})()
    with pytest.raises(ValueError):
        updated_crossfade(settings, "crossFadeOverlapSize", "1024.5")
    with pytest.raises(ValueError):
        updated_crossfade(settings, "crossFadeEndRate", True)
    assert updated_crossfade(settings, "crossFadeOverlapSize", "2048")[2] == 2048
