import json
import os

import pytest

from data.ModelSlot import RVCModelSlot, saveSlotInfo
from voice_changer.ModelSlotManager import ModelSlotManager


@pytest.fixture
def manager(tmp_path):
    slot = RVCModelSlot(slotIndex=2, modelFile="model.pth", name="test")
    saveSlotInfo(str(tmp_path), 2, slot)
    (tmp_path / "2" / "model.pth").write_bytes(b"model")
    return ModelSlotManager(str(tmp_path))


def update(manager, key, value, slot=2):
    manager.update_model_info(json.dumps({"slot": slot, "key": key, "val": value}))


@pytest.mark.parametrize("key,value", [
    ("defaultTune", 49), ("defaultTune", 1.5), ("defaultTune", True),
    ("defaultKstep", 1001), ("defaultSpeedup", -1), ("defaultIndexRatio", 1.1),
    ("defaultProtect", 0.6), ("f0Factor", 0), ("noiseScale", float("nan")),
    ("modelFile", "other.pth"), ("termsOfUseUrl", "javascript:alert(1)"),
])
def test_slot_metadata_validation(manager, key, value):
    with pytest.raises(ValueError):
        update(manager, key, value)


def test_slot_metadata_save_keeps_index_and_refreshes_cache(manager):
    update(manager, "defaultTune", "12")
    assert manager.get_slot_info(2).slotIndex == 2
    assert manager.get_slot_info(2).defaultTune == 12
    update(manager, "speakers", json.dumps({"0": "target"}))
    assert manager.get_slot_info(2).speakers == {"0": "target"}


def test_delete_rolls_back_when_publishing_the_empty_slot_fails(manager, tmp_path, monkeypatch):
    import voice_changer.ModelSlotManager as module
    original = module.loadSlotInfo
    def fail(model_dir, slot):
        if slot == 2:
            raise RuntimeError("cannot publish empty slot")
        return original(model_dir, slot)
    monkeypatch.setattr(module, "loadSlotInfo", fail)
    with pytest.raises(RuntimeError):
        manager.delete_model_slot(2)
    assert (tmp_path / "2" / "model.pth").read_bytes() == b"model"
    assert manager.get_slot_info(2).voiceChangerType == "RVC"


def test_delete_cleanup_failure_does_not_restore_over_a_partial_backup(manager, tmp_path, monkeypatch):
    import voice_changer.ModelSlotManager as module
    def fail(path):
        raise OSError("cleanup failed")
    monkeypatch.setattr(module.shutil, "rmtree", fail)
    manager.delete_model_slot(2)
    assert not (tmp_path / "2").exists()
    assert manager.get_slot_info(2).voiceChangerType is None
    assert manager.get_slot_info(2).slotIndex == 2
    assert any(path.name.startswith(".backup-delete-2-") for path in tmp_path.iterdir())


def test_icon_assets_are_limited_to_images(manager, tmp_path, monkeypatch):
    import voice_changer.ModelSlotManager as module
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(module, "UPLOAD_DIR", str(uploads))
    (uploads / "icon.png").write_bytes(b"png")
    manager.store_model_assets(json.dumps({"slot": 2, "name": "iconFile", "file": "icon.png"}))
    assert manager.get_slot_info(2).iconFile == "icon.png"
    assert (tmp_path / "2" / "icon.png").exists()
    (uploads / "bad.svg").write_bytes(b"<svg/>")
    with pytest.raises(ValueError):
        manager.store_model_assets(json.dumps({"slot": 2, "name": "iconFile", "file": "bad.svg"}))
