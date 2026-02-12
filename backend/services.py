"""backend/services.py

External API integrations.

This file keeps all upstream calls in one place so students can see the
full request/response flow without jumping between many files.

Upstreams:
- Poe (OpenAI-compatible chat/completions)
- Cantonese AI (STT / TTS)
"""

import os
from typing import Any, Dict, Optional, Tuple

import httpx

POE_API_URL = "https://api.poe.com/v1/chat/completions"

# Cantonese AI endpoints
CANTONESE_STT_URL = "https://paid-api.cantonese.ai"
CANTONESE_TTS_URL = "https://cantonese.ai/api/tts"

DEFAULT_POE_MODEL = "gpt-4o"
DEFAULT_TTS_OUTPUT = "mp3"  # mp3 | wav
DEFAULT_TTS_LANGUAGE = "cantonese"
DEFAULT_TTS_FRAME_RATE = 24000
DEFAULT_TTS_SPEED = 1.0

SYSTEM_PROMPT = (
    "你係一個面向香港小學生嘅語音小幫手。"
    "請用地道香港廣東話口語（繁體字、白話）回答，語氣友善、有禮貌。"
    "因為答案會被讀出嚟，所以每次盡量 1 句，句子短啲，避免長篇大論同專業術語；"
    "如果問題唔清楚，先問 1 條追問先再答。"
    "遇到危險、犯法、成人內容、自殘或需要大人處理嘅情況，"
)


class UpstreamServiceError(RuntimeError):
    """Raised when an upstream API request fails or returns an unexpected format."""


def _get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise UpstreamServiceError(f"Missing required environment variable: {name}.")
    return value


def _get_optional_env(name: str) -> Optional[str]:
    value = os.getenv(name)
    if not value:
        return None
    return value


def _get_env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _get_env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _get_env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _sanitize_content_type(content_type: Optional[str]) -> str:
    if not content_type:
        return "application/octet-stream"
    return content_type.split(";")[0].strip()


def _tts_media_type(output_extension: str) -> str:
    if output_extension == "wav":
        return "audio/wav"
    return "audio/mpeg"


async def _post(
    service_name: str,
    url: str,
    *,
    json: Optional[Dict[str, Any]] = None,
    data: Optional[Dict[str, Any]] = None,
    files: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout_seconds: float = 60.0,
) -> httpx.Response:
    """POST helper with consistent error messages."""

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                url,
                json=json,
                data=data,
                files=files,
                headers=headers,
            )
            response.raise_for_status()
            return response
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        raise UpstreamServiceError(
            f"{service_name} error (status {exc.response.status_code}): {detail}"
        ) from exc
    except httpx.RequestError as exc:
        raise UpstreamServiceError(f"{service_name} request failed: {exc}") from exc


async def query_poe(user_message: str) -> str:
    """Call Poe chat completions and return the assistant message content."""

    api_key = _get_required_env("POE_API_KEY")
    model = _get_env_str("POE_MODEL", DEFAULT_POE_MODEL)

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = await _post(
        "Poe API",
        POE_API_URL,
        json=payload,
        headers=headers,
        timeout_seconds=45.0,
    )

    data = response.json()

    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, AttributeError) as exc:
        raise UpstreamServiceError("Unexpected response format from Poe API.") from exc


async def transcribe_audio(audio_bytes: bytes, filename: str, content_type: Optional[str]) -> str:
    """Send audio bytes to Cantonese AI STT and return recognized text."""

    api_key = _get_required_env("CANTONESE_API_KEY")

    if not audio_bytes:
        raise UpstreamServiceError("Audio payload is empty.")

    data = {
        "api_key": api_key,
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

    response = await _post(
        "Cantonese AI STT",
        CANTONESE_STT_URL,
        data=data,
        files=files,
        timeout_seconds=60.0,
    )

    payload = response.json()
    text = payload.get("text", "")
    if not isinstance(text, str):
        raise UpstreamServiceError("Unexpected response format from STT API.")

    return text.strip()


async def synthesize_speech(text: str) -> Tuple[bytes, str]:
    """Send text to Cantonese AI TTS and return (audio_bytes, media_type)."""

    api_key = _get_required_env("CANTONESE_API_KEY")

    output_extension = _get_env_str("CANTONESE_TTS_OUTPUT", DEFAULT_TTS_OUTPUT).lower()
    if output_extension not in {"mp3", "wav"}:
        output_extension = DEFAULT_TTS_OUTPUT

    payload: Dict[str, Any] = {
        "api_key": api_key,
        "text": text,
        "frame_rate": _get_env_int("CANTONESE_TTS_FRAME_RATE", DEFAULT_TTS_FRAME_RATE),
        "speed": _get_env_float("CANTONESE_TTS_SPEED", DEFAULT_TTS_SPEED),
        "language": _get_env_str("CANTONESE_TTS_LANGUAGE", DEFAULT_TTS_LANGUAGE),
        "output_extension": output_extension,
        "should_return_timestamp": False,
    }

    voice_id = _get_optional_env("CANTONESE_TTS_VOICE_ID")
    if voice_id:
        payload["voice_id"] = voice_id

    response = await _post(
        "Cantonese AI TTS",
        CANTONESE_TTS_URL,
        json=payload,
        timeout_seconds=60.0,
    )

    audio_bytes = response.content
    if not audio_bytes:
        raise UpstreamServiceError("TTS API returned empty audio payload.")

    return audio_bytes, _tts_media_type(output_extension)
