"""Filesystem boundaries and rollback-safe model-slot replacement (stdlib only)."""
from __future__ import annotations

import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path, PurePosixPath

MAX_MODEL_SLOTS = 500
_SAFE_COMPONENT = re.compile(r"^[^/\\\x00-\x1f]+$")


class UnsafePathError(ValueError):
    pass


def validate_slot(slot: int) -> int:
    if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot < MAX_MODEL_SLOTS:
        raise UnsafePathError(f"slot must be an integer in [0, {MAX_MODEL_SLOTS})")
    return slot


def safe_relative_dir(directory: str) -> str:
    if not isinstance(directory, str):
        raise UnsafePathError("model subdirectory must be a string")
    directory = directory.removesuffix("/")
    if directory in ("", "."):
        return ""
    if "\\" in directory or directory.startswith("/"):
        raise UnsafePathError("model subdirectory must be relative and use forward slashes")
    parts = directory.split("/")
    if len(parts) > 4 or any(not _SAFE_COMPONENT.fullmatch(p) or p in (".", "..") for p in parts):
        raise UnsafePathError("unsafe model subdirectory")
    return "/".join(parts)


def safe_filename(name: str) -> str:
    if not isinstance(name, str) or not _SAFE_COMPONENT.fullmatch(name) or name in (".", ".."):
        raise UnsafePathError("model filename must be a single path component")
    return name


def resolve_under(root: str | Path, *parts: str, must_exist: bool = False) -> Path:
    """Resolve a descendant, rejecting traversal and existing symlink escapes."""
    base = Path(root).resolve()
    candidate = base.joinpath(*parts)
    resolved = candidate.resolve()
    if resolved != base and base not in resolved.parents:
        raise UnsafePathError("path escapes its designated directory")
    if must_exist and not resolved.is_file():
        raise FileNotFoundError(f"required file does not exist: {candidate}")
    return resolved


def model_slot_path(model_dir: str | Path, slot: int) -> Path:
    return resolve_under(model_dir, str(validate_slot(slot)))


class ModelSlotTransaction:
    """Stage files, swap the slot, then finish only after metadata has been saved.

    Exiting before finish() restores the previous slot. Individual directory renames
    are atomic; a process crash between renames leaves a recoverable .backup-* path.
    """

    def __init__(self, model_dir: str | Path, slot: int):
        self.root = Path(model_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.target = model_slot_path(self.root, slot)
        self.staging = Path(tempfile.mkdtemp(prefix=f".import-{slot}-", dir=self.root))
        self.backup: Path | None = None
        self.committed = False
        self.finished = False

    def commit(self) -> Path:
        if self.committed:
            return self.target
        if not any(self.staging.iterdir()):
            raise ValueError("cannot install an empty model slot")
        if self.target.exists():
            if self.target.is_symlink() or not self.target.is_dir():
                raise UnsafePathError("model slot is not a regular directory")
            self.backup = self.root / f".backup-{self.target.name}-{uuid.uuid4().hex}"
            os.replace(self.target, self.backup)
        try:
            os.replace(self.staging, self.target)
        except BaseException:
            self._restore()
            raise
        self.committed = True
        return self.target

    def finish(self):
        if not self.committed:
            raise RuntimeError("model slot was not committed")
        self.finished = True
        if self.backup is not None:
            shutil.rmtree(self.backup)
            self.backup = None

    def _restore(self):
        if self.backup is not None and not self.target.exists():
            os.replace(self.backup, self.target)
            self.backup = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        missing_finish = exc_type is None and not self.finished
        if not self.finished:
            if self.committed:
                shutil.rmtree(self.target, ignore_errors=True)
            self._restore()
        if self.staging.exists():
            shutil.rmtree(self.staging)
        if missing_finish:
            raise RuntimeError("model transaction was not finished")
        return False
