import torch
from torch import device
from voice_changer.RVC.embedder.Embedder import Embedder


class FairseqHubert(Embedder):
    def loadModel(self, file: str, dev: device, isHalf: bool = True) -> Embedder:
        # Deferred: fairseq is an unmaintained, optional dependency (only needed for
        # this non-ONNX fallback embedder) that doesn't import on Python 3.11+, so it
        # must not break module import for callers who only use the ONNX embedder path.
        try:
            from fairseq import checkpoint_utils
        except ImportError as exc:
            raise RuntimeError("This legacy model needs Python 3.10 and pip install -r requirements-legacy.txt; prefer the ONNX embedder.") from exc
        from voice_changer.utils.TrustedCheckpoint import load_legacy_checkpoint

        super().setProps("hubert_base", file, dev, isHalf)
        state = load_legacy_checkpoint(file)
        models, saved_cfg, task = checkpoint_utils.load_model_ensemble_and_task([file], suffix="", state=state)
        model = models[0]
        model.eval()

        model = model.to(dev)
        if isHalf:
            model = model.half()

        self.model = model
        return self

    def extractFeatures(
        self, feats: torch.Tensor, embOutputLayer=9, useFinalProj=True
    ) -> torch.Tensor:
        padding_mask = torch.BoolTensor(feats.shape).to(self.dev).fill_(False)

        # オリジナル_v1は L9にfinal_projをかけていた。(-> 256)
        # オリジナル_v2は L12にfinal_projをかけない。(-> 768)

        inputs = {
            "source": feats.to(self.dev),
            "padding_mask": padding_mask,
            "output_layer": embOutputLayer,  # 9 or 12
        }

        with torch.no_grad():
            logits = self.model.extract_features(**inputs)
            if useFinalProj:
                feats = self.model.final_proj(logits[0])
            else:
                feats = logits[0]
        return feats
