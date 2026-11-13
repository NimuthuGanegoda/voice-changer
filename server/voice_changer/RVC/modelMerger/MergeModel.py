from __future__ import annotations

import os
from collections import OrderedDict
from typing import Any

from voice_changer.ModelSlotManager import ModelSlotManager
from voice_changer.utils.ModelMerger import ModelMergerRequest, validate_merge_compatibility
from voice_changer.utils.ModelPaths import model_slot_path, resolve_under, safe_filename
from voice_changer.utils.TrustedCheckpoint import load_rvc_checkpoint
from voice_changer.utils.VoiceChangerParams import VoiceChangerParams


def merge_model(params: VoiceChangerParams, request: ModelMergerRequest) -> dict[str, Any]:
    request = ModelMergerRequest.model_validate(request)
    slot_manager = ModelSlotManager.get_instance(params.model_dir)
    weights: list[dict] = []
    checkpoints: list[dict] = []
    strengths: list[int] = []
    for element in request.files:
        slot = slot_manager.get_slot_info(element.slotIndex)
        if slot is None or slot.voiceChangerType != "RVC" or not getattr(slot, "modelFile", ""):
            raise ValueError(f"slot {element.slotIndex} does not contain an RVC model")
        if getattr(slot, "isONNX", False):
            raise ValueError("ONNX models cannot be merged; export the merged PyTorch model afterwards")
        filename = safe_filename(os.path.basename(slot.modelFile))
        path = resolve_under(model_slot_path(params.model_dir, element.slotIndex), filename, must_exist=True)
        checkpoint = load_rvc_checkpoint(str(path))
        if "model" in checkpoint:
            weight = {key: value for key, value in checkpoint["model"].items() if "enc_q" not in key}
        elif "weight" in checkpoint:
            weight = checkpoint["weight"]
        else:
            raise ValueError(f"slot {element.slotIndex} has neither model nor weight tensors")
        weights.append(weight)
        checkpoints.append(checkpoint)
        strengths.append(element.strength)

    validate_merge_compatibility(weights, checkpoints)
    total = sum(strengths)
    merged: dict[str, Any] = OrderedDict()
    merged["weight"] = OrderedDict()
    for key, tensor in weights[0].items():
        value = tensor * (strengths[0] / total)
        for weight, strength in zip(weights[1:], strengths[1:]):
            value = value + weight[key] * (strength / total)
        merged["weight"][key] = value
    # Metadata must describe every input, not whichever checkpoint happened to load last.
    for key in ("config", "params", "version", "sr", "f0", "info", "embedder_name", "embedder_output_layer"):
        if key in checkpoints[0]:
            merged[key] = checkpoints[0][key]
    return merged
