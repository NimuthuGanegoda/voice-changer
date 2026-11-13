from __future__ import annotations

import time
from typing import TYPE_CHECKING

from fastapi import APIRouter

if TYPE_CHECKING:
    from voice_changer.VoiceChangerManager import VoiceChangerManager


class MMVC_Rest_Hello:
    def __init__(self, manager: VoiceChangerManager | None = None):
        self.manager = manager
        self.router = APIRouter()
        self.router.add_api_route("/api/hello", self.hello, methods=["GET"])
        self.router.add_api_route("/api/health", self.health, methods=["GET"])

    def hello(self):
        return {"result": "Index"}

    def health(self):
        if self.manager is None:
            return {"status": "OK"}
        return {
            "status": "OK",
            "modelLoaded": self.manager.voiceChanger is not None,
            "serverAudioStarted": self.manager.serverDevice.settings.serverAudioStated == 1,
            "uptimeSeconds": round(time.monotonic() - getattr(self.manager, "startedAt", time.monotonic())),
        }
