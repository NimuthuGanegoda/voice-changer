import base64
import struct
import numpy as np
import traceback

from fastapi import APIRouter
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from voice_changer.VoiceChangerManager import VoiceChangerManager
from pydantic import BaseModel
import threading


class VoiceModel(BaseModel):
    timestamp: int
    buffer: str


class SoundRequest(BaseModel):
    filename: str


class TTSRequest(BaseModel):
    text: str
    voice: str = "en-US-EmmaNeural"


class MMVC_Rest_VoiceChanger:
    def __init__(self, voiceChangerManager: VoiceChangerManager):
        self.voiceChangerManager = voiceChangerManager
        self.router = APIRouter()
        self.router.add_api_route("/test", self.test, methods=["POST"])
        self.router.add_api_route("/play_sound", self.play_sound, methods=["POST"])
        self.router.add_api_route("/tts", self.tts, methods=["POST"])
        self.router.add_api_route("/device_setup/status", self.device_setup_status, methods=["GET"])

        self.tlock = threading.Lock()

    async def device_setup_status(self):
        """Detect a system-wide virtual audio cable (VB-Cable). If present the user can
        route VCClient output into it and pick it as the mic in desktop apps."""
        try:
            from voice_changer.Local.AudioDeviceList import list_audio_device

            audioinput, audiooutput = list_audio_device()
            cableOutputDevices = [{"index": d.index, "name": d.name} for d in audiooutput if "CABLE Input" in d.name]
            cableInputDevices = [{"index": d.index, "name": d.name} for d in audioinput if "CABLE Output" in d.name]
            installed = len(cableOutputDevices) > 0
            return {
                "status": "OK",
                "virtualCableInstalled": installed,
                # VCClient should output INTO "CABLE Input"; apps record FROM "CABLE Output".
                "cablePlaybackDevices": cableOutputDevices,
                "cableRecordingDevices": cableInputDevices,
                "installUrl": None if installed else "https://vb-audio.com/Cable/",
                "hint": None if installed else "Install VB-Cable, restart VCClient, then set server output to 'CABLE Input' and select 'CABLE Output' as microphone in your app.",
            }
        except Exception as e:
            return {"status": "Error", "message": str(e)}

    async def play_sound(self, request: SoundRequest):
        res = self.voiceChangerManager.play_sound(request.filename)
        return {"status": "OK" if res else "Error"}

    async def tts(self, request: TTSRequest):
        try:
            import edge_tts
            import tempfile
            import os

            # edge-tts outputs MP3. Close the fd before writing: on Windows an open
            # handle would block edge-tts from opening the same path.
            fd, path = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            try:
                communicate = edge_tts.Communicate(request.text, request.voice)
                await communicate.save(path)
                ok = self.voiceChangerManager.soundboard.add_sound(path)
            finally:
                os.unlink(path)

            if ok:
                return {"status": "OK"}
            return {"status": "Error", "message": "failed to decode TTS audio (mp3 decoder unavailable?)"}
        except ImportError:
            return {"status": "Error", "message": "edge-tts not installed"}
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
