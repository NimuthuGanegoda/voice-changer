import json

import pytest

from voice_changer.utils.PresetManager import MAX_PRESETS, PresetManager


def test_preset_manager_save_reload_and_delete(tmp_path):
    store_path = tmp_path / "stored_presets.json"
    manager = PresetManager(store_path)
    assert manager.list_presets() == {}

    saved = manager.save_preset(
        "Yae Studio",
        {"tran": 4, "f0Detector": "rmvpe_onnx", "soundboardVolume": 0.75, "soundboardBypass": True},
    )
    assert saved["tran"] == 4
    assert saved["soundboardBypass"] is True
    assert store_path.exists()

    reloaded = PresetManager(store_path)
    assert reloaded.get_preset("Yae Studio") == saved
    assert "Yae Studio" in reloaded.list_presets()

    assert reloaded.delete_preset("Yae Studio") is True
    assert reloaded.list_presets() == {}
    with pytest.raises(KeyError):
        reloaded.get_preset("Yae Studio")


def test_preset_manager_rejects_unsafe_names_and_keys(tmp_path):
    manager = PresetManager(tmp_path / "presets.json")

    for bad_name in ("", "   ", ".", "..", "../escape", "bad/slash", "bad\\slash", "a" * 65, "bad\nname"):
        with pytest.raises(ValueError):
            manager.save_preset(bad_name, {"tran": 0})

    with pytest.raises(ValueError):
        manager.save_preset("empty", {})
    with pytest.raises(ValueError):
        manager.save_preset("disallowed", {"enableServerAudio": 1})
    with pytest.raises(ValueError):
        manager.save_preset("nan-val", {"soundboardVolume": float("nan")})
    with pytest.raises(ValueError):
        manager.save_preset("inf-val", {"soundboardVolume": float("inf")})
    with pytest.raises(ValueError):
        manager.save_preset("nested", {"tran": [1, 2]})


def test_preset_manager_enforces_cap_and_skips_corrupt_entries(tmp_path):
    store_path = tmp_path / "presets.json"
    manager = PresetManager(store_path)
    for i in range(MAX_PRESETS):
        manager.save_preset(f"preset-{i}", {"tran": i % 12})
    # Updating an existing preset at the cap is allowed.
    manager.save_preset("preset-0", {"tran": 6})
    with pytest.raises(ValueError):
        manager.save_preset("overflow-preset", {"tran": 1})

    # Corrupt entries in the JSON file are skipped without crashing startup.
    raw = json.loads(store_path.read_text(encoding="utf-8"))
    raw["../bad"] = {"tran": 1}
    raw["bad-key"] = {"unknownField": 123}
    store_path.write_text(json.dumps(raw), encoding="utf-8")

    reloaded = PresetManager(store_path)
    assert "../bad" not in reloaded.list_presets()
    assert "bad-key" not in reloaded.list_presets()
    assert reloaded.get_preset("preset-0") == {"tran": 6}
