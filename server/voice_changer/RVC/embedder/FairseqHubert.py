import torch
from torch import device
from voice_changer.RVC.embedder.Embedder import Embedder


class FairseqHubert(Embedder):
    def loadModel(self, file: str, dev: device, isHalf: bool = True) -> Embedder:
        # Deferred: fairseq is an unmaintained, optional dependency (only needed for
        # this non-ONNX fallback embedder) that doesn't import on Python 3.11+, so it
        # must not break module import for callers who only use the ONNX embedder path.
        from fairseq import checkpoint_utils

        super().setProps("hubert_base", file, dev, isHalf)

        # PyTorch 2.6 flipped torch.load's default to weights_only=True; fairseq's
        # checkpoint pickles a fairseq.data.dictionary.Dictionary object, which that
        # mode rejects. These are our own pinned download URLs (WeightDownloader.py),
        # not user-supplied files, so falling back to a full unpickle here is safe.
        _original_torch_load = torch.load
        try:
            torch.load = lambda *a, **kw: _original_torch_load(*a, **{**kw, "weights_only": False})
            models, saved_cfg, task = checkpoint_utils.load_model_ensemble_and_task(
                [file],
                suffix="",
            )
        finally:
            torch.load = _original_torch_load
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
