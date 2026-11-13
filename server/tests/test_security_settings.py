import asyncio

from mods.auth import is_loopback_host, token_matches
from restapi.mods.trustedorigin import TrustedOriginMiddleware
from voice_changer.utils.AudioSettings import updated_crossfade


async def call(middleware, headers=None, path="/info"):
    messages = []
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})
    async def receive(): return {"type": "http.request", "body": b""}
    async def send(message): messages.append(message)
    scope = {"type": "http", "path": path, "scheme": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]}
    middleware.app = app
    await middleware(scope, receive, send)
    return messages[0]["status"]


def test_origin_and_token_policy():
    middleware = TrustedOriginMiddleware(app=None, port=18888, access_token="a-long-test-token-123")
    assert asyncio.run(call(middleware)) == 401
    assert asyncio.run(call(middleware, {"Authorization": "Bearer a-long-test-token-123"})) == 200
    assert asyncio.run(call(middleware, {"Origin": "https://evil.example", "Authorization": "Bearer a-long-test-token-123"})) == 403
    assert asyncio.run(call(middleware, {"Origin": "http://localhost:18888", "Authorization": "Bearer a-long-test-token-123"})) == 200
    assert asyncio.run(call(middleware, path="/api/hello")) == 200


def test_loopback_hosts_and_constant_time_comparison():
    assert is_loopback_host("127.0.0.1")
    assert is_loopback_host("::1")
    assert not is_loopback_host("0.0.0.0")
    assert token_matches("secret", "secret")
    assert not token_matches("secret", None)


def test_crossfade_bounds():
    settings = type("Settings", (), {"crossFadeOffsetRate": 0.1, "crossFadeEndRate": 0.5, "crossFadeOverlapSize": 1024})()
    assert updated_crossfade(settings, "crossFadeEndRate", 0.8)[1] == 0.8
    for key, value in [("crossFadeOffsetRate", 0.9), ("crossFadeEndRate", 0.05), ("crossFadeOverlapSize", 0), ("crossFadeOffsetRate", float("nan"))]:
        try:
            updated_crossfade(settings, key, value)
            assert False
        except ValueError:
            pass
