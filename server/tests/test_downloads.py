import hashlib
import json
from types import SimpleNamespace

import pytest
import requests

from downloader.Downloader import DownloadError, download_to_file


class Response:
    def __init__(self, chunks, status=200, headers=None):
        self.chunks = chunks
        self.status_code = status
        self.headers = headers or {}
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")
    def iter_content(self, chunk_size): yield from self.chunks


def test_download_checksum_and_atomic_replace(tmp_path, monkeypatch):
    target = tmp_path / "model.bin"
    target.write_bytes(b"old")
    data = b"new model"
    monkeypatch.setattr(requests, "get", lambda *a, **k: Response([data], headers={"content-length": str(len(data))}))
    download_to_file("https://example/model", str(target), show_progress=False, sha256=hashlib.sha256(data).hexdigest())
    assert target.read_bytes() == data
    assert not list(tmp_path.glob("*.part"))


def test_http_failure_preserves_existing_file(tmp_path, monkeypatch):
    target = tmp_path / "model.bin"
    target.write_bytes(b"old")
    monkeypatch.setattr(requests, "get", lambda *a, **k: Response([], status=503))
    with pytest.raises(DownloadError):
        download_to_file("https://example/model", str(target), show_progress=False)
    assert target.read_bytes() == b"old"


def test_checksum_mismatch_does_not_publish(tmp_path, monkeypatch):
    target = tmp_path / "model.bin"
    monkeypatch.setattr(requests, "get", lambda *a, **k: Response([b"corrupt"]))
    with pytest.raises(DownloadError, match="SHA-256"):
        download_to_file("https://example/model", str(target), show_progress=False, sha256="0" * 64)
    assert not target.exists()


def test_missing_catalog_returns_empty_info(tmp_path, monkeypatch):
    import downloader.SampleDownloader as module
    def unavailable(_params): raise DownloadError("offline")
    monkeypatch.setattr(module, "download_no_tqdm", unavailable)
    assert module.getSampleInfos("production", str(tmp_path)) == []


def test_cached_catalog_works_offline(tmp_path, monkeypatch):
    import downloader.SampleDownloader as module
    url = module.getSampleJsonAndModelIds("production")[0][0]
    path = module._catalog_path(url, str(tmp_path))
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"RVC": [{"id": "test", "voiceChangerType": "RVC", "name": "Test", "modelUrl": "https://example/model.onnx"}]}))
    def offline(_params): raise DownloadError("offline")
    monkeypatch.setattr(module, "download_no_tqdm", offline)
    # Other catalogs are unavailable, but the valid cached catalog still loads.
    assert any(sample.id == "test" for sample in module.getSampleInfos("production", str(tmp_path)))


def test_gzip_encoded_download_ignores_compressed_content_length(tmp_path, monkeypatch):
    target = tmp_path / "catalog.json"
    decompressed = b'{"RVC": [{"id": "sample"}]}' * 20
    # Wire content-length is smaller than the decompressed bytes yielded by iter_content().
    headers = {"content-length": "42", "content-encoding": "gzip"}
    monkeypatch.setattr(requests, "get", lambda *a, **k: Response([decompressed], headers=headers))
    download_to_file("https://example/catalog.json", str(target), show_progress=False)
    assert target.read_bytes() == decompressed


def test_sample_url_filename_strips_query_and_fragment():
    import downloader.SampleDownloader as module
    assert module._url_filename("https://example/files/model.onnx?download=true#top") == "model.onnx"
    catalog = module._catalog_path("https://example/samples.json?v=1", "models")
    assert "?" not in catalog.name
    assert catalog.name.endswith("-samples.json")
