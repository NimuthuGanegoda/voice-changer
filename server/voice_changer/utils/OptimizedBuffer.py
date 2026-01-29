
import numpy as np

class OptimizedBuffer:
    def __init__(self, dtype, channels=None, initial_capacity=4096):
        self.dtype = dtype
        self.channels = channels
        # Shape: (capacity, ) or (capacity, channels)
        if channels:
            self.buffer = np.zeros((initial_capacity, channels), dtype=dtype)
        else:
            self.buffer = np.zeros(initial_capacity, dtype=dtype)
        self.write_pos = 0

    def push_and_get(self, new_data, output_size):
        """
        Appends new_data to the buffer and returns the last output_size elements.
        If necessary, it resizes the buffer or shifts data to accommodate new_data.
        If the buffer (even after append) has fewer than output_size elements, it pads with zeros at the front.
        """
        n = new_data.shape[0]
        current_capacity = self.buffer.shape[0]

        # 1. Resize if needed
        # We ensure capacity is at least output_size + n + some headroom to minimize future resizes/shifts
        if current_capacity < output_size + n:
             # Growth strategy: At least double, or fit the demand plus extra
             new_cap = max(current_capacity * 2, output_size + n + 4096)
             if self.channels:
                 new_buf = np.zeros((new_cap, self.channels), dtype=self.dtype)
             else:
                 new_buf = np.zeros(new_cap, dtype=self.dtype)

             # Copy valid data. Valid data ends at write_pos.
             if self.write_pos > 0:
                 new_buf[:self.write_pos] = self.buffer[:self.write_pos]
             self.buffer = new_buf
             current_capacity = new_cap

        # 2. Shift if needed
        # We need space for `n` at `write_pos`.
        # Also, we want to ensure that after writing, we have `output_size` valid history ending at `write_pos + n`.
        # So we effectively need to preserve `output_size - n` elements before `write_pos` (if they exist).
        # If `write_pos + n` exceeds capacity, we MUST shift.
        if self.write_pos + n > current_capacity:
            # We shift data to the beginning.
            # We only need to keep `output_size` elements *relative to the new end*.
            # The new end will be at `new_write_pos`? No, we shift so that the needed history is at 0.

            # We need `output_size - n` elements from history.
            keep_len = max(0, output_size - n)

            # Where does this history start?
            # It ends at `self.write_pos`. So it starts at `self.write_pos - keep_len`.
            start_idx = self.write_pos - keep_len

            # If start_idx < 0, it means we don't have enough history anyway.
            # We take what we have.
            if start_idx < 0:
                start_idx = 0
                keep_len = self.write_pos

            self.buffer[0:keep_len] = self.buffer[start_idx : start_idx + keep_len]
            self.write_pos = keep_len

        # 3. Append
        self.buffer[self.write_pos : self.write_pos + n] = new_data
        self.write_pos += n

        # 4. Return view or padded copy
        if self.write_pos < output_size:
            # Need padding
            if self.channels:
                res = np.zeros((output_size, self.channels), dtype=self.dtype)
            else:
                res = np.zeros(output_size, dtype=self.dtype)
            res[-self.write_pos:] = self.buffer[:self.write_pos]
            return res
        else:
            return self.buffer[self.write_pos - output_size : self.write_pos]

    def set_content(self, data):
        """
        Replaces the content of the buffer with `data`.
        Useful when an external process (like inference) updates the buffer state.
        """
        n = data.shape[0]
        current_capacity = self.buffer.shape[0]

        if n > current_capacity:
            # Resize
            new_cap = max(current_capacity * 2, n + 4096)
            if self.channels:
                self.buffer = np.zeros((new_cap, self.channels), dtype=self.dtype)
            else:
                self.buffer = np.zeros(new_cap, dtype=self.dtype)

        self.buffer[:n] = data
        self.write_pos = n
