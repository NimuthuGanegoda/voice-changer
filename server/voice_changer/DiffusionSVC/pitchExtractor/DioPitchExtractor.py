import pyworld
import numpy as np
from const import PitchExtractorType

from voice_changer.DiffusionSVC.pitchExtractor.PitchExtractor import PitchExtractor
from voice_changer.utils.VoiceChangerModel import AudioInOut


class DioPitchExtractor(PitchExtractor):

    def __init__(self):
        super().__init__()
        self.pitchExtractorType: PitchExtractorType = "dio"
        self.f0_min = 50
        self.f0_max = 1100
        # self.sapmle_rate = 44100
        # self.sapmle_rate = 16000
        self.uv_interp = True

    def extract(self, audio: AudioInOut, sr: int, block_size: int, model_sr: int, pitch, f0_up_key, silence_front=0):
        # silence_front: int = 0.  # TODO: chunkサイズが小さいときに音程を取れなくなる対策
        hop_size = block_size * sr / model_sr

        offset_frame_number = silence_front * sr
        start_frame = int(offset_frame_number / hop_size)  # frame
        real_silence_front = start_frame * hop_size / sr  # 秒
        audio = audio[int(np.round(real_silence_front * sr)):]

        # countermeasure for small chunk size
        # pad with constant if the audio is too short
        required_len = int(hop_size * 4)
        original_len = audio.shape[0]
        pad_left = 0
        if original_len < required_len:
            pad_left = int(hop_size * 2) - original_len // 2
            pad_left = max(0, pad_left)
            total_target = max(required_len, pad_left + original_len + int(hop_size))
            pad_right = total_target - original_len - pad_left
            audio = np.pad(audio, (pad_left, pad_right), mode="reflect")

        # Use a smaller frame_period for small chunks to increase chance of valid detection
        current_frame_period = 1000 * hop_size / sr
        current_f0_min = self.f0_min
        if pad_left > 0:
             current_frame_period = min(current_frame_period, 10.0)
             # If audio is short, we can't detect low frequencies.
             # Window size ~ 3.0 / f0. We need Window size <= original_len
             # f0 >= 3.0 / original_len
             safe_f0_floor = 3.0 / (original_len / sr)
             current_f0_min = max(current_f0_min, safe_f0_floor)
             current_f0_min = min(current_f0_min, self.f0_max - 50)

        _f0, t = pyworld.dio(
            audio.astype(np.double),
            sr,
            f0_floor=current_f0_min,
            f0_ceil=self.f0_max,
            channels_in_octave=2,
            frame_period=current_frame_period
        )
        f0 = pyworld.stonemask(audio.astype(np.double), _f0, t, sr)

        if pad_left > 0:
            center_time = (pad_left + original_len / 2) / sr
            idx = np.argmin(np.abs(t - center_time))
            if idx < len(f0):
                f0 = f0[idx:idx+1]
        pitch[-f0.shape[0]:] = f0[:pitch.shape[0]]
        f0 = pitch

        if self.uv_interp:
            uv = f0 == 0
            if len(f0[~uv]) > 0:
                f0[uv] = np.interp(np.where(uv)[0], np.where(~uv)[0], f0[~uv])
            f0[f0 < self.f0_min] = self.f0_min

        f0 = f0 * 2 ** (float(f0_up_key) / 12)

        return f0
