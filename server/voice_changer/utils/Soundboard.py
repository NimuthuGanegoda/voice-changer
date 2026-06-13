import numpy as np
import librosa
import os
from typing import Optional

class Soundboard:
    def __init__(self, sampling_rate: int = 16000):
        self.sampling_rate = sampling_rate
        self.queue = []
        self.current_pos = 0
        self.current_audio: Optional[np.ndarray] = None

    def add_sound(self, file_path: str):
        if not os.path.exists(file_path):
            return False
        try:
            audio, _ = librosa.load(file_path, sr=self.sampling_rate)
            self.queue.append(audio)
            return True
        except Exception as e:
            print(f"Error loading sound: {e}")
            return False

    def get_chunk(self, chunk_size: int) -> np.ndarray:
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
