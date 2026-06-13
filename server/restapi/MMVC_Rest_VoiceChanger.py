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

        self.tlock = threading.Lock()

    async def play_sound(self, request: SoundRequest):
        res = self.voiceChangerManager.play_sound(request.filename)
        return {"status": "OK" if res else "Error"}

    async def tts(self, request: TTSRequest):
        try:
            import edge_tts
            import tempfile
            import os

            communicate = edge_tts.Communicate(request.text, request.voice)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                await communicate.save(tmp.name)
                self.voiceChangerManager.soundboard.add_sound(tmp.name)
                os.unlink(tmp.name)

            return {"status": "OK"}
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
