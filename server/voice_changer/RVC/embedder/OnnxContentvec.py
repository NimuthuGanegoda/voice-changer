import torch
from torch import device
import onnxruntime

from voice_changer.RVC.deviceManager.DeviceManager import DeviceManager
from voice_changer.RVC.embedder.Embedder import Embedder


class OnnxContentvec(Embedder):
    def matchCondition(self, embedderType) -> bool:
        return embedderType in ("hubert_base", "contentvec")

    def loadModel(self, file: str, dev: device, isHalf: bool = False) -> Embedder:
        super().setProps("contentvec", file, dev, False)
        gpu_id = dev.index if getattr(dev, "index", None) is not None else -1
        providers, provider_options, session_options = DeviceManager.get_instance().getOnnxExecutionProvider(gpu_id)
        self.model = onnxruntime.InferenceSession(
            file,
            sess_options=session_options,
            providers=providers,
            provider_options=provider_options,
        )
        self.output_names = {out.name for out in self.model.get_outputs()}
        return self

    def extractFeatures(
        self, feats: torch.Tensor, embOutputLayer=9, useFinalProj=True
    ) -> torch.Tensor:
        if self.model is None:
            raise RuntimeError("OnnxContentvec model is not loaded")
        audio_np = feats.detach().to("cpu", dtype=torch.float32).numpy()
        if audio_np.ndim == 1:
            audio_np = audio_np[None, :]
        if (embOutputLayer == 9 or useFinalProj) and "units9" in self.output_names:
            target_output = "units9"
        elif "unit12" in self.output_names:
            target_output = "unit12"
        else:
            target_output = next(iter(self.output_names))
        features = self.model.run([target_output], {"audio": audio_np})[0]
        return torch.from_numpy(features).to(device=self.dev)
