from __future__ import annotations

import os
import tempfile
import uuid

import torch

from const import UPLOAD_DIR
from voice_changer.RVC.modelMerger.MergeModel import merge_model
from voice_changer.utils.ModelMerger import ModelMerger, ModelMergerRequest
from voice_changer.utils.VoiceChangerParams import VoiceChangerParams


class RVCModelMerger(ModelMerger):
    @classmethod
    def merge_models(cls, params: VoiceChangerParams, request: ModelMergerRequest, storeSlot: int):
        merged = merge_model(params, request)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        # Never overwrite a fixed merged.pth while another import is reading it.
        fd, temporary = tempfile.mkstemp(prefix=".merge-", suffix=".pth", dir=UPLOAD_DIR)
        os.close(fd)
        target = os.path.join(UPLOAD_DIR, f"merge-{uuid.uuid4().hex}.pth")
        try:
            torch.save(merged, temporary)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return target
