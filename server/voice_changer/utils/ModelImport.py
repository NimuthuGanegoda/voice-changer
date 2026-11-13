"""Rollback-safe import orchestration, independent of heavyweight ML imports."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

from voice_changer.utils.LoadModelParams import LoadModelParams
from voice_changer.utils.ModelPaths import ModelSlotTransaction, model_slot_path, resolve_under


def install_model(model_dir: str | Path, upload_dir: str | Path, params: LoadModelParams, generator, save_slot: Callable):
    params = LoadModelParams.model_validate(params)
    sources = []
    seen = set()
    for file in params.files:
        source = resolve_under(upload_dir, file.uploadName or file.name, must_exist=True)
        relative = str(Path(file.dir) / file.name) if file.dir else file.name
        if relative in seen:
            raise ValueError(f"duplicate model destination: {relative}")
        seen.add(relative)
        resolve_under(model_slot_path(model_dir, params.slot), file.dir, file.name)
        sources.append((file, source))
    if not sources:
        raise ValueError("model import contains no files")
    with ModelSlotTransaction(model_dir, params.slot) as transaction:
        for file, source in sources:
            staged = resolve_under(transaction.staging, file.dir, file.name)
            staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, staged)
        transaction.commit()
        slot_info = generator.loadModel(params)
        save_slot(params.slot, slot_info)
        transaction.finish()
    for _file, source in sources:
        source.unlink(missing_ok=True)
    return slot_info
