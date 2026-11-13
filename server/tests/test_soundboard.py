import importlib
import sys
from types import ModuleType, SimpleNamespace

import numpy as np
import pytest


@pytest.fixture
def soundboard_module(monkeypatch):
    fake = ModuleType("librosa")
    fake.load = lambda path, **kwargs: (np.ones(int(path.rsplit("/", 1)[-1]), dtype=np.float32), 0)
    fake.resample = lambda audio, orig_sr, target_sr: np.repeat(audio, target_sr // orig_sr)
    monkeypatch.setitem(sys.modules, "librosa", fake)
    import voice_changer.utils.Soundboard as module
    return importlib.reload(module)


def make_clip(tmp_path, samples):
    path = tmp_path / str(samples)
    path.write_bytes(b"fake")
    return str(path)


def test_queue_caps_count_the_playing_clip_and_total_duration(soundboard_module, tmp_path):
    board = soundboard_module.Soundboard(sampling_rate=1000)
    for _ in range(10):
        assert board.add_sound(make_clip(tmp_path, 10))
    assert not board.add_sound(make_clip(tmp_path, 10))
    board.get_chunk(5)  # first clip is now playing, still counts toward the item cap
    assert not board.add_sound(make_clip(tmp_path, 10))

    board.clear()
    assert board.add_sound(make_clip(tmp_path, 60000))
    assert not board.add_sound(make_clip(tmp_path, 1))


def test_get_chunk_is_gapless_across_clips_and_clear_stops_everything(soundboard_module, tmp_path):
    board = soundboard_module.Soundboard(sampling_rate=1000)
    assert board.add_sound(make_clip(tmp_path, 3))
    assert board.add_sound(make_clip(tmp_path, 4))
    assert board.get_chunk(5).tolist() == [1, 1, 1, 1, 1]
    assert board.get_chunk(2).tolist() == [1, 1]
    assert not board.is_active()
    assert board.add_sound(make_clip(tmp_path, 10))
    board.get_chunk(2)
    board.clear()
    assert not board.is_active()
    assert board.get_chunk(4).tolist() == [0, 0, 0, 0]


def test_rate_change_resamples_only_the_remaining_current_clip(soundboard_module, tmp_path, monkeypatch):
    board = soundboard_module.Soundboard(sampling_rate=1000)
    assert board.add_sound(make_clip(tmp_path, 10))
    board.get_chunk(4)
    board.set_sampling_rate(2000)
    assert board.sampling_rate == 2000
    assert len(board.get_chunk(12)) == 12
    assert not board.is_active()


def test_empty_and_invalid_audio_are_rejected(soundboard_module, tmp_path, monkeypatch):
    board = soundboard_module.Soundboard(sampling_rate=1000)
    empty = tmp_path / "empty"
    empty.write_bytes(b"")
    monkeypatch.setattr(soundboard_module.librosa, "load", lambda *a, **k: (np.zeros(0, dtype=np.float32), 0))
    assert not board.add_sound(str(empty))
    with pytest.raises(ValueError):
        board.get_chunk(0)
    with pytest.raises(ValueError):
        board.set_sampling_rate(0)
