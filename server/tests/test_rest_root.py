import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import restapi.MMVC_Rest as module
    monkeypatch.chdir(tmp_path)
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / "index.html").write_text("<html>voice changer</html>")
    for name in ("UPLOAD_DIR", "TMP_DIR", "MODEL_DIR_STATIC"):
        path = tmp_path / name.lower()
        path.mkdir()
        monkeypatch.setattr(module, name, str(path))
    monkeypatch.setattr(module, "getFrontendPath", lambda: str(frontend))
    manager = SimpleNamespace(
        voiceChanger=None,
        serverDevice=SimpleNamespace(settings=SimpleNamespace(serverAudioStated=0)),
        startedAt=time.monotonic() - 5,
        delete_model=lambda slot: {"status": "OK", "deleted": slot},
        get_info=lambda: {"status": "OK", "voiceChangerType": "RVC"},
    )
    params = SimpleNamespace(model_dir="model_dir")
    module.MMVC_Rest._instance = None
    app = module.MMVC_Rest.get_instance(manager, params)
    yield TestClient(app)
    module.MMVC_Rest._instance = None


def test_root_serves_the_built_frontend_and_health_is_public(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "voice changer" in response.text
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["modelLoaded"] is False
    assert health.json()["serverAudioStarted"] is False
    assert health.json()["uptimeSeconds"] >= 0


def test_model_delete_and_legacy_model_type_routes_exist(client):
    response = client.post("/delete_model", data={"slot": "3"})
    assert response.status_code == 200
    assert response.json()["deleted"] == 3
    assert client.get("/model_type").json()["voiceChangerType"] == "RVC"


def test_validation_error_with_binary_body_returns_422_and_no_unfrozen_tmpdir(client):
    import const
    import sys

    if not hasattr(sys, "_MEIPASS"):
        assert const.tmpdir is None
    response = client.post("/delete_model", content=b"\xff\xfe\xfa", headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_validation_error_route_handles_non_utf8_and_form_bodies():
    from fastapi import FastAPI, Form
    from pydantic import BaseModel
    from restapi.MMVC_Rest import ValidationErrorLoggingRoute

    class Payload(BaseModel):
        value: int

    app = FastAPI()
    app.router.route_class = ValidationErrorLoggingRoute

    @app.post("/check_json")
    def check_json(payload: Payload):
        return {"value": payload.value}

    @app.post("/check_form")
    def check_form(value: int = Form(...)):
        return {"value": value}

    bin_res = TestClient(app).post(
        "/check_json",
        content=b"\xff\xfe\xfd",
        headers={"content-type": "application/octet-stream"},
    )
    assert bin_res.status_code == 422
    assert "errors" in bin_res.json()["detail"]
    assert "\ufffd" in bin_res.json()["detail"]["body"]

    form_res = TestClient(app).post(
        "/check_form",
        content=b"other=\xff\xfe\xfd",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert form_res.status_code == 422
    assert "errors" in form_res.json()["detail"]


def test_upload_dir_is_not_exposed_over_http(client, tmp_path):
    upload = tmp_path / "upload_dir"
    (upload / "xss.html").write_text("<script>alert(1)</script>")
    response = client.get("/upload_dir/xss.html")
    assert response.status_code == 404
    assert response.headers.get("x-content-type-options") == "nosniff"
