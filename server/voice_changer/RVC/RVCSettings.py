from dataclasses import dataclass, field
from voice_changer.utils.SettingValidation import finite_float, strict_int


@dataclass
class RVCSettings:
    gpu: int = -9999
    dstId: int = 0

    f0Detector: str = "rmvpe_onnx"  # dio or harvest
    tran: int = 12
    silentThreshold: float = 0.00001
    extraConvertSize: int = 1024 * 2

    indexRatio: float = 0
    protect: float = 0.5
    rvcQuality: int = 0
    silenceFront: int = 1  # 0:off, 1:on
    modelSamplingRate: int = 48000

    speakers: dict[str, int] = field(default_factory=lambda: {})
    intData = [
        "gpu", "dstId", "tran", "extraConvertSize", "rvcQuality", "silenceFront",
    ]
    floatData = ["silentThreshold", "indexRatio", "protect"]
    strData = ["f0Detector"]


_F0_DETECTORS = {"harvest", "dio", "crepe", "crepe_full", "crepe_tiny", "rmvpe", "rmvpe_onnx", "fcpe"}


def validate_rvc_setting(key: str, value) -> None:
    """Reject values that can allocate unbounded buffers or corrupt inference."""
    if key in RVCSettings.intData:
        number = strict_int(value, key)
        ranges = {
            "gpu": (-9999, 64), "dstId": (0, 9999), "tran": (-48, 48),
            "extraConvertSize": (0, 32768), "rvcQuality": (0, 1), "silenceFront": (0, 1),
        }
        low, high = ranges[key]
        if key == "gpu" and number < -1 and number != -9999:
            raise ValueError("gpu must be -9999 (auto), -1 (CPU), or a device index")
        if not low <= number <= high:
            raise ValueError(f"{key} must be between {low} and {high}")
    elif key in RVCSettings.floatData:
        number = finite_float(value, key)
        ranges = {"silentThreshold": (0.0, 0.1), "indexRatio": (0.0, 1.0), "protect": (0.0, 0.5)}
        low, high = ranges[key]
        if not low <= number <= high:
            raise ValueError(f"{key} must be between {low} and {high}")
    elif key == "f0Detector":
        if str(value) not in _F0_DETECTORS:
            raise ValueError(f"unknown f0 detector: {value}")
