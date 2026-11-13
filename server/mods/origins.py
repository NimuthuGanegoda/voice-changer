from typing import Optional, Sequence
from urllib.parse import urlparse

SCHEMAS = ("http", "https")
LOCAL_ORIGINS = ("127.0.0.1", "localhost")


def compute_local_origins(port: Optional[int] = None) -> list[str]:
    suffix = f":{port}" if port is not None else ""
    return [f"{scheme}://{host}{suffix}" for scheme in SCHEMAS for host in LOCAL_ORIGINS]


def normalize_origins(origins: Sequence[str]) -> set[str]:
    result = set()
    for value in origins:
        try:
            url = urlparse(value)
            port = url.port
            if url.scheme not in SCHEMAS or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
                raise ValueError
            origin = f"{url.scheme}://{url.hostname.lower()}"
            if port is not None:
                origin += f":{port}"
            result.add(origin)
        except (TypeError, ValueError):
            raise ValueError(f"invalid origin {value!r}; use http(s)://host[:port] without a path") from None
    return result
