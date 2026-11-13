from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator

from const import MAX_SLOT_NUM, VoiceChangerType
from voice_changer.utils.ModelPaths import validate_slot


class MergeElement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slotIndex: int = Field(strict=True, ge=0, lt=MAX_SLOT_NUM)
    strength: int = Field(strict=True, ge=1, le=100)

    @field_validator("slotIndex")
    @classmethod
    def _slot(cls, value: int) -> int:
        return validate_slot(value)


class ModelMergerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    voiceChangerType: VoiceChangerType
    command: Literal["mix"]
    files: list[MergeElement] = Field(min_length=1, max_length=MAX_SLOT_NUM)

    @field_validator("files")
    @classmethod
    def _unique_slots(cls, values: list[MergeElement]) -> list[MergeElement]:
        slots = [value.slotIndex for value in values]
        if len(slots) != len(set(slots)):
            raise ValueError("a model slot may only be merged once")
        return values


_METADATA_KEYS = ("config", "params", "version", "sr", "f0", "info", "embedder_name", "embedder_output_layer")
_REQUIRED_METADATA = ("config", "sr", "f0")
_MISSING = object()


def validate_merge_compatibility(weights: list[dict], checkpoints: list[dict]) -> None:
    """Reject incompatible tensors/metadata before allocating or writing a merge."""
    if not weights or len(weights) != len(checkpoints):
        raise ValueError("no model checkpoints to merge")
    reference = weights[0]
    if not reference:
        raise ValueError("model checkpoint contains no weights")
    for index, weight in enumerate(weights[1:], start=1):
        if weight.keys() != reference.keys():
            raise ValueError(f"model {index} has different weight keys")
        for key, tensor in reference.items():
            other = weight[key]
            if getattr(tensor, "shape", None) != getattr(other, "shape", None):
                raise ValueError(f"model {index} has a different shape for {key}")
            if getattr(tensor, "dtype", None) != getattr(other, "dtype", None):
                raise ValueError(f"model {index} has a different dtype for {key}")
    base = checkpoints[0]
    for key in _REQUIRED_METADATA:
        if key not in base:
            raise ValueError(f"model checkpoint is missing metadata: {key}")
    for key in _METADATA_KEYS:
        values = [checkpoint.get(key, _MISSING) for checkpoint in checkpoints]
        if any(value is _MISSING for value in values):
            if any(value is not _MISSING for value in values):
                raise ValueError(f"model checkpoints disagree on metadata presence: {key}")
            continue
        if any(value != values[0] for value in values[1:]):
            raise ValueError(f"model checkpoints have incompatible metadata: {key}")


class ModelMerger(Protocol):
    @classmethod
    def merge_models(cls, request: ModelMergerRequest):
        ...
