import wave
import os
from mods.log_control import VoiceChangaerLogger

logger = VoiceChangaerLogger.get_instance().getLogger()


class IORecorder:
    def __init__(self, inputFilename: str, outputFilename: str, inputSamplingRate: int, outputSamplingRate: int):
        self.fi = None
        self.fo = None
        self._closed = False

        self._prepareFile(inputFilename)
        self._prepareFile(outputFilename)

        try:
            self.fi = wave.open(inputFilename, "wb")
            self.fi.setnchannels(1)
            self.fi.setsampwidth(2)
            self.fi.setframerate(inputSamplingRate)

            self.fo = wave.open(outputFilename, "wb")
            self.fo.setnchannels(1)
            self.fo.setsampwidth(2)
            self.fo.setframerate(outputSamplingRate)
        except Exception:
            self.close()
            raise

    def _prepareFile(self, filename: str):
        parent = os.path.dirname(filename)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._clearFile(filename)

    def _clearFile(self, filename: str):
        if os.path.exists(filename):
            logger.info(f"[IORecorder] delete old analyze file. {filename}")
            os.remove(filename)
        else:
            logger.info(f"[IORecorder] old analyze file not exist. {filename}")

    def _asBytes(self, wav):
        return wav.tobytes() if hasattr(wav, "tobytes") else wav

    def writeInput(self, wav):
        if self._closed or self.fi is None:
            return
        self.fi.writeframes(self._asBytes(wav))

    def writeOutput(self, wav):
        if self._closed or self.fo is None:
            return
        self.fo.writeframes(self._asBytes(wav))

    def close(self):
        self._closed = True
        for handle_name in ("fi", "fo"):
            handle = getattr(self, handle_name, None)
            if handle is not None:
                setattr(self, handle_name, None)
                try:
                    handle.close()
                except Exception:
                    logger.debug("[IORecorder] failed to close %s", handle_name, exc_info=True)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()
