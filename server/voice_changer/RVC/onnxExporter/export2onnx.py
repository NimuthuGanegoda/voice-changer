from voice_changer.utils.TrustedCheckpoint import load_rvc_checkpoint
import inspect
import os
import json
import numpy as np
import torch
import onnx
from onnx import TensorProto, helper, numpy_helper
from const import TMP_DIR, EnumInferenceTypes
from data.ModelSlot import RVCModelSlot
from voice_changer.RVC.deviceManager.DeviceManager import DeviceManager
from voice_changer.RVC.onnxExporter.SynthesizerTrnMs256NSFsid_ONNX import (
    SynthesizerTrnMs256NSFsid_ONNX,
)
from voice_changer.RVC.onnxExporter.SynthesizerTrnMs256NSFsid_nono_ONNX import (
    SynthesizerTrnMs256NSFsid_nono_ONNX,
)
from voice_changer.RVC.onnxExporter.SynthesizerTrnMs768NSFsid_ONNX import (
    SynthesizerTrnMs768NSFsid_ONNX,
)
from voice_changer.RVC.onnxExporter.SynthesizerTrnMs768NSFsid_nono_ONNX import (
    SynthesizerTrnMs768NSFsid_nono_ONNX,
)
from voice_changer.RVC.onnxExporter.SynthesizerTrnMsNSFsidNono_webui_ONNX import (
    SynthesizerTrnMsNSFsidNono_webui_ONNX,
)
from voice_changer.RVC.onnxExporter.SynthesizerTrnMsNSFsid_webui_ONNX import (
    SynthesizerTrnMsNSFsid_webui_ONNX,
)
from voice_changer.VoiceChangerParamsManager import VoiceChangerParamsManager


def export2onnx(gpu: int, modelSlot: RVCModelSlot):
    vcparams = VoiceChangerParamsManager.get_instance().params
    modelFile = os.path.join(vcparams.model_dir, str(modelSlot.slotIndex), os.path.basename(modelSlot.modelFile))

    os.makedirs(TMP_DIR, exist_ok=True)
    output_file = os.path.splitext(os.path.basename(modelFile))[0] + ".onnx"
    output_file_simple = os.path.splitext(os.path.basename(modelFile))[0] + "_simple.onnx"
    output_path = os.path.join(TMP_DIR, output_file)
    output_path_simple = os.path.join(TMP_DIR, output_file_simple)
    metadata = {
        "application": "VC_CLIENT",
        "version": "2.1",
        "modelType": modelSlot.modelType,
        "samplingRate": modelSlot.samplingRate,
        "f0": modelSlot.f0,
        "embChannels": modelSlot.embChannels,
        "embedder": modelSlot.embedder,
        "embOutputLayer": modelSlot.embOutputLayer,
        "useFinalProj": modelSlot.useFinalProj,
    }
    device_manager = DeviceManager.get_instance()
    gpuMomory = device_manager.getDeviceMemory(gpu)
    is_half = gpuMomory > 0 and device_manager.halfPrecisionAvailable(gpu)
    print(f"[Voice Changer] exporting onnx... gpu_id:{gpu} gpu_mem:{gpuMomory} is_half:{is_half}")

    if is_half:
        _export2onnx(modelFile, output_path, output_path_simple, True, metadata, gpu=gpu)
    else:
        print("[Voice Changer] Warning!!! onnx export with float32. maybe size is doubled.")
        _export2onnx(modelFile, output_path, output_path_simple, False, metadata, gpu=gpu)
    return output_file_simple


