import os
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import UploadFile

from voice_changer.utils.ModelPaths import resolve_under, safe_filename

_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_UPLOAD_ID = re.compile(r"^[a-zA-Z0-9_-]{8,64}$")
MAX_CHUNKS = 100_000  # 100 GiB at the client's 1 MiB chunk size.


def sanitize_filename(filename: str) -> str:
    # Uploads are stored flat. Logical model directories are handled separately
    # by LoadModelParams and are never accepted as physical upload paths.
    safe = os.path.basename(filename.replace("\\", "/")).lstrip(".") or "upload"
    root, ext = os.path.splitext(safe)
    if root.upper() in _WINDOWS_RESERVED_NAMES:
        root = f"_{root}"
    safe = root[: max(1, 200 - len(ext))] + ext[:55]
    return safe_filename(safe)


def validate_upload_id(upload_id: str) -> str:
    if not isinstance(upload_id, str) or not _UPLOAD_ID.fullmatch(upload_id):
        raise ValueError("invalid upload id")
    return upload_id


def upload_file(upload_dirname: str, file: UploadFile, filename: str, upload_id: str | None = None):
    if file is None or not filename:
        raise ValueError("uploaded file is not found")
    name = validate_upload_id(upload_id) if upload_id else sanitize_filename(filename)
    target = resolve_under(upload_dirname, name)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".upload-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(file.file, out, length=1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"status": "OK", "msg": f"uploaded file {filename}", "name": name}


def concat_file_chunks(upload_dirname: str, filename: str, chunkNum: int, dest_dirname: str, original_filename: str | None = None):
    if isinstance(chunkNum, bool) or not isinstance(chunkNum, int) or not 1 <= chunkNum <= MAX_CHUNKS:
        raise ValueError(f"chunk count must be between 1 and {MAX_CHUNKS}")
    # New clients use an opaque id for every chunk and the final file. Legacy
    # clients use the sanitized filename prefix. Both layouts remain supported.
    try:
        prefix = validate_upload_id(filename)
        opaque = True
    except ValueError:
        prefix, opaque = sanitize_filename(filename), False
    ext = os.path.splitext(sanitize_filename(original_filename))[1] if original_filename else ("" if opaque else os.path.splitext(prefix)[1])
    stored_name = f"{prefix}{ext}" if opaque else prefix
    target = resolve_under(dest_dirname, stored_name)
    chunks = [resolve_under(upload_dirname, f"{prefix}_{i}", must_exist=True) for i in range(chunkNum)]
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".concat-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            for chunk in chunks:
                with chunk.open("rb") as source:
                    shutil.copyfileobj(source, out, length=1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    # Keep chunks on failure so a retry is possible; remove only after commit.
    for chunk in chunks:
        chunk.unlink()
    return {"status": "OK", "msg": f"concatenated {stored_name}", "name": stored_name}
