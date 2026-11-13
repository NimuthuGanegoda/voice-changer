import asyncio
import threading
import time

import numpy as np

from sio.MMVC_Namespace import MMVC_Namespace


class FakeManager:
    def __init__(self):
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()
    def setEmitTo(self, _callback): pass
    def changeVoice(self, audio):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.01)
        with self.lock:
            self.active -= 1
        return audio * 2, [0.01]


def test_two_clients_keep_results_and_backpressure_separate():
    async def scenario():
        manager = FakeManager()
        namespace = MMVC_Namespace("/test", manager, "test-token-123456")
        emitted = []
        async def emit(event, data, to=None): emitted.append((event, data, to))
        namespace.emit = emit
        await namespace.on_connect("a", {}, {"token": "test-token-123456"})
        await namespace.on_connect("b", {}, {"token": "test-token-123456"})
        a = np.array([1, 2], dtype="<i2")
        b = np.array([3, 4], dtype="<i2")
        await asyncio.gather(namespace.on_request_message("a", [10, a.tobytes()]), namespace.on_request_message("b", [20, b.tobytes()]))
        responses = {(event_to): data for event, data, event_to in emitted if event == "response"}
        assert np.frombuffer(responses["a"][1], dtype="<i2").tolist() == [2, 4]
        assert np.frombuffer(responses["b"][1], dtype="<i2").tolist() == [6, 8]
        assert manager.max_active == 1
        await namespace.on_disconnect("a")
        assert "a" not in namespace.pending
        assert "b" in namespace.pending
        namespace.worker.shutdown()
    asyncio.run(scenario())


def test_socket_requires_token():
    async def scenario():
        namespace = MMVC_Namespace("/test", FakeManager(), "test-token-123456")
        try:
            await namespace.on_connect("a", {}, None)
            assert False
        except Exception as exc:
            assert "authorization" in str(exc)
        namespace.worker.shutdown()
    asyncio.run(scenario())
