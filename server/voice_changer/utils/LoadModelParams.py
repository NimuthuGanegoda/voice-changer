from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from const import VoiceChangerType
from voice_changer.utils.ModelPaths import safe_filename, safe_relative_dir, validate_slot

LoadModelParamFileKind = Literal[
    "mmvcv13Config", "mmvcv13Model", "mmvcv15Config", "mmvcv15Model",
    "mmvcv15Correspondence", "soVitsSvc40Config", "soVitsSvc40Model",
    "soVitsSvc40Cluster", "rvcModel", "rvcIndex", "ddspSvcModel",
    "ddspSvcModelConfig", "ddspSvcDiffusion", "ddspSvcDiffusionConfig",
    "diffusionSVCModel", "beatriceModel", "llvcModel", "llvcConfig", "easyVCModel",
]


class LoadModelParamFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    kind: LoadModelParamFileKind
    dir: str = ""
    # Opaque flat upload key. The destination remains dir/name.
    uploadName: str | None = None

    @field_validator("name", "uploadName")
    @classmethod
    def validate_name(cls, value):
        return None if value is None else safe_filename(value)

    @field_validator("dir")
    @classmethod
    def validate_dir(cls, value):
        return safe_relative_dir(value)


class LoadModelParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    voiceChangerType: VoiceChangerType
    slot: int
    isSampleMode: bool
    sampleId: str = ""
    files: list[LoadModelParamFile] = Field(max_length=32)
    params: dict = Field(default_factory=dict)

    @field_validator("slot")
    @classmethod
    def validate_slot(cls, value):
        return validate_slot(value)

    @field_validator("sampleId", mode="before")
    @classmethod
    def normalize_sample_id(cls, value):
        return "" if value is None else value
