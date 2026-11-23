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


def test_rvc_archive_extracts_largest_weights_and_index_and_blocks_zip_slip(tmp_path):
    import zipfile
    from voice_changer.utils.RvcArchive import extract_rvc_zip

    good_zip = tmp_path / "maki.zip"
    with zipfile.ZipFile(good_zip, "w") as zf:
        zf.writestr("__MACOSX/._Maki_e600_s2400.pth", b"junk")
        zf.writestr("Maki/Maki_e600_s2400.pth", b"PTH" * 100)
        zf.writestr("Maki/added_IVF30_Flat_nprobe_1_Maki_v2.index", b"IDX" * 20)

    out_dir = tmp_path / "extracted"
    out_dir.mkdir()
    model_name, index_name = extract_rvc_zip(good_zip, out_dir)
    assert model_name == "Maki_e600_s2400.pth"
    assert index_name == "added_IVF30_Flat_nprobe_1_Maki_v2.index"
    assert (out_dir / model_name).read_bytes() == b"PTH" * 100
    assert (out_dir / index_name).read_bytes() == b"IDX" * 20
    assert not (out_dir / "._Maki_e600_s2400.pth").exists()

    bad_zip = tmp_path / "evil.zip"
    with zipfile.ZipFile(bad_zip, "w") as zf:
        zf.writestr("../../evil.pth", b"nope")
    with pytest.raises(ValueError, match="path traversal"):
        extract_rvc_zip(bad_zip, tmp_path / "out_bad")


def test_community_samples_available_and_downloadable_from_zip(tmp_path, monkeypatch):
    import io
    import sys
    import types
    import zipfile
    import downloader.SampleDownloader as module
    from downloader.SampleDownloader import downloadSample, get_available_samples

    def _offline_catalog(dl_params):
        raise DownloadError("offline")

    monkeypatch.setattr(module, "download_no_tqdm", _offline_catalog)
    assert module.getSampleInfos("production", str(tmp_path), offline=False) == []

    available = get_available_samples("production", str(tmp_path), offline=False)
    ids = {sample.id for sample in available}
    assert {
        "ZeninMaki_RVC",
        "MisaAmane_RVC",
        "MikasaAckerman_RVC",
        "HinataHyuga_RVC",
        "Power_RVC",
        "Makima_RVC",
        "RaidenShogun_RVC",
    }.issubset(ids)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Maki/Maki_e600_s2400.pth", b"weights")
        zf.writestr("Maki/added_IVF30_Flat_nprobe_1_Maki_v2.index", b"index")

    def fake_download_no_tqdm(dl_params):
        url, save_to = dl_params["url"], dl_params["saveTo"]
        if url.endswith("Maki.zip"):
            with open(save_to, "wb") as out:
                out.write(buf.getvalue())
            return save_to
        raise DownloadError("catalog offline")

    monkeypatch.setattr(module, "download_no_tqdm", fake_download_no_tqdm)
    fake_gen = types.SimpleNamespace(_setInfoByPytorch=staticmethod(lambda _model_path, info: info))
    monkeypatch.setitem(
        sys.modules,
        "voice_changer.RVC.RVCModelSlotGenerator",
        types.SimpleNamespace(RVCModelSlotGenerator=fake_gen),
    )

    downloadSample("production", "ZeninMaki_RVC", str(tmp_path), 0, {"useIndex": True})
    slot_dir = tmp_path / "0"
    assert (slot_dir / "Maki_e600_s2400.pth").read_bytes() == b"weights"
    assert (slot_dir / "added_IVF30_Flat_nprobe_1_Maki_v2.index").read_bytes() == b"index"
    assert not (slot_dir / "Maki.zip").exists()
    saved = json.loads((slot_dir / "params.json").read_text())
    assert saved["sampleId"] == "ZeninMaki_RVC"
    assert saved["modelFile"] == "Maki_e600_s2400.pth"
    assert saved["indexFile"] == "added_IVF30_Flat_nprobe_1_Maki_v2.index"
    assert saved["defaultIndexRatio"] == 0.7


def test_download_rejects_ssrf_and_insecure_schemes(tmp_path):
    from downloader.Downloader import validate_remote_url

    assert validate_remote_url("https://huggingface.co/Kuma6/Maki-Zenin/resolve/main/Maki.zip").startswith("https://")
    for bad in (
        "http://127.0.0.1:18888/secret",
        "https://127.0.0.1/secret",
        "https://169.254.169.254/latest/meta-data/",
        "https://192.168.1.10/model.zip",
        "https://localhost/model.zip",
        "file:///etc/passwd",
        "",
    ):
        with pytest.raises(DownloadError):
            validate_remote_url(bad)
