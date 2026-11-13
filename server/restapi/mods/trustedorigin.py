from typing import Optional, Sequence

from mods.auth import COOKIE_NAME, token_from_headers, token_matches
from mods.origins import compute_local_origins, normalize_origins
from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

_PUBLIC_PREFIXES = ("/front/", "/assets/", "/trainer/", "/recorder/", "/extension/")
_PUBLIC_PATHS = {"/", "/index.html", "/index.js", "/favicon.ico", "/api/hello", "/api/health", "/buymeacoffee.png", "/ort-wasm-simd.wasm"}


class TrustedOriginMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: Optional[Sequence[str]] = None, port: Optional[int] = None, access_token: str | None = None):
        self.allowed_origins = set(compute_local_origins(port))
        if allowed_origins is not None:
            self.allowed_origins.update(normalize_origins(allowed_origins))
        self.access_token = access_token
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin", "")
        if origin and origin not in self.allowed_origins:
            await PlainTextResponse("Invalid origin header", status_code=403)(scope, receive, send)
            return
        path = scope.get("path", "/")
        # Socket.IO carries its token in the namespace connect auth payload.
        public = path in _PUBLIC_PATHS or path.startswith(_PUBLIC_PREFIXES) or path.startswith("/socket.io/")
        supplied = token_from_headers(headers)
        if self.access_token and not public and not token_matches(self.access_token, supplied):
            await PlainTextResponse("Authorization required", status_code=401)(scope, receive, send)
            return
        if self.access_token and headers.get("authorization", "").lower().startswith("bearer ") and token_matches(self.access_token, supplied):
            secure = "; Secure" if scope.get("scheme") == "https" else ""
            cookie = f"{COOKIE_NAME}={self.access_token}; Path=/; HttpOnly; SameSite=Strict{secure}".encode()
            async def send_with_cookie(message):
                if message["type"] == "http.response.start":
                    message.setdefault("headers", []).append((b"set-cookie", cookie))
                await send(message)
            await self.app(scope, receive, send_with_cookie)
            return
        await self.app(scope, receive, send)
