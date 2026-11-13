from http.cookies import SimpleCookie
import hmac
import ipaddress

COOKIE_NAME = "vcclient_token"


def is_loopback_host(host: str) -> bool:
    if host.lower() in ("localhost", "localhost.localdomain"):
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def token_from_headers(headers) -> str | None:
    authorization = headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    cookie = SimpleCookie()
    try:
        cookie.load(headers.get("cookie", ""))
    except Exception:
        return None
    morsel = cookie.get(COOKIE_NAME)
    return morsel.value if morsel else None


def token_matches(expected: str | None, supplied: str | None) -> bool:
    return expected is None or (isinstance(supplied, str) and hmac.compare_digest(expected, supplied))
