import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from voice_changer.utils.LoadModelParams import LoadModelParams
from voice_changer.utils.ModelImport import install_model
from voice_changer.utils.ModelPaths import ModelSlotTransaction, UnsafePathError, resolve_under, validate_slot


def params(slot=3, files=None):
    return LoadModelParams(voiceChangerType="DDSP-SVC", slot=slot, isSampleMode=False, files=files if files is not None else [
        {"name": "model.pt", "kind": "ddspSvcModel", "dir": "model", "uploadName": "upload_model"},
        {"name": "config.yaml", "kind": "ddspSvcModelConfig", "dir": "model", "uploadName": "upload_config"},
    ], params={})


@pytest.mark.parametrize("slot", [-1, 500, True, "0", 1.5])
def test_invalid_slots(slot):
    with pytest.raises((ValidationError, UnsafePathError)):
        validate_slot(slot)
        params(slot=slot)


@pytest.mark.parametrize("directory", ["../escape", "/absolute", "model/../../escape", "C:\\escape", "a/b/c/d/e"])
def test_traversal_rejected_before_existing_slot_is_touched(tmp_path, directory):
    slot = tmp_path / "models" / "3"
    slot.mkdir(parents=True)
    (slot / "keep.txt").write_text("old")
    upload = tmp_path / "upload"
    upload.mkdir()
    (upload / "source").write_text("new")
    with pytest.raises(ValidationError):
        bad = params(files=[{"name": "model.pt", "kind": "ddspSvcModel", "dir": directory, "uploadName": "source"}])
        install_model(tmp_path / "models", upload, bad, None, None)
    assert (slot / "keep.txt").read_text() == "old"


def test_symlink_escape_rejected(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    root = tmp_path / "models"
    root.mkdir()
    (root / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(UnsafePathError):
        resolve_under(root, "link", "file")


def test_ddsp_directories_and_sources_consumed_only_on_success(tmp_path):
    upload = tmp_path / "upload"
    upload.mkdir()
    (upload / "upload_model").write_bytes(b"model")
    (upload / "upload_config").write_text("config")
    saved = {}
    generator = SimpleNamespace(loadModel=lambda request: {"slot": request.slot})
    install_model(tmp_path / "models", upload, params(), generator, lambda slot, info: saved.update({slot: info}))
    slot = tmp_path / "models" / "3"
    assert (slot / "model" / "model.pt").read_bytes() == b"model"
    assert (slot / "model" / "config.yaml").read_text() == "config"
    assert saved == {3: {"slot": 3}}
    assert not (upload / "upload_model").exists()


def test_failed_import_preserves_previous_slot_and_uploads(tmp_path):
    models = tmp_path / "models"
    slot = models / "3"
    slot.mkdir(parents=True)
    (slot / "params.json").write_text('{"old": true}')
    upload = tmp_path / "upload"
    upload.mkdir()
    (upload / "upload_model").write_text("new")
    (upload / "upload_config").write_text("new config")
    def broken(_params):
        raise RuntimeError("bad model")
    with pytest.raises(RuntimeError, match="bad model"):
        install_model(models, upload, params(), SimpleNamespace(loadModel=broken), lambda *_: None)
    assert json.loads((slot / "params.json").read_text()) == {"old": True}
    assert (upload / "upload_model").read_text() == "new"
    assert not list(models.glob(".import-*"))
    assert not list(models.glob(".backup-*"))


def test_metadata_failure_rolls_back(tmp_path):
    upload = tmp_path / "upload"
    upload.mkdir()
    (upload / "upload_model").write_text("new")
    (upload / "upload_config").write_text("config")
    models = tmp_path / "models"
    (models / "3").mkdir(parents=True)
    (models / "3" / "old").write_text("old")
    def save_failure(*_):
        raise OSError("disk full")
    with pytest.raises(OSError):
        install_model(models, upload, params(), SimpleNamespace(loadModel=lambda p: {}), save_failure)
    assert (models / "3" / "old").read_text() == "old"


def test_unfinished_transaction_rolls_back(tmp_path):
    with pytest.raises(RuntimeError, match="not finished"):
        with ModelSlotTransaction(tmp_path, 0) as tx:
            (tx.staging / "file").write_text("new")
            tx.commit()
    assert not (tmp_path / "0").exists()


def test_install_model_extracts_rvc_zip_bundle(tmp_path):
    import zipfile
    from voice_changer.utils.LoadModelParams import LoadModelParamFile, LoadModelParams

    upload = tmp_path / "upload"
    upload.mkdir()
    bundle = upload / "misa_bundle.zip"
    with zipfile.ZipFile(bundle, "w") as zf:
        zf.writestr("Misa/Misa_e350_s1050.pth", b"misa-pth")
        zf.writestr("Misa/added_IVF31_Flat_nprobe_1_Misa_v2.index", b"misa-index")

    models = tmp_path / "models"
    loaded_params = []
    saved = []

    def load_model(p):
        loaded_params.append(p)
        return SimpleNamespace(modelFile="Misa_e350_s1050.pth")

    install_model(
        models,
        upload,
        LoadModelParams(
            voiceChangerType="RVC",
            slot=1,
            isSampleMode=False,
            files=[LoadModelParamFile(name="Misa.zip", kind="rvcModel", dir="", uploadName="misa_bundle.zip")],
            params={"useIndex": True},
        ),
        SimpleNamespace(loadModel=load_model),
        lambda slot, info: saved.append((slot, info.modelFile)),
    )

    assert (models / "1" / "Misa_e350_s1050.pth").read_bytes() == b"misa-pth"
    assert (models / "1" / "added_IVF31_Flat_nprobe_1_Misa_v2.index").read_bytes() == b"misa-index"
    assert [f.name for f in loaded_params[0].files] == [
        "Misa_e350_s1050.pth",
        "added_IVF31_Flat_nprobe_1_Misa_v2.index",
    ]
    assert saved == [(1, "Misa_e350_s1050.pth")]
    assert not bundle.exists()
