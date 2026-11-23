import hashlib
import ipaddress
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import requests
from tqdm import tqdm

from mods.log_control import VoiceChangaerLogger

logger = VoiceChangaerLogger.get_instance().getLogger()
TIMEOUT = (10, 60)  # connect, inactivity between received chunks


class DownloadError(RuntimeError):
    pass


def validate_remote_url(url: str) -> str:
    """Reject non-HTTPS schemes and loopback/private/link-local targets (SSRF defense)."""
    if not isinstance(url, str) or not url.strip():
        raise DownloadError("download URL must not be empty")
    parsed = urlsplit(url.strip())
    scheme = parsed.scheme.lower()
    if scheme != "https":
        if not (scheme == "http" and os.getenv("VCCLIENT_ALLOW_INSECURE_DOWNLOADS") == "1"):
            raise DownloadError(f"refusing insecure download scheme {scheme!r}: {url}")
    host = (parsed.hostname or "").strip().lower()
    if not host or host in ("localhost", "localhost.localdomain") or host.endswith((".local", ".internal")):
        raise DownloadError(f"refusing local/internal download host {host!r}")
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        ip = None
    if ip is not None and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast):
        raise DownloadError(f"refusing non-public IP download target {host!r}")
    return url.strip()


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_to_file(url: str, save_to: str, position: int = 0, show_progress: bool = True, sha256: str | None = None) -> str:
    """Download to a sibling temporary file; never publish partial/corrupt data."""
    url = validate_remote_url(url)
    target = Path(save_to)
    target.parent.mkdir(parents=True, exist_ok=True)
    if sha256:
        sha256 = sha256.lower()
        if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
            raise ValueError("sha256 must contain 64 hexadecimal characters")
        if target.is_file() and sha256_file(target) == sha256:
            return str(target)
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}-", suffix=".part", dir=target.parent)
    os.close(fd)
    progress = None
    try:
        with requests.get(url, stream=True, allow_redirects=True, timeout=TIMEOUT) as response:
            response.raise_for_status()
            if getattr(response, "url", None):
                validate_remote_url(str(response.url))
            length = response.headers.get("content-length")
            encoding = (response.headers.get("content-encoding") or "").strip().lower()
            is_encoded = bool(encoding) and encoding != "identity"
            total = int(length) if (not is_encoded and length and length.isdigit()) else None
            received = 0
            digest = hashlib.sha256()
            if show_progress:
                progress = tqdm(total=total, leave=False, unit="B", unit_scale=True, unit_divisor=1024, position=position)
            with open(temporary, "wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    received += len(chunk)
                    digest.update(chunk)
                    output.write(chunk)
                    if progress:
                        progress.update(len(chunk))
                output.flush()
                os.fsync(output.fileno())
        if received == 0:
            raise DownloadError(f"empty response from {url}")
        if total is not None and received != total:
            raise DownloadError(f"incomplete download: expected {total}, received {received} bytes")
        if sha256 and digest.hexdigest() != sha256:
            raise DownloadError(f"SHA-256 mismatch for {url}")
        os.replace(temporary, target)
        logger.info("[Voice Changer] downloaded %s", target)
        return str(target)
    except requests.RequestException as exc:
        raise DownloadError(f"download failed for {url}: {exc}") from exc
    finally:
        if progress:
            progress.close()
        if os.path.exists(temporary):
            os.unlink(temporary)


def download(params):
    return download_to_file(params["url"], params["saveTo"], params.get("position", 0), True, params.get("sha256"))


def download_no_tqdm(params):
    return download_to_file(params["url"], params["saveTo"], params.get("position", 0), False, params.get("sha256"))
