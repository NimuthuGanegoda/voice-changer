from __future__ import annotations
import asyncio
import json
import logging
from typing import Optional, Union, TYPE_CHECKING

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from const import MODEL_DIR, UPLOAD_DIR
from restapi.mods.FileUploader import concat_file_chunks, upload_file
from voice_changer.utils.LoadModelParams import LoadModelParamFile, LoadModelParams
if TYPE_CHECKING:
    from voice_changer.VoiceChangerManager import VoiceChangerManager

logger = logging.getLogger(__name__)


class FileTooLarge(ValueError):
    pass


class LimitedUploadFile:
    """Bound actual chunk bytes, not the untrusted multipart Content-Length."""
    def __init__(self, source, limit: int = 1024 * 1024):
        self.source = source
        self.limit = limit
        self.file = self
        self.remaining = limit

    def read(self, size=-1):
        if self.remaining <= 0:
            extra = self.source.file.read(min(size, 1) if size >= 0 else 1)
            if extra:
                raise FileTooLarge(f"upload chunk exceeds {self.limit} bytes")
            return b""
        amount = min(size, self.remaining) if size >= 0 else self.remaining
        chunk = self.source.file.read(amount)
        self.remaining -= len(chunk)
        return chunk


def failure(exc: Exception, operation: str):
    status = 413 if isinstance(exc, FileTooLarge) else 400 if isinstance(exc, (ValueError, KeyError, FileNotFoundError)) else 500
    logger.exception("[REST] %s failed", operation)
    return JSONResponse({"status": "ERROR", "msg": str(exc), "operation": operation}, status_code=status)


class MMVC_Rest_Fileuploader:
    def __init__(self, voiceChangerManager: VoiceChangerManager):
        self.voiceChangerManager = voiceChangerManager
        self.load_lock = asyncio.Lock()
        self.router = APIRouter()
        self.router.add_api_route("/info", self.get_info, methods=["GET"])
        self.router.add_api_route("/performance", self.get_performance, methods=["GET"])
        self.router.add_api_route("/upload_file", self.post_upload_file, methods=["POST"])
        self.router.add_api_route("/concat_uploaded_file", self.post_concat_uploaded_file, methods=["POST"])
        self.router.add_api_route("/update_settings", self.post_update_settings, methods=["POST"])
        self.router.add_api_route("/load_model", self.post_load_model, methods=["POST"])
        self.router.add_api_route("/onnx", self.get_onnx, methods=["GET"])
        self.router.add_api_route("/merge_model", self.post_merge_models, methods=["POST"])
        self.router.add_api_route("/update_model_default", self.post_update_model_default, methods=["POST"])
        self.router.add_api_route("/update_model_info", self.post_update_model_info, methods=["POST"])
        self.router.add_api_route("/upload_model_assets", self.post_upload_model_assets, methods=["POST"])
        self.router.add_api_route("/delete_model", self.post_delete_model, methods=["POST"])
        self.router.add_api_route("/model_type", self.get_model_type, methods=["GET"])

    def _response(self, value, operation: str):
        try:
            return JSONResponse(jsonable_encoder(value))
        except Exception as exc:
            return failure(exc, operation)

    def get_info(self):
        return self._response(self.voiceChangerManager.get_info(), "info")

    def get_performance(self):
        return self._response(self.voiceChangerManager.get_performance(), "performance")

    def post_upload_file(self, file: UploadFile = File(...), filename: str = Form(...), upload_id: Optional[str] = Form(None)):
        try:
            return upload_file(UPLOAD_DIR, LimitedUploadFile(file), filename, upload_id)
        except Exception as exc:
            return failure(exc, "upload_file")

    def post_concat_uploaded_file(self, filename: str = Form(...), filenameChunkNum: int = Form(...), original_filename: Optional[str] = Form(None), upload_id: Optional[str] = Form(None)):
        try:
            # Assemble into the staging directory, not the live model directory.
            # load_model atomically installs the files under the chosen slot.
            return concat_file_chunks(UPLOAD_DIR, upload_id or filename, filenameChunkNum, UPLOAD_DIR, original_filename)
        except Exception as exc:
            return failure(exc, "concat_uploaded_file")

    def post_update_settings(self, key: str = Form(...), val: Union[int, str, float] = Form(...)):
        try:
            return JSONResponse(jsonable_encoder(self.voiceChangerManager.update_settings(key, val)))
        except Exception as exc:
            return failure(exc, "update_settings")

    async def post_load_model(self, slot: int = Form(...), isHalf: bool = Form(...), params: str = Form(...)):
        try:
            params = LoadModelParams.model_validate(json.loads(params))
            if params.slot != slot:
                raise ValueError("form slot does not match JSON slot")
            params.files = [LoadModelParamFile.model_validate(file) for file in params.files]
            async with self.load_lock:
                result = await asyncio.to_thread(self.voiceChangerManager.loadModel, params)
            return JSONResponse(jsonable_encoder(result if result is not None else {"status": "OK"}))
        except Exception as exc:
            return failure(exc, "load_model")

    def get_onnx(self):
        try:
            return JSONResponse(jsonable_encoder(self.voiceChangerManager.export2onnx()))
        except Exception as exc:
            return failure(exc, "onnx")

    def post_merge_models(self, request: str = Form(...)):
        return self._response(self.voiceChangerManager.merge_models(request), "merge_model")

    def post_update_model_default(self):
        return self._response(self.voiceChangerManager.update_model_default(), "update_model_default")

    def post_update_model_info(self, newData: str = Form(...)):
        return self._response(self.voiceChangerManager.update_model_info(newData), "update_model_info")

    def post_upload_model_assets(self, params: str = Form(...)):
        return self._response(self.voiceChangerManager.upload_model_assets(params), "upload_model_assets")

    def post_delete_model(self, slot: int = Form(...)):
        try:
            return JSONResponse(jsonable_encoder(self.voiceChangerManager.delete_model(slot)))
        except Exception as exc:
            return failure(exc, "delete_model")

    def get_model_type(self):
        return self._response(self.voiceChangerManager.get_info(), "model_type")
