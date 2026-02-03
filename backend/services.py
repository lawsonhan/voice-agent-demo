import os
from typing import Optional, Tuple

import httpx

POE_API_URL = "https://api.poe.com/v1/chat/completions"
POE_MODEL = os.getenv("POE_MODEL", "Claude-Sonnet-4")
POE_API_KEY = os.getenv("POE_API_KEY")

CANTONESE_STT_URL = "https://paid-api.cantonese.ai"
CANTONESE_TTS_URL = "https://cantonese.ai/api/tts"
CANTONESE_API_KEY = os.getenv("CANTONESE_API_KEY")

CANTONESE_TTS_OUTPUT = os.getenv("CANTONESE_TTS_OUTPUT", "mp3").lower()
CANTONESE_TTS_VOICE_ID = os.getenv("CANTONESE_TTS_VOICE_ID")
CANTONESE_TTS_LANGUAGE = os.getenv("CANTONESE_TTS_LANGUAGE", "cantonese")
CANTONESE_TTS_FRAME_RATE = os.getenv("CANTONESE_TTS_FRAME_RATE", "24000")


def _parse_float(value: str, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


CANTONESE_TTS_SPEED = _parse_float(os.getenv("CANTONESE_TTS_SPEED", "1.0"), 1.0)

SYSTEM_PROMPT = (
    "You are a helpful voice assistant. Keep your answers concise, conversational, "
    "and short (under 1 sentence if possible) because your output will be spoken aloud."
)


class UpstreamServiceError(RuntimeError):
    pass


def _require_env(name: str, value: Optional[str]) -> None:
    if not value:
        raise UpstreamServiceError(
            f"Missing required environment variable: {name}."
        )


def _sanitize_content_type(content_type: Optional[str]) -> str:
    if not content_type:
        return "application/octet-stream"
    return content_type.split(";")[0].strip()


def _get_tts_media_type(output_extension: str) -> str:
    if output_extension == "wav":
        return "audio/wav"
    return "audio/mpeg"


async def query_poe(user_message: str) -> str:
    _require_env("POE_API_KEY", POE_API_KEY)

    payload = {
        "model": POE_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
    }

    headers = {
        "Authorization": f"Bearer {POE_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(POE_API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise UpstreamServiceError(f"Poe API request failed: {exc}") from exc

    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, AttributeError) as exc:
        raise UpstreamServiceError("Unexpected response format from Poe API.") from exc


async def transcribe_audio(
    audio_bytes: bytes, filename: str, content_type: str
) -> str:
    _require_env("CANTONESE_API_KEY", CANTONESE_API_KEY)

    if not audio_bytes:
        raise UpstreamServiceError("Audio payload is empty.")

    data = {
        "api_key": CANTONESE_API_KEY,
        "with_timestamp": "false",
        "with_diarization": "false",
    }

    files = {
        "data": (
            filename,
            audio_bytes,
            _sanitize_content_type(content_type),
        )
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(CANTONESE_STT_URL, data=data, files=files)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise UpstreamServiceError(f"Cantonese AI STT request failed: {exc}") from exc

    text = payload.get("text", "")
    if not isinstance(text, str):
        raise UpstreamServiceError("Unexpected response format from STT API.")

    return text.strip()


async def synthesize_speech(text: str) -> Tuple[bytes, str]:
    _require_env("CANTONESE_API_KEY", CANTONESE_API_KEY)

    output_extension = CANTONESE_TTS_OUTPUT
    if output_extension not in {"mp3", "wav"}:
        output_extension = "mp3"

    payload = {
        "api_key": CANTONESE_API_KEY,
        "text": text,
        "frame_rate": CANTONESE_TTS_FRAME_RATE,
        "speed": CANTONESE_TTS_SPEED,
        "language": CANTONESE_TTS_LANGUAGE,
        "output_extension": output_extension,
        "should_return_timestamp": False,
    }

    if CANTONESE_TTS_VOICE_ID:
        payload["voice_id"] = CANTONESE_TTS_VOICE_ID

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(CANTONESE_TTS_URL, json=payload)
            response.raise_for_status()
            audio_bytes = response.content
    except httpx.HTTPError as exc:
        raise UpstreamServiceError(f"Cantonese AI TTS request failed: {exc}") from exc

    if not audio_bytes:
        raise UpstreamServiceError("TTS API returned empty audio payload.")

    return audio_bytes, _get_tts_media_type(output_extension)
