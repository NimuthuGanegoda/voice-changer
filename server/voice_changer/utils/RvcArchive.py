"""ZipSlip-safe and size-bounded extraction for zipped RVC model bundles."""
from __future__ import annotations

import stat
import zipfile
from pathlib import Path

from voice_changer.utils.ModelPaths import resolve_under, safe_filename

MAX_ARCHIVE_ENTRIES = 256
MAX_MEMBER_BYTES = 1024 * 1024 * 1024  # 1 GiB
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB
_MODEL_EXTS = (".pth", ".onnx")
_INDEX_EXTS = (".index", ".index.bin")
_CHUNK_SIZE = 1024 * 1024


def _is_ignored_entry(raw_name: str) -> bool:
    normalized = raw_name.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        return True
    if any(part == "__MACOSX" for part in parts):
        return True
    leaf = parts[-1]
    return leaf.startswith("._") or leaf == ".DS_Store"


def _validate_zip_member(info: zipfile.ZipInfo) -> None:
    if stat.S_ISLNK(info.external_attr >> 16):
        raise ValueError(f"refusing symlink entry in archive: {info.filename}")
    normalized = info.filename.replace("\\", "/")
    if normalized.startswith("/") or ":" in normalized.split("/")[0]:
        raise ValueError(f"refusing absolute path in archive: {info.filename}")
    parts = [part for part in normalized.split("/") if part]
    if any(part in (".", "..") for part in parts):
        raise ValueError(f"refusing path traversal in archive: {info.filename}")
    if info.file_size > MAX_MEMBER_BYTES:
        raise ValueError(f"archive member exceeds size limit: {info.filename}")


def _stream_member(zf: zipfile.ZipFile, info: zipfile.ZipInfo, destination: Path, remaining_budget: int) -> int:
    written = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(info, "r") as src, destination.open("wb") as dst:
        while True:
            chunk = src.read(_CHUNK_SIZE)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_MEMBER_BYTES or written > remaining_budget:
                raise ValueError("archive uncompressed size exceeds safety limit")
            dst.write(chunk)
    return written


def extract_rvc_zip(archive_path: str | Path, dest_dir: str | Path) -> tuple[str, str]:
    """Extract the primary RVC weight (.pth/.onnx) and optional .index safely into dest_dir."""
    archive = Path(archive_path)
    target_dir = Path(dest_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive, "r") as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise ValueError("archive contains too many entries")

        model_candidates: list[zipfile.ZipInfo] = []
        index_candidates: list[zipfile.ZipInfo] = []

        for info in infos:
            _validate_zip_member(info)
            if info.is_dir() or _is_ignored_entry(info.filename):
                continue
            leaf = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
            lower = leaf.lower()
            if lower.endswith(_MODEL_EXTS) and info.file_size > 0:
                model_candidates.append(info)
            elif lower.endswith(_INDEX_EXTS) and info.file_size > 0:
                index_candidates.append(info)

        if not model_candidates:
            raise ValueError("archive does not contain a valid .pth or .onnx RVC model")

        # Select largest weight / index when multiple files exist in the zip.
        model_info = max(model_candidates, key=lambda item: item.file_size)
        model_name = safe_filename(model_info.filename.replace("\\", "/").rsplit("/", 1)[-1])
        model_dest = resolve_under(target_dir, model_name)

        budget = MAX_TOTAL_BYTES
        budget -= _stream_member(zf, model_info, model_dest, budget)

        index_name = ""
        if index_candidates:
            index_info = max(index_candidates, key=lambda item: item.file_size)
            candidate_index_name = safe_filename(index_info.filename.replace("\\", "/").rsplit("/", 1)[-1])
            if candidate_index_name != model_name:
                index_dest = resolve_under(target_dir, candidate_index_name)
                _stream_member(zf, index_info, index_dest, budget)
                index_name = candidate_index_name

    return model_name, index_name
