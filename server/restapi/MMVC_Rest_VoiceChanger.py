from __future__ import annotations

import asyncio
import base64
import os
import sys
import tempfile
from typing import TYPE_CHECKING

import numpy as np
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from const import SOUNDBOARD_DIR
from restapi.MMVC_Rest_Fileuploader import LimitedUploadFile, failure
from restapi.mods.FileUploader import upload_file

if TYPE_CHECKING:
    from voice_changer.VoiceChangerManager import VoiceChangerManager

MAX_SOUNDBOARD_BYTES = 20 * 1024 * 1024
SOUNDBOARD_EXTENSIONS = {".wav", ".mp3", ".ogg", ".flac", ".m4a"}
MAX_TTS_CHARS = 500


class VoiceModel(BaseModel):
    timestamp: int
    buffer: str = Field(min_length=1, max_length=1_400_000)


class SoundRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    # Empty = use the OS default voice. Otherwise an id/name returned by /tts/voices.
    voice: str = Field(default="", max_length=255)


class MMVC_Rest_VoiceChanger:
    def __init__(self, voiceChangerManager: VoiceChangerManager):
        self.voiceChangerManager = voiceChangerManager
        self.router = APIRouter()
        self.router.add_api_route("/test", self.test, methods=["POST"])
        self.router.add_api_route("/play_sound", self.play_sound, methods=["POST"])
        self.router.add_api_route("/soundboard/list", self.soundboard_list, methods=["GET"])
        self.router.add_api_route("/soundboard/upload", self.soundboard_upload, methods=["POST"])
        self.router.add_api_route("/soundboard/stop", self.soundboard_stop, methods=["POST"])
        self.router.add_api_route("/soundboard/delete", self.soundboard_delete, methods=["POST"])
        self.router.add_api_route("/tts/voices", self.tts_voices, methods=["GET"])
        self.router.add_api_route("/tts", self.tts, methods=["POST"])
        self.router.add_api_route("/device_setup/status", self.device_setup_status, methods=["GET"])
        # pyttsx3/OS speech engines are not safe to drive concurrently.
        self.tts_lock = asyncio.Lock()

    async def device_setup_status(self):
        """Detect a system-wide virtual audio cable/mic for this OS."""
        try:
            from voice_changer.Local.AudioDeviceList import list_audio_device

            audioinput, audiooutput = await asyncio.to_thread(list_audio_device)
            if sys.platform.startswith("win"):
                platformName = "windows"
                playbackDevices = [{"index": d.index, "name": d.name} for d in audiooutput if "CABLE Input" in d.name]
                recordingDevices = [{"index": d.index, "name": d.name} for d in audioinput if "CABLE Output" in d.name]
                installUrl = "https://vb-audio.com/Cable/"
                hint = "Install VB-Cable (or run setup_virtual_mic_windows.ps1), restart VCClient, then set server output to 'CABLE Input' and select 'CABLE Output' as microphone in your app."
            elif sys.platform.startswith("darwin"):
                platformName = "macos"
                playbackDevices = [{"index": d.index, "name": d.name} for d in audiooutput if "BlackHole" in d.name]
                recordingDevices = [{"index": d.index, "name": d.name} for d in audioinput if "BlackHole" in d.name]
                installUrl = "https://github.com/ExistentialAudio/BlackHole"
                hint = "Install BlackHole (brew install blackhole-2ch), restart VCClient, then set server output to 'BlackHole' and select 'BlackHole' as microphone in your app."
            else:
                platformName = "linux"
                playbackDevices = [{"index": d.index, "name": d.name} for d in audiooutput if "VoiceChangerMic" in d.name]
                recordingDevices = [{"index": d.index, "name": d.name} for d in audioinput if "VoiceChangerMic" in d.name]
                installUrl = None
                hint = "Run 'bash setup_virtual_mic_linux.sh --autostart' from the repo root, restart VCClient, then set server output to 'VoiceChangerMic' and select 'Monitor of VoiceChangerMic' as microphone in your app."
            installed = len(playbackDevices) > 0
            return {
                "status": "OK",
                "platform": platformName,
                "virtualCableInstalled": installed,
                "cablePlaybackDevices": playbackDevices,
                "cableRecordingDevices": recordingDevices,
                "installUrl": None if installed else installUrl,
                "hint": None if installed else hint,
            }
        except Exception as exc:
            return failure(exc, "device_setup_status")

    async def play_sound(self, request: SoundRequest):
        try:
            res = await asyncio.to_thread(self.voiceChangerManager.play_sound, request.filename)
            if not res:
                return JSONResponse({"status": "ERROR", "msg": "soundboard queue is full or the clip could not be decoded"}, status_code=409)
            return {"status": "OK"}
        except Exception as exc:
            return failure(exc, "play_sound")

    async def soundboard_list(self):
        try:
            def list_files():
                os.makedirs(SOUNDBOARD_DIR, exist_ok=True)
                return sorted(f for f in os.listdir(SOUNDBOARD_DIR) if os.path.isfile(os.path.join(SOUNDBOARD_DIR, f)))
            return {"status": "OK", "files": await asyncio.to_thread(list_files)}
        except Exception as exc:
            return failure(exc, "soundboard_list")

    async def soundboard_upload(self, file: UploadFile = File(...), filename: str = Form(..., max_length=255)):
        try:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in SOUNDBOARD_EXTENSIONS:
                raise ValueError(f"unsupported file type {ext}")
            if file.size is not None and file.size > MAX_SOUNDBOARD_BYTES:
                from restapi.MMVC_Rest_Fileuploader import FileTooLarge
                raise FileTooLarge("file too large (20MB limit)")
            return await asyncio.to_thread(upload_file, SOUNDBOARD_DIR, LimitedUploadFile(file, MAX_SOUNDBOARD_BYTES), filename)
        except Exception as exc:
            return failure(exc, "soundboard_upload")

    async def soundboard_stop(self):
        try:
            await asyncio.to_thread(self.voiceChangerManager.stop_sounds)
            return {"status": "OK"}
        except Exception as exc:
            return failure(exc, "soundboard_stop")

    async def soundboard_delete(self, request: SoundRequest):
        try:
            await asyncio.to_thread(self.voiceChangerManager.delete_sound, request.filename)
            return {"status": "OK"}
        except Exception as exc:
            return failure(exc, "soundboard_delete")

    async def tts_voices(self):
        try:
            import pyttsx3

            def list_voices():
                engine = pyttsx3.init()
                try:
                    return [
                        {"id": v.id, "name": v.name, "languages": [x.decode(errors="replace") if isinstance(x, bytes) else str(x) for x in (v.languages or [])]}
                        for v in engine.getProperty("voices")
                    ]
                finally:
                    engine.stop()

            async with self.tts_lock:
                return {"status": "OK", "voices": await asyncio.to_thread(list_voices)}
        except Exception as exc:
            return failure(exc, "tts_voices")

    async def tts(self, request: TTSRequest):
        text = request.text.strip()
        if not text:
            return JSONResponse({"status": "ERROR", "msg": "text must not be empty"}, status_code=400)
        try:
            import pyttsx3

            fd, path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

            def synthesize():
                engine = pyttsx3.init()
                try:
                    if request.voice:
                        wanted = request.voice.lower()
                        match = next((v for v in engine.getProperty("voices") if wanted == (v.id or "").lower() or wanted in (v.name or "").lower()), None)
                        if match is None:
                            raise ValueError(f"unknown TTS voice: {request.voice}")
                        engine.setProperty("voice", match.id)
                    engine.save_to_file(text, path)
                    engine.runAndWait()
                finally:
                    engine.stop()

            try:
                async with self.tts_lock:
                    await asyncio.to_thread(synthesize)
                    ok = await asyncio.to_thread(self.voiceChangerManager.soundboard.add_sound, path)
            finally:
                os.unlink(path)
            if ok:
                return {"status": "OK"}
            return JSONResponse({"status": "ERROR", "msg": "soundboard queue is full or speech synthesis produced no audio"}, status_code=409)
        except Exception as exc:
            return failure(exc, "tts")

    async def test(self, voice: VoiceModel):
        try:
            wav = base64.b64decode(voice.buffer, validate=True)
            if len(wav) % 2 or not 0 < len(wav) <= 1024 * 1024:
                raise ValueError("audio must be non-empty even-length PCM bytes, at most 1 MiB")
            audio = np.frombuffer(wav, dtype="<i2").copy()
            result = await asyncio.to_thread(self.voiceChangerManager.changeVoice, audio)
            changed = np.asarray(result[0], dtype="<i2").tobytes()
            return {"timestamp": voice.timestamp, "changedVoiceBase64": base64.b64encode(changed).decode("ascii")}
        except Exception as exc:
            return failure(exc, "test")
