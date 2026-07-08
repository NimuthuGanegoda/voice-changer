import os
import threading
from typing import Optional

import librosa
import numpy as np


class Soundboard:
    """Queues audio files and serves them as float32 chunks mixed into the input stream.

    get_chunk() runs on the audio path while add_sound()/set_sampling_rate() run on
    REST handler threads, so all state is guarded by a lock.
    """

    def __init__(self, sampling_rate: int = 48000):
        self.sampling_rate = sampling_rate
        self.queue: list[np.ndarray] = []
        self.current_pos = 0
        self.current_audio: Optional[np.ndarray] = None
        self.lock = threading.Lock()

    def add_sound(self, file_path: str) -> bool:
        if not os.path.exists(file_path):
            return False
        try:
            audio, _ = librosa.load(file_path, sr=self.sampling_rate, mono=True)
        except Exception as e:
            print(f"[Voice Changer] Soundboard failed to load {file_path}: {e}")
            return False
        with self.lock:
            self.queue.append(audio.astype(np.float32))
        return True

    def set_sampling_rate(self, sampling_rate: int):
        with self.lock:
            if sampling_rate == self.sampling_rate:
                return
            orig_sr = self.sampling_rate
            self.sampling_rate = sampling_rate
            self.queue = [librosa.resample(a, orig_sr=orig_sr, target_sr=sampling_rate) for a in self.queue]
            if self.current_audio is not None:
                remaining = self.current_audio[self.current_pos:]
                self.current_audio = librosa.resample(remaining, orig_sr=orig_sr, target_sr=sampling_rate)
                self.current_pos = 0

    def is_active(self) -> bool:
        with self.lock:
            return self.current_audio is not None or len(self.queue) > 0

    def get_chunk(self, chunk_size: int) -> np.ndarray:
        with self.lock:
            if self.current_audio is None:
                if len(self.queue) > 0:
                    self.current_audio = self.queue.pop(0)
                    self.current_pos = 0
                else:
                    return np.zeros(chunk_size, dtype=np.float32)

            remaining = len(self.current_audio) - self.current_pos
            if remaining <= chunk_size:
                chunk = np.zeros(chunk_size, dtype=np.float32)
                chunk[:remaining] = self.current_audio[self.current_pos:]
                self.current_audio = None
                self.current_pos = 0
                return chunk
            else:
                chunk = self.current_audio[self.current_pos:self.current_pos + chunk_size]
                self.current_pos += chunk_size
                return chunk
