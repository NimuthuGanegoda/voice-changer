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
