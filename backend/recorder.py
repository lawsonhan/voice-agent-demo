import io
import threading
import time
import wave

import numpy as np
import sounddevice as sd


class RecorderError(Exception):
    pass


class BackendRecorder:
    def __init__(self, samplerate: int = 16000, channels: int = 1):
        self.samplerate = samplerate
        self.channels = channels
        self._lock = threading.Lock()
        self._frames: list[np.ndarray] = []
        self._stream: sd.InputStream | None = None
        self._silence_event: threading.Event | None = None
        self._start_time: float | None = None
        self._last_voice_time: float | None = None

    def _callback(self, indata, frames, time, status):
        if status:
            print(f"Recorder status: {status}")
        with self._lock:
            self._frames.append(indata.copy())
        self._update_voice_activity(indata)

    def _update_voice_activity(self, indata: np.ndarray) -> None:
        if self._silence_event is None:
            return
        now = time.monotonic()
        rms = np.sqrt(np.mean(indata.astype(np.float32) ** 2))
        if rms > 500:
            self._last_voice_time = now
            return
        if self._last_voice_time is None or self._start_time is None:
            return
        if now - self._last_voice_time >= 0.8 and now - self._start_time >= 0.5:
            self._silence_event.set()

    @property
    def is_recording(self) -> bool:
        return self._stream is not None and self._stream.active

    def start(self) -> None:
        if self.is_recording:
            raise RecorderError("Recording already in progress")
        self._frames = []
        self._silence_event = threading.Event()
        self._start_time = time.monotonic()
        self._last_voice_time = self._start_time
        self._stream = sd.InputStream(
            samplerate=self.samplerate,
            channels=self.channels,
            dtype="int16",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> bytes:
        if not self._stream:
            raise RecorderError("Recording has not been started")
        self._stream.stop()
        self._stream.close()
        self._stream = None
        self._silence_event = None
        self._start_time = None
        self._last_voice_time = None

        with self._lock:
            if not self._frames:
                raise RecorderError("No audio captured")
            audio_data = np.concatenate(self._frames, axis=0)
            self._frames = []

        return self._to_wav_bytes(audio_data)

    def stop_when_silent(self, max_duration: float = 5.0) -> bytes:
        if not self._stream:
            raise RecorderError("Recording has not been started")
        if self._silence_event is None:
            raise RecorderError("Silence detector not initialized")
        self._silence_event.wait(timeout=max_duration)
        return self.stop()

    def _to_wav_bytes(self, audio_data: np.ndarray) -> bytes:
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wav_file:
            wav_file.setnchannels(self.channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.samplerate)
            wav_file.writeframes(audio_data.tobytes())
        return wav_buffer.getvalue()
