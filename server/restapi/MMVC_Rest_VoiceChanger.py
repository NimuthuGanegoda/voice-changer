import base64
import os
import struct
import sys
import numpy as np
import traceback

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from voice_changer.VoiceChangerManager import VoiceChangerManager
from const import SOUNDBOARD_DIR
from restapi.mods.FileUploader import upload_file
from pydantic import BaseModel
import threading


class VoiceModel(BaseModel):
    timestamp: int
    buffer: str


class SoundRequest(BaseModel):
    filename: str


class TTSRequest(BaseModel):
    text: str
    # Empty = use the OS default voice. Matched by substring against the local
    # engine's installed voice names (e.g. "zira", "david") - not a cloud voice
    # catalog name, since synthesis happens fully offline via pyttsx3.
    voice: str = ""


class MMVC_Rest_VoiceChanger:
    def __init__(self, voiceChangerManager: VoiceChangerManager):
        self.voiceChangerManager = voiceChangerManager
        self.router = APIRouter()
        self.router.add_api_route("/test", self.test, methods=["POST"])
        self.router.add_api_route("/play_sound", self.play_sound, methods=["POST"])
        self.router.add_api_route("/soundboard/list", self.soundboard_list, methods=["GET"])
        self.router.add_api_route("/soundboard/upload", self.soundboard_upload, methods=["POST"])
        self.router.add_api_route("/tts", self.tts, methods=["POST"])
        self.router.add_api_route("/device_setup/status", self.device_setup_status, methods=["GET"])

        self.tlock = threading.Lock()

    async def device_setup_status(self):
        """Detect a system-wide virtual audio cable/mic for this OS. If present the
        user can route VCClient output into it and pick it as the mic in any app.
        Windows: VB-Cable ("CABLE Input"/"CABLE Output" device names).
        macOS: BlackHole ("BlackHole" device name).
        Linux: PulseAudio/PipeWire null-sink created by setup_virtual_mic_linux.sh
        ("VoiceChangerMic" sink, "Monitor of VoiceChangerMic" source)."""
        try:
            from voice_changer.Local.AudioDeviceList import list_audio_device

            audioinput, audiooutput = list_audio_device()

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
                # VCClient should output INTO the playback device; apps record FROM the recording device.
                "cablePlaybackDevices": playbackDevices,
                "cableRecordingDevices": recordingDevices,
                "installUrl": None if installed else installUrl,
                "hint": None if installed else hint,
            }
        except Exception as e:
            return {"status": "Error", "message": str(e)}

    async def play_sound(self, request: SoundRequest):
        res = self.voiceChangerManager.play_sound(request.filename)
        return {"status": "OK" if res else "Error"}

    async def soundboard_list(self):
        try:
            os.makedirs(SOUNDBOARD_DIR, exist_ok=True)
            files = sorted(f for f in os.listdir(SOUNDBOARD_DIR) if os.path.isfile(os.path.join(SOUNDBOARD_DIR, f)))
            return {"status": "OK", "files": files}
        except Exception as e:
            return {"status": "Error", "message": str(e)}

    async def soundboard_upload(self, file: UploadFile = File(...), filename: str = Form(...)):
        try:
            res = upload_file(SOUNDBOARD_DIR, file, filename)
            return res
        except Exception as e:
            return {"status": "Error", "message": str(e)}

    async def tts(self, request: TTSRequest):
        try:
            import pyttsx3
            import tempfile
            import os
            import asyncio

            # pyttsx3 drives the OS's own TTS (SAPI5/NSSpeechSynthesizer/espeak) -
            # fully local, no network call, unlike the cloud TTS this replaced.
            fd, path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

            def synthesize():
                engine = pyttsx3.init()
                if request.voice:
                    wanted = request.voice.lower()
                    for v in engine.getProperty("voices"):
                        if wanted in v.name.lower() or wanted in (v.id or "").lower():
                            engine.setProperty("voice", v.id)
                            break
                engine.save_to_file(request.text, path)
                engine.runAndWait()

            try:
                # pyttsx3 blocks on the OS TTS engine - keep it off the event loop.
                await asyncio.get_event_loop().run_in_executor(None, synthesize)
                ok = self.voiceChangerManager.soundboard.add_sound(path)
            finally:
                os.unlink(path)

            if ok:
                return {"status": "OK"}
            return {"status": "Error", "message": "failed to synthesize speech (no local TTS voice available on this OS?)"}
        except ImportError:
            return {"status": "Error", "message": "pyttsx3 not installed"}
        except Exception as e:
            return {"status": "Error", "message": str(e)}

    def test(self, voice: VoiceModel):
        try:
            timestamp = voice.timestamp
            buffer = voice.buffer
            wav = base64.b64decode(buffer)

            # if wav == 0:
            #     samplerate, data = read("dummy.wav")
            #     unpackedData = data
            # else:
            #     unpackedData = np.array(
            #         struct.unpack("<%sh" % (len(wav) // struct.calcsize("<h")), wav)
            #     )

            unpackedData = np.array(struct.unpack("<%sh" % (len(wav) // struct.calcsize("<h")), wav)).astype(np.int16)
            # print(f"[REST] unpackedDataType {unpackedData.dtype}")

            self.tlock.acquire()
            changedVoice = self.voiceChangerManager.changeVoice(unpackedData)
            self.tlock.release()

            changedVoiceBase64 = base64.b64encode(changedVoice[0]).decode("utf-8")
            data = {"timestamp": timestamp, "changedVoiceBase64": changedVoiceBase64}

            json_compatible_item_data = jsonable_encoder(data)
            return JSONResponse(content=json_compatible_item_data)

        except Exception as e:
            print("REQUEST PROCESSING!!!! EXCEPTION!!!", e)
            print(traceback.format_exc())
            self.tlock.release()
            return str(e)
