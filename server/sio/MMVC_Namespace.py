from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import struct

import numpy as np
import socketio

from mods.auth import token_matches
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from voice_changer.VoiceChangerManager import VoiceChangerManager

logger = logging.getLogger(__name__)
MAX_PENDING_PER_CLIENT = 2
MAX_AUDIO_BYTES = 1024 * 1024


class MMVC_Namespace(socketio.AsyncNamespace):
    def __init__(self, namespace: str, voiceChangerManager: VoiceChangerManager, access_token: str | None = None):
        super().__init__(namespace)
        self.voiceChangerManager = voiceChangerManager
        self.access_token = access_token
        self.pending: dict[str, int] = {}
        self.connected: set[str] = set()
        # The model has shared conversion buffers. Serialize inference, but keep
        # request accounting/results per session and never block the event loop.
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vc-inference")
        self.loop = None
        voiceChangerManager.setEmitTo(self.emit_performance)

    @classmethod
    def get_instance(cls, voiceChangerManager: VoiceChangerManager, access_token: str | None = None):
        if not hasattr(cls, "_instance"):
            cls._instance = cls("/test", voiceChangerManager, access_token)
        return cls._instance

    async def on_connect(self, sid, environ, auth=None):
        supplied = auth.get("token") if isinstance(auth, dict) else None
        if not token_matches(self.access_token, supplied):
            raise socketio.exceptions.ConnectionRefusedError("authorization required")
        self.loop = asyncio.get_running_loop()
        self.connected.add(sid)
        self.pending[sid] = 0
        logger.info("Client connected: %s", sid)

    def emit_performance(self, performance):
        loop = self.loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(lambda: loop.create_task(self.emit("performance", performance)))

    async def on_request_message(self, sid, msg):
        if sid not in self.connected:
            return
        if not isinstance(msg, (list, tuple)) or len(msg) != 2:
            await self.emit("vc_error", {"msg": "expected [timestamp, audio]"}, to=sid)
            return
        try:
            timestamp = int(msg[0])
            data = msg[1]
            if isinstance(data, str):
                await self.emit("response", [timestamp, b"", []], to=sid)
                return
            if not isinstance(data, (bytes, bytearray)) or len(data) % 2 or len(data) > MAX_AUDIO_BYTES:
                raise ValueError("audio must be even-length PCM bytes, at most 1 MiB")
            if self.pending[sid] >= MAX_PENDING_PER_CLIENT:
                await self.emit("overrun", {"timestamp": timestamp}, to=sid)
                return
            self.pending[sid] += 1
            audio = np.frombuffer(data, dtype="<i2").copy()
            try:
                result = await asyncio.get_running_loop().run_in_executor(self.worker, self.voiceChangerManager.changeVoice, audio)
                if sid not in self.connected:
                    return
                output, performance = result[0], result[1] if len(result) > 1 else []
                packed = np.asarray(output, dtype="<i2").tobytes()
                await self.emit("response", [timestamp, packed, performance], to=sid)
            finally:
                if sid in self.pending:
                    self.pending[sid] -= 1
        except Exception as exc:
            logger.exception("Realtime conversion failed for %s", sid)
            if sid in self.connected:
                await self.emit("vc_error", {"msg": str(exc)}, to=sid)

    async def on_disconnect(self, sid):
        self.connected.discard(sid)
        self.pending.pop(sid, None)
