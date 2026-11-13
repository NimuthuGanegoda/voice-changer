import io
import json
import threading
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from restapi.MMVC_Rest_Fileuploader import MMVC_Rest_Fileuploader
from restapi.mods.FileUploader import concat_file_chunks, sanitize_filename, upload_file


class FakeUpload:
    def __init__(self, data):
        self.file = io.BytesIO(data)


def test_chunked_upload_is_flat_and_atomic(tmp_path):
    uploads = tmp_path / "uploads"
    dest = tmp_path / "dest"
    data = b"abcdef"
    for index in range(3):
        upload_file(str(uploads), FakeUpload(data[index * 2:index * 2 + 2]), f"model/config.yaml_{index}", f"opaque1234_{index}")
    result = concat_file_chunks(str(uploads), "opaque1234", 3, str(dest), "config.yaml")
    assert (dest / result["name"]).read_bytes() == data
    assert not list(uploads.iterdir())
    assert not (dest / "model").exists()


def test_missing_chunk_does_not_truncate_existing_file(tmp_path):
    uploads = tmp_path / "uploads"
    dest = tmp_path / "dest"
    dest.mkdir()
    (dest / "model.pt").write_bytes(b"existing")
    upload_file(str(uploads), FakeUpload(b"new"), "model.pt_0", "opaque1234_0")
    try:
        concat_file_chunks(str(uploads), "opaque1234", 2, str(dest), "model.pt")
        assert False, "missing chunk accepted"
    except FileNotFoundError:
        pass
    assert (dest / "model.pt").read_bytes() == b"existing"
    assert (uploads / "opaque1234_0").exists()


def test_filename_sanitization():
    assert sanitize_filename("../../params.json") == "params.json"
    assert sanitize_filename("CON.txt") == "_CON.txt"
    assert "/" not in sanitize_filename("model\\config.yaml")


def api(tmp_path, monkeypatch):
    import restapi.MMVC_Rest_Fileuploader as module
    monkeypatch.setattr(module, "UPLOAD_DIR", str(tmp_path / "upload"))
    manager = SimpleNamespace(loadModel=lambda p: {"status": "OK", "slot": p.slot}, processingLock=threading.RLock())
    app = FastAPI()
    app.include_router(MMVC_Rest_Fileuploader(manager).router)
    return TestClient(app)


def test_api_rejects_invalid_slot_and_mismatch(tmp_path, monkeypatch):
    client = api(tmp_path, monkeypatch)
    payload = {"voiceChangerType": "RVC", "slot": 0, "isSampleMode": False, "files": [], "params": {}}
    response = client.post("/load_model", data={"slot": "not-an-int", "isHalf": "false", "params": json.dumps(payload)})
    assert response.status_code == 422  # FastAPI form coercion rejects before handler
    assert "detail" in response.json()
    response = client.post("/load_model", data={"slot": "1", "isHalf": "false", "params": json.dumps(payload)})
    assert response.status_code == 400


def test_api_upload_errors_are_not_empty_200(tmp_path, monkeypatch):
    client = api(tmp_path, monkeypatch)
    response = client.post("/concat_uploaded_file", data={"filename": "missing", "filenameChunkNum": "1"})
    assert response.status_code == 400
    assert response.json()["status"] == "ERROR"
    response = client.post("/upload_file", data={"filename": "large.bin"}, files={"file": ("large.bin", b"x" * (1024 * 1024 + 1))})
    assert response.status_code == 413
