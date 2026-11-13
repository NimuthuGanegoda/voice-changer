from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from voice_changer.utils.ModelMerger import ModelMergerRequest, validate_merge_compatibility
from voice_changer.RVC.embedder.EmbedderNames import normalize_embedder


def tensor(shape=(2, 2), dtype="float32"):
    return SimpleNamespace(shape=shape, dtype=dtype)


def checkpoint(sr="40000", info="model"):
    return {"config": [1, 2], "sr": sr, "f0": 1, "info": info}


def test_merge_request_rejects_invalid_weights_and_duplicates():
    with pytest.raises(ValidationError):
        ModelMergerRequest(voiceChangerType="RVC", command="mix", files=[{"slotIndex": 1, "strength": 0}])
    with pytest.raises(ValidationError):
        ModelMergerRequest(voiceChangerType="RVC", command="mix", files=[{"slotIndex": 1, "strength": 1.5}])
    with pytest.raises(ValidationError):
        ModelMergerRequest(voiceChangerType="RVC", command="mix", files=[{"slotIndex": 1, "strength": 1}, {"slotIndex": 1, "strength": 2}])
    with pytest.raises(ValidationError):
        ModelMergerRequest(voiceChangerType="RVC", command="average", files=[{"slotIndex": 1, "strength": 1}])


def test_merge_compatibility_checks_shapes_dtypes_and_metadata():
    weights = [{"a": tensor()}, {"a": tensor()}]
    checkpoints = [checkpoint(), checkpoint()]
    validate_merge_compatibility(weights, checkpoints)
    with pytest.raises(ValueError, match="shape"):
        validate_merge_compatibility([{"a": tensor()}, {"a": tensor((3, 2))}], checkpoints)
    with pytest.raises(ValueError, match="dtype"):
        validate_merge_compatibility([{"a": tensor()}, {"a": tensor(dtype="float16")}], checkpoints)
    with pytest.raises(ValueError, match="metadata"):
        validate_merge_compatibility(weights, [checkpoint(), checkpoint(sr="48000")])
    with pytest.raises(ValueError, match="metadata"):
        validate_merge_compatibility(weights, [checkpoint(), {**checkpoint(), "embedder_name": "contentvec"}])


@pytest.mark.parametrize("name,expected", [
    ("contentvec", "contentvec"), ("contentvec768", "contentvec"),
    ("hubert", "hubert_base"), ("hubert_jp", "hubert-base-japanese"),
    ("whisper", "whisper"),
])
def test_embedder_names_normalize_without_the_misbound_else(name, expected):
    assert normalize_embedder(name) == expected


def test_unknown_embedder_is_rejected():
    with pytest.raises(ValueError):
        normalize_embedder("unknown")
