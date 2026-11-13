from pathlib import Path
import threading

from torch import device

from const import EmbedderType
from voice_changer.RVC.embedder.Embedder import Embedder
from voice_changer.RVC.embedder.FairseqContentvec import FairseqContentvec
from voice_changer.RVC.embedder.FairseqHubert import FairseqHubert
from voice_changer.RVC.embedder.FairseqHubertJp import FairseqHubertJp
from voice_changer.RVC.embedder.OnnxContentvec import OnnxContentvec
from voice_changer.RVC.embedder.Whisper import Whisper
from voice_changer.utils.VoiceChangerParams import VoiceChangerParams


class EmbedderManager:
    currentEmbedder: Embedder | None = None
    params: VoiceChangerParams
    _lock = threading.RLock()

    @classmethod
    def initialize(cls, params: VoiceChangerParams):
        with cls._lock:
            cls.params = params
            cls.currentEmbedder = None

    @classmethod
    def getEmbedder(cls, embedderType: EmbedderType, isHalf: bool, dev: device) -> Embedder:
        with cls._lock:
            current = cls.currentEmbedder
            if current is not None and current.matchCondition(embedderType) and Path(current.file).resolve() == Path(cls._weight_path(embedderType)).resolve() and current.dev == dev and current.isHalf == isHalf:
                return current
            # Publish only a fully initialized embedder; retain the old one on error.
            cls.currentEmbedder = cls.loadEmbedder(embedderType, isHalf, dev)
            return cls.currentEmbedder

    @classmethod
    def _weight_path(cls, embedderType: EmbedderType) -> str:
        if embedderType in ("hubert_base", "contentvec"):
            return cls.params.content_vec_500_onnx if cls.params.content_vec_500_onnx_on else cls.params.hubert_base
        if embedderType == "hubert-base-japanese":
            return cls.params.hubert_base_jp
        if embedderType == "whisper":
            return cls.params.whisper_tiny
        raise ValueError(f"unknown embedder type: {embedderType}")

    @classmethod
    def loadEmbedder(cls, embedderType: EmbedderType, isHalf: bool, dev: device) -> Embedder:
        if embedderType in ("hubert_base", "contentvec") and cls.params.content_vec_500_onnx_on:
            return OnnxContentvec().loadModel(cls.params.content_vec_500_onnx, dev)
        if embedderType == "hubert_base":
            return FairseqHubert().loadModel(cls.params.hubert_base, dev, isHalf)
        if embedderType == "hubert-base-japanese":
            return FairseqHubertJp().loadModel(cls.params.hubert_base_jp, dev, isHalf)
        if embedderType == "contentvec":
            return FairseqContentvec().loadModel(cls.params.hubert_base, dev, isHalf)
        if embedderType == "whisper":
            return Whisper().loadModel(cls.params.whisper_tiny, dev, isHalf)
        raise ValueError(f"unknown embedder type: {embedderType}")
