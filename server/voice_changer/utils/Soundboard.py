from __future__ import annotations

import os
import threading
from typing import Optional

import librosa
import numpy as np

from voice_changer.utils.SettingValidation import strict_int


class Soundboard:
    """Bounded, thread-safe clip queue mixed into the realtime input stream."""

    MAX_QUEUE_ITEMS = 10
    MAX_QUEUE_SECONDS = 60
    MAX_CHUNK_SIZE = 192000

    def __init__(self, sampling_rate: int = 48000):
        self.sampling_rate = strict_int(sampling_rate, "sampling_rate")
        if not 1 <= self.sampling_rate <= 384000:
            raise ValueError("sampling_rate must be between 1 and 384000 Hz")
        self.queue: list[np.ndarray] = []
        self.current_pos = 0
        self.current_audio: Optional[np.ndarray] = None
        self.lock = threading.Lock()

    def add_sound(self, file_path: str) -> bool:
        if not os.path.isfile(file_path):
            return False
        with self.lock:
            source_rate = self.sampling_rate
        try:
            audio, _ = librosa.load(file_path, sr=source_rate, mono=True, duration=self.MAX_QUEUE_SECONDS)
        except Exception as exc:
            print(f"[Voice Changer] Soundboard failed to load {file_path}: {exc}")
            return False
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            return False
        return self._enqueue(audio, source_rate)

    def _enqueue(self, audio: np.ndarray, source_rate: int) -> bool:
        while True:
            with self.lock:
                target_rate = self.sampling_rate
            if source_rate != target_rate:
                # Do not hold the audio-path lock while decoding/resampling a clip.
                audio = np.asarray(librosa.resample(audio, orig_sr=source_rate, target_sr=target_rate), dtype=np.float32)
                source_rate = target_rate
                continue
            with self.lock:
                if self.sampling_rate != source_rate:
                    continue
                queued = sum(len(item) for item in self.queue)
                items = len(self.queue)
                if self.current_audio is not None:
                    queued += len(self.current_audio) - self.current_pos
                    items += 1
                seconds = (queued + len(audio)) / self.sampling_rate
                if items >= self.MAX_QUEUE_ITEMS or seconds > self.MAX_QUEUE_SECONDS + 1e-6:
                    return False
                self.queue.append(audio)
                return True

    def clear(self):
        with self.lock:
            self.queue.clear()
            self.current_audio = None
            self.current_pos = 0

    def set_sampling_rate(self, sampling_rate: int):
        sampling_rate = strict_int(sampling_rate, "sampling_rate")
        if not 1 <= sampling_rate <= 384000:
            raise ValueError("sampling_rate must be between 1 and 384000 Hz")
        with self.lock:
            if sampling_rate == self.sampling_rate:
                return
            original = self.sampling_rate
            queue = [librosa.resample(item, orig_sr=original, target_sr=sampling_rate) for item in self.queue]
            current = None
            if self.current_audio is not None:
                current = librosa.resample(self.current_audio[self.current_pos:], orig_sr=original, target_sr=sampling_rate)
            self.queue = queue
            self.current_audio = current
            self.current_pos = 0
            self.sampling_rate = sampling_rate

    def is_active(self) -> bool:
        with self.lock:
            return bool(self.queue) or (self.current_audio is not None and self.current_pos < len(self.current_audio))

    def get_chunk(self, chunk_size: int) -> np.ndarray:
        chunk_size = strict_int(chunk_size, "chunk_size")
        if not 1 <= chunk_size <= self.MAX_CHUNK_SIZE:
            raise ValueError(f"chunk_size must be between 1 and {self.MAX_CHUNK_SIZE}")
        output = np.zeros(chunk_size, dtype=np.float32)
        written = 0
        with self.lock:
            while written < chunk_size:
                if self.current_audio is None:
                    if not self.queue:
                        break
                    self.current_audio = self.queue.pop(0)
                    self.current_pos = 0
                take = min(chunk_size - written, len(self.current_audio) - self.current_pos)
                output[written:written + take] = self.current_audio[self.current_pos:self.current_pos + take]
                written += take
                self.current_pos += take
                if self.current_pos >= len(self.current_audio):
                    self.current_audio = None
                    self.current_pos = 0
        return output
