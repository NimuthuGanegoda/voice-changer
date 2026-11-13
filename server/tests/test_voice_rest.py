import asyncio
import base64
import sys
import threading
import time
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from restapi.MMVC_Rest_VoiceChanger import MMVC_Rest_VoiceChanger, TTSRequest


@pytest.fixture
def api(tmp_path, monkeypatch):
    import restapi.MMVC_Rest_VoiceChanger as module
    monkeypatch.setattr(module, "SOUNDBOARD_DIR", str(tmp_path))
    calls = []
    manager = SimpleNamespace(
        play_sound=lambda name: calls.append(("play", name)) or True,
        stop_sounds=lambda: calls.append(("stop",)) or True,
        delete_sound=lambda name: calls.append(("delete", name)) or True,
        soundboard=SimpleNamespace(add_sound=lambda path: calls.append(("add", path)) or True),
        changeVoice=lambda audio: (audio, []),
    )
    handler = MMVC_Rest_VoiceChanger(manager)
    app = FastAPI()
    app.include_router(handler.router)
    return TestClient(app), handler, calls, module


def test_soundboard_stop_delete_and_play_routes(api):
    client, _, calls, _ = api
    assert client.post("/soundboard/stop").json()["status"] == "OK"
    assert client.post("/soundboard/delete", json={"filename": "clip.wav"}).status_code == 200
    assert client.post("/play_sound", json={"filename": "clip.wav"}).status_code == 200
    assert calls == [("stop",), ("delete", "clip.wav"), ("play", "clip.wav")]


def test_queue_full_is_a_conflict_not_a_silent_success(api, monkeypatch):
    client, handler, _, _ = api
    monkeypatch.setattr(handler.voiceChangerManager, "play_sound", lambda name: False)
    response = client.post("/play_sound", json={"filename": "clip.wav"})
    assert response.status_code == 409
    assert response.json()["status"] == "ERROR"


def test_pcm_endpoint_rejects_empty_odd_and_oversize_audio(api):
    client, _, _, _ = api
    assert client.post("/test", json={"timestamp": 1, "buffer": ""}).status_code == 422
    assert client.post("/test", json={"timestamp": 1, "buffer": base64.b64encode(b"x").decode()}).status_code == 400
    too_big = base64.b64encode(b"\0\0" * (512 * 1024 + 1)).decode()
    assert client.post("/test", json={"timestamp": 1, "buffer": too_big}).status_code == 400
    valid = base64.b64encode(np.array([1, -2], dtype="<i2").tobytes()).decode()
    response = client.post("/test", json={"timestamp": 7, "buffer": valid})
    assert response.status_code == 200
    assert response.json()["timestamp"] == 7
    assert np.frombuffer(base64.b64decode(response.json()["changedVoiceBase64"]), dtype="<i2").tolist() == [1, -2]


def test_soundboard_upload_limit_and_extension(api, monkeypatch):
    client, _, _, module = api
    monkeypatch.setattr(module, "MAX_SOUNDBOARD_BYTES", 4)
    assert client.post("/soundboard/upload", data={"filename": "clip.txt"}, files={"file": ("clip.txt", b"1234")}).status_code == 400
    assert client.post("/soundboard/upload", data={"filename": "clip.wav"}, files={"file": ("clip.wav", b"12345")}).status_code == 413
    assert client.post("/soundboard/upload", data={"filename": "clip.wav"}, files={"file": ("clip.wav", b"1234")}).status_code == 200


@pytest.fixture
def fake_tts(monkeypatch):
    module = ModuleType("pyttsx3")
    lock = threading.Lock()
    stats = SimpleNamespace(active=0, max_active=0, stopped=0)

    class Engine:
        def getProperty(self, name):
            if name == "voices":
                return [SimpleNamespace(id="voice-1", name="Test Voice", languages=[b"en"])]
        def setProperty(self, name, value):
            self.voice = value
        def save_to_file(self, text, path):
            with open(path, "wb") as out:
                out.write(text.encode())
        def runAndWait(self):
            with lock:
                stats.active += 1
                stats.max_active = max(stats.max_active, stats.active)
            time.sleep(0.02)
            with lock:
                stats.active -= 1
        def stop(self):
            stats.stopped += 1

    module.init = lambda *a, **k: Engine()
    monkeypatch.setitem(sys.modules, "pyttsx3", module)
    return stats


def test_tts_voices_and_unknown_voice(api, fake_tts):
    client, _, _, _ = api
    response = client.get("/tts/voices")
    assert response.status_code == 200
    assert response.json()["voices"] == [{"id": "voice-1", "name": "Test Voice", "languages": ["en"]}]
    assert client.post("/tts", json={"text": "hello", "voice": "missing"}).status_code == 400
    assert client.post("/tts", json={"text": "   "}).status_code == 400
    assert client.post("/tts", json={"text": "hello", "voice": "voice-1"}).status_code == 200


def test_tts_requests_are_serialized_and_temp_files_removed(api, fake_tts):
    _, handler, calls, _ = api
    async def scenario():
        return await asyncio.gather(
            handler.tts(TTSRequest(text="first")),
            handler.tts(TTSRequest(text="second")),
        )
    results = asyncio.run(scenario())
    assert all(result["status"] == "OK" for result in results)
    assert fake_tts.max_active == 1
    assert fake_tts.stopped >= 2
    assert len([call for call in calls if call[0] == "add"]) == 2
