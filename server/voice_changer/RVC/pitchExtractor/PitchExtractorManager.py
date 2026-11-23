from typing import Protocol
from const import PitchExtractorType
from voice_changer.RVC.pitchExtractor.PitchExtractor import PitchExtractor
from voice_changer.utils.VoiceChangerParams import VoiceChangerParams


class PitchExtractorManager(Protocol):
    currentPitchExtractor: PitchExtractor | None = None
    params: VoiceChangerParams

    @classmethod
    def initialize(cls, params: VoiceChangerParams):
        cls.params = params

    @classmethod
    def getPitchExtractor(
        cls, pitchExtractorType: PitchExtractorType, gpu: int
    ) -> PitchExtractor:
        cls.currentPitchExtractor = cls.loadPitchExtractor(pitchExtractorType,  gpu)
        return cls.currentPitchExtractor

    @classmethod
    def loadPitchExtractor(
        cls, pitchExtractorType: PitchExtractorType, gpu: int
    ) -> PitchExtractor:
        if pitchExtractorType == "harvest":
            from voice_changer.RVC.pitchExtractor.HarvestPitchExtractor import HarvestPitchExtractor

            return HarvestPitchExtractor()
        elif pitchExtractorType == "dio":
            from voice_changer.RVC.pitchExtractor.DioPitchExtractor import DioPitchExtractor

            return DioPitchExtractor()
        elif pitchExtractorType == "crepe":
            from voice_changer.RVC.pitchExtractor.CrepePitchExtractor import CrepePitchExtractor

            return CrepePitchExtractor(gpu)
        elif pitchExtractorType == "crepe_tiny":
            from voice_changer.RVC.pitchExtractor.CrepeOnnxPitchExtractor import CrepeOnnxPitchExtractor

            return CrepeOnnxPitchExtractor(pitchExtractorType, cls.params.crepe_onnx_tiny, gpu)
        elif pitchExtractorType == "crepe_full":
            from voice_changer.RVC.pitchExtractor.CrepeOnnxPitchExtractor import CrepeOnnxPitchExtractor

            return CrepeOnnxPitchExtractor(pitchExtractorType, cls.params.crepe_onnx_full, gpu)
        elif pitchExtractorType == "rmvpe":
            from voice_changer.RVC.pitchExtractor.RMVPEPitchExtractor import RMVPEPitchExtractor

            return RMVPEPitchExtractor(cls.params.rmvpe, gpu)
        elif pitchExtractorType == "rmvpe_onnx":
            from voice_changer.RVC.pitchExtractor.RMVPEOnnxPitchExtractor import RMVPEOnnxPitchExtractor

            return RMVPEOnnxPitchExtractor(cls.params.rmvpe_onnx, gpu)
        elif pitchExtractorType == "fcpe":
            from voice_changer.RVC.pitchExtractor.FcpePitchExtractor import FcpePitchExtractor

            return FcpePitchExtractor(gpu)
        else:
            from voice_changer.RVC.pitchExtractor.DioPitchExtractor import DioPitchExtractor

            print("[Voice Changer] PitchExctractor not found", pitchExtractorType)
            print("                fallback to dio")
            return DioPitchExtractor()
