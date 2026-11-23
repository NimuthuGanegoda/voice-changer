import wave
import numpy as np
import pytest

from voice_changer.IORecorder import IORecorder


def test_io_recorder_creates_parent_dirs_and_is_idempotent(tmp_path):
    in_wav = tmp_path / "nested" / "in.wav"
    out_wav = tmp_path / "nested" / "out.wav"
    samples = np.array([0, 1000, -1000, 32767], dtype=np.int16)

    with IORecorder(str(in_wav), str(out_wav), 48000, 48000) as recorder:
        recorder.writeInput(samples)
        recorder.writeOutput(samples.tobytes())

    # Post-close writes and repeated close() must be safe no-ops.
    recorder.writeInput(samples)
    recorder.writeOutput(samples.tobytes())
    recorder.close()

    with wave.open(str(in_wav), "rb") as reader:
        assert reader.getframerate() == 48000
        assert reader.getnframes() == len(samples)
    with wave.open(str(out_wav), "rb") as reader:
        assert reader.getframerate() == 48000
        assert reader.getnframes() == len(samples)


def test_io_recorder_closes_first_handle_when_second_open_fails(tmp_path, monkeypatch):
    in_wav = tmp_path / "in.wav"
    out_wav = tmp_path / "out.wav"
    real_open = wave.open
    calls = 0

    def fail_on_second(path, mode="rb"):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("disk full")
        return real_open(path, mode)

    monkeypatch.setattr(wave, "open", fail_on_second)
    with pytest.raises(OSError, match="disk full"):
        IORecorder(str(in_wav), str(out_wav), 48000, 48000)
    # On Windows, an unclosed file handle would fail to unlink.
    in_wav.unlink()
