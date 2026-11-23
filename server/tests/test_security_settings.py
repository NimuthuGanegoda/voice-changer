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


def test_self_signed_cert_private_key_permissions(tmp_path, monkeypatch):
    import importlib
    import os
    import sys
    from types import ModuleType, SimpleNamespace

    openssl = ModuleType("OpenSSL")
    crypto = ModuleType("OpenSSL.crypto")
    crypto.TYPE_RSA = 1
    crypto.FILETYPE_PEM = 1
    crypto.PKey = lambda: SimpleNamespace(generate_key=lambda *a: None)
    crypto.X509 = lambda: SimpleNamespace(
        get_subject=lambda: SimpleNamespace(),
        set_serial_number=lambda *a: None,
        gmtime_adj_notBefore=lambda *a: None,
        gmtime_adj_notAfter=lambda *a: None,
        set_issuer=lambda *a: None,
        set_pubkey=lambda *a: None,
        sign=lambda *a: None,
    )
    crypto.dump_certificate = lambda *a: b"CERT"
    crypto.dump_privatekey = lambda *a: b"KEY"
    openssl.crypto = crypto
    monkeypatch.setitem(sys.modules, "OpenSSL", openssl)
    monkeypatch.setitem(sys.modules, "OpenSSL.crypto", crypto)

    import mods.ssl as ssl_mod
    ssl_mod = importlib.reload(ssl_mod)

    cert_file = "cert.pem"
    key_file = "key.pem"
    ssl_mod.create_self_signed_cert(
        cert_file,
        key_file,
        {"Country": "JP", "State": "Tokyo", "City": "Chiyoda", "Organization": "Test", "Org. Unit": "Test"},
        cert_dir=str(tmp_path),
    )
    assert (tmp_path / cert_file).read_bytes() == b"CERT"
    key_path = tmp_path / key_file
    assert key_path.read_bytes() == b"KEY"
    if sys.platform != "win32":
        assert (os.stat(key_path).st_mode & 0o777) == 0o600


def test_security_headers_and_pna_only_for_allowed_origins():
    from restapi.mods.trustedorigin import SecurityHeadersMiddleware

    async def run(headers):
        sent = []

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(msg):
            sent.append(msg)

        mw = SecurityHeadersMiddleware(app, allowed_origins=["https://pages.example"], port=18888)
        scope = {
            "type": "http",
            "path": "/info",
            "scheme": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        }
        await mw(scope, receive, send)
        return {k.lower().decode(): v.decode() for k, v in sent[0]["headers"]}

    allowed = asyncio.run(run({"Origin": "https://pages.example", "Access-Control-Request-Private-Network": "true"}))
    assert allowed["x-content-type-options"] == "nosniff"
    assert allowed["access-control-allow-private-network"] == "true"

    untrusted = asyncio.run(run({"Origin": "https://evil.example", "Access-Control-Request-Private-Network": "true"}))
    assert untrusted["x-content-type-options"] == "nosniff"
    assert "access-control-allow-private-network" not in untrusted