def _export2onnx(input_model, output_model, output_model_simple, is_half, metadata, gpu: int = 0):
    cpt = load_rvc_checkpoint(input_model)
    if is_half:
        dev = DeviceManager.get_instance().getDevice(gpu)
    else:
        dev = torch.device("cpu")

    # EnumInferenceTypesのままだとシリアライズできないのでテキスト化
    if metadata["modelType"] == EnumInferenceTypes.pyTorchRVC.value:
        net_g_onnx = SynthesizerTrnMs256NSFsid_ONNX(*cpt["config"], is_half=is_half)
    elif metadata["modelType"] == EnumInferenceTypes.pyTorchWebUI.value:
        net_g_onnx = SynthesizerTrnMsNSFsid_webui_ONNX(**cpt["params"], is_half=is_half)
    elif metadata["modelType"] == EnumInferenceTypes.pyTorchRVCNono.value:
        net_g_onnx = SynthesizerTrnMs256NSFsid_nono_ONNX(*cpt["config"])
    elif metadata["modelType"] == EnumInferenceTypes.pyTorchWebUINono.value:
        net_g_onnx = SynthesizerTrnMsNSFsidNono_webui_ONNX(**cpt["params"])
    elif metadata["modelType"] == EnumInferenceTypes.pyTorchRVCv2.value:
        net_g_onnx = SynthesizerTrnMs768NSFsid_ONNX(*cpt["config"], is_half=is_half)
    elif metadata["modelType"] == EnumInferenceTypes.pyTorchRVCv2Nono.value:
        net_g_onnx = SynthesizerTrnMs768NSFsid_nono_ONNX(*cpt["config"])
    else:
        raise ValueError(f"Unsupported modelType for ONNX export: {metadata['modelType']}")

    net_g_onnx.eval().to(dev)
    net_g_onnx.load_state_dict(cpt["weight"], strict=False)
    if is_half:
        net_g_onnx = net_g_onnx.half()
    
    featsLength = 64

    if is_half:
        feats = torch.HalfTensor(1, featsLength, metadata["embChannels"]).to(dev)
    else:
        feats = torch.FloatTensor(1, featsLength, metadata["embChannels"]).to(dev)
    p_len = torch.LongTensor([featsLength]).to(dev)
    sid = torch.LongTensor([0]).to(dev)

    if metadata["f0"] is True:
        pitch = torch.zeros(1, featsLength, dtype=torch.int64).to(dev)
        pitchf = torch.FloatTensor(1, featsLength).to(dev)
        input_names = ["feats", "p_len", "pitch", "pitchf", "sid"]
        inputs = (
            feats,
            p_len,
            pitch,
            pitchf,
            sid,
        )

    else:
        input_names = ["feats", "p_len", "sid"]
        inputs = (
            feats,
            p_len,
            sid,
        )

    output_names = [
        "audio",
    ]

    dynamic_axes = (
        {
            "feats": [1],
            "pitch": [1],
            "pitchf": [1],
        }
        if metadata["f0"] is True
        else {
            "feats": [1],
        }
    )

    export_kwargs = {
        "dynamic_axes": dynamic_axes,
        "do_constant_folding": False,
        "opset_version": 17,
        "verbose": False,
        "input_names": input_names,
        "output_names": output_names,
    }
    if "dynamo" in inspect.signature(torch.onnx.export).parameters:
        export_kwargs["dynamo"] = False

    prev_mkldnn = torch.backends.mkldnn.enabled
    try:
        if not is_half:
            torch.backends.mkldnn.enabled = False
        torch.onnx.export(
            net_g_onnx,
            inputs,
            output_model,
            **export_kwargs,
        )
    finally:
        torch.backends.mkldnn.enabled = prev_mkldnn

    model_onnx2 = onnx.load(output_model)
    try:
        from onnxsim import simplify

        model_simp, check = simplify(model_onnx2)
        if not check:
            model_simp = model_onnx2
    except Exception:
        model_simp = model_onnx2

    if not is_half:
        _compress_float32_initializers_to_fp16(model_simp)

    meta = model_simp.metadata_props.add()
    meta.key = "metadata"
    meta.value = json.dumps(metadata)
    onnx.save(model_simp, output_model_simple)


def _compress_float32_initializers_to_fp16(model: onnx.ModelProto, min_elements: int = 256) -> None:
    """Store large float32 weight tensors in float16 with a Cast-to-float32 node (~50% smaller file)."""
    existing_names = {init.name for init in model.graph.initializer}
    cast_nodes = []
    for init in model.graph.initializer:
        if init.data_type == TensorProto.FLOAT:
            arr = numpy_helper.to_array(init)
            if arr.size >= min_elements:
                orig_name = init.name
                fp16_name = f"{orig_name}_fp16"
                while fp16_name in existing_names:
                    fp16_name = f"_{fp16_name}"
                existing_names.add(fp16_name)
                init.name = fp16_name
                init.data_type = TensorProto.FLOAT16
                init.raw_data = arr.astype(np.float16).tobytes()
                del init.float_data[:]
                cast_nodes.append(
                    helper.make_node("Cast", inputs=[fp16_name], outputs=[orig_name], to=TensorProto.FLOAT)
                )
    for idx, node in enumerate(cast_nodes):
        model.graph.node.insert(idx, node)

