import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from const import RVCSampleMode, getSampleJsonAndModelIds
from data.ModelSample import ModelSamples, generateModelSample
from data.ModelSlot import DiffusionSVCModelSlot, RVCModelSlot
from downloader.CommunitySamples import get_community_rvc_samples
from downloader.Downloader import download_no_tqdm
from mods.log_control import VoiceChangaerLogger
from voice_changer.ModelSlotManager import ModelSlotManager
from voice_changer.utils.ModelPaths import ModelSlotTransaction, model_slot_path, safe_filename, validate_slot
from voice_changer.utils.RvcArchive import extract_rvc_zip

logger = VoiceChangaerLogger.get_instance().getLogger()
CATALOG_TTL = 24 * 60 * 60


def _url_filename(url: str, fallback: str = "download") -> str:
    name = Path(urlsplit(url).path).name
    return name or fallback


def _catalog_path(url: str, model_dir: str | None) -> Path:
    root = Path(model_dir or "model_downloads") / ".catalogs"
    return root / f"{hashlib.sha256(url.encode()).hexdigest()[:16]}-{_url_filename(url, 'catalog.json')}"


def _load_catalogs(mode: RVCSampleMode, model_dir: str | None = None, offline: bool = False) -> list[ModelSamples]:
    urls, _ = getSampleJsonAndModelIds(mode)
    samples = []
    for url in urls:
        path = _catalog_path(url, model_dir)
        fresh = path.is_file() and time.time() - path.stat().st_mtime < CATALOG_TTL
        if not fresh and not offline:
            try:
                download_no_tqdm({"url": url, "saveTo": str(path)})
            except Exception as exc:
                logger.warning("Sample catalog unavailable (%s): %s", url, exc)
        if not path.is_file():
            continue
        try:
            with path.open(encoding="utf-8") as source:
                catalog = json.load(source)
            for entries in catalog.values():
                samples.extend(generateModelSample(entry) for entry in entries)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            logger.warning("Invalid sample catalog %s: %s", path, exc)
    return samples


def getSampleInfos(mode: RVCSampleMode, model_dir: str | None = None, offline: bool = False):
    # /info must work offline and on a clean install with no catalog files.
    try:
        return _load_catalogs(mode, model_dir, offline)
    except Exception as exc:
        logger.warning("Could not load sample catalogs: %s", exc)
        return []


def get_available_samples(mode: RVCSampleMode, model_dir: str | None = None, offline: bool = False) -> list[ModelSamples]:
    """Return remote/cached sample catalogs merged with curated community RVC models."""
    samples = getSampleInfos(mode, model_dir, offline)
    if mode == "production" and not offline:
        seen = {sample.id for sample in samples}
        for sample in get_community_rvc_samples():
            if sample.id not in seen:
                samples.append(sample)
                seen.add(sample.id)
    return samples


def downloadInitialSamples(mode: RVCSampleMode, model_dir: str):
    root = Path(model_dir)
    if any((root / str(slot) / "params.json").is_file() for slot in range(500)):
        logger.info("[Voice Changer] Existing model slots found; skipping initial samples.")
        return
    _, initial = getSampleJsonAndModelIds(mode)
    samples = getSampleInfos(mode, model_dir)
    for slot, (sample_id, params) in enumerate(initial):
        try:
            _download_sample(samples, sample_id, model_dir, slot, params)
        except Exception as exc:
            logger.warning("Initial sample %s was not installed: %s", sample_id, exc)


def downloadSample(mode: RVCSampleMode, modelId: str, model_dir: str, slotIndex: int, params: Any):
    validate_slot(slotIndex)
    samples = _load_catalogs(mode, model_dir)
    if mode == "production":
        seen = {sample.id for sample in samples}
        for sample in get_community_rvc_samples():
            if sample.id not in seen:
                samples.append(sample)
                seen.add(sample.id)
    if not samples:
        raise RuntimeError("sample catalog is unavailable; try again when online")
    _download_sample(samples, modelId, model_dir, slotIndex, params or {})


def _download_sample(samples: list[ModelSamples], sample_id: str, model_dir: str, slot: int, params: Any):
    sample = next((item for item in samples if item.id == sample_id), None)
    if sample is None:
        raise ValueError(f"unknown sample: {sample_id}")
    if sample.voiceChangerType == "RVC":
        info = RVCModelSlot()
        info.isONNX = sample.modelUrl.lower().endswith(".onnx")
        info.defaultIndexRatio = 0
    elif sample.voiceChangerType == "Diffusion-SVC" and not sys.platform.startswith("darwin"):
        info = DiffusionSVCModelSlot()
        info.isONNX = sample.modelUrl.lower().endswith(".onnx")
        info.defaultKstep = 0
        info.defaultSpeedup = 0
        info.kStepMax = 0
    else:
        raise ValueError(f"unsupported sample backend: {sample.voiceChangerType}")
    info.slotIndex = slot
    info.sampleId = sample.id
    for field in ("credit", "description", "name", "termsOfUseUrl"):
        setattr(info, field, getattr(sample, field, ""))
    info.defaultTune = 0
    info.defaultProtect = 0.5
    manager = ModelSlotManager.get_instance(model_dir)
    with ModelSlotTransaction(model_dir, slot) as transaction:
        staging = transaction.staging
        is_zip_bundle = sample.voiceChangerType == "RVC" and sample.modelUrl.lower().split("?", 1)[0].endswith(".zip")
        if is_zip_bundle:
            bundle_path = staging / safe_filename(_url_filename(sample.modelUrl, "bundle.zip"))
            download_no_tqdm({"url": sample.modelUrl, "saveTo": str(bundle_path)})
            model_name, extracted_index = extract_rvc_zip(bundle_path, staging)
            bundle_path.unlink(missing_ok=True)
            info.modelFile = model_name
            info.isONNX = model_name.lower().endswith(".onnx")
            if isinstance(info, RVCModelSlot) and extracted_index:
                if params.get("useIndex"):
                    info.indexFile = extracted_index
                else:
                    (staging / extracted_index).unlink(missing_ok=True)
        else:
            info.modelFile = _url_filename(sample.modelUrl, "model.bin")
            download_no_tqdm({"url": sample.modelUrl, "saveTo": str(staging / info.modelFile)})
        if isinstance(info, RVCModelSlot) and not info.indexFile and params.get("useIndex") and getattr(sample, "indexUrl", ""):
            info.indexFile = _url_filename(sample.indexUrl, "model.index")
            download_no_tqdm({"url": sample.indexUrl, "saveTo": str(staging / info.indexFile)})
        icon_url = getattr(sample, "icon", "")
        if icon_url and icon_url.startswith(("http://", "https://")):
            info.iconFile = _url_filename(icon_url, "icon.png")
            download_no_tqdm({"url": icon_url, "saveTo": str(staging / info.iconFile)})
        transaction.commit()
        target = model_slot_path(model_dir, slot)
        if isinstance(info, RVCModelSlot):
            from voice_changer.RVC.RVCModelSlotGenerator import RVCModelSlotGenerator
            model_path = str(target / info.modelFile)
            info = RVCModelSlotGenerator._setInfoByONNX(model_path, info) if info.isONNX else RVCModelSlotGenerator._setInfoByPytorch(model_path, info)
        else:
            from voice_changer.DiffusionSVC.DiffusionSVCModelSlotGenerator import DiffusionSVCModelSlotGenerator
            info = DiffusionSVCModelSlotGenerator._setInfoByPytorch(info)
        manager.save_model_slot(slot, info)
        transaction.finish()
    manager.getAllSlotInfo(reload=True)
