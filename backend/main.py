import asyncio
import io
import logging
from pathlib import Path
from typing import Dict, List, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

try:
    from .services import UpstreamServiceError, query_poe, synthesize_speech, transcribe_audio
except ImportError:
    from services import UpstreamServiceError, query_poe, synthesize_speech, transcribe_audio

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

logger = logging.getLogger("voice-agent-demo")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Voice Agent Backend")

# Keep a short in-memory chat history (sliding window).
# This is intentionally simple for classroom use: one conversation per backend process.
CHAT_WINDOW_TURNS = 4  # last N user+assistant turns
_chat_history: List[Dict[str, str]] = []
_chat_lock = asyncio.Lock()

# Enable CORS so our frontend (which might run on a different port or file://) can query this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local demo, allow all. In prod, lock this down.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


class TTSRequest(BaseModel):
    text: str


class STTResponse(BaseModel):
    text: str


class StatusResponse(BaseModel):
    status: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class HistoryResponse(BaseModel):
    max_turns: int
    messages: List[ChatMessage]


@app.get("/healthz")
def healthcheck() -> StatusResponse:
    return StatusResponse(status="後端已啟動")


@app.get("/", include_in_schema=False)
def frontend_index() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "index.html")


@app.get("/script.js", include_in_schema=False)
def frontend_script() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "script.js")


@app.get("/style.css", include_in_schema=False)
def frontend_style() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "style.css")


@app.get("/wav-recorder.js", include_in_schema=False)
def frontend_wav_recorder() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "wav-recorder.js")


@app.get("/history", response_model=HistoryResponse)
async def history_endpoint() -> HistoryResponse:
    """Return the current in-memory chat history (sliding window)."""

    async with _chat_lock:
        history_snapshot = list(_chat_history)

    messages: List[ChatMessage] = []
    for item in history_snapshot:
        # Keep the response strict and predictable.
        if item.get("role") in ("user", "assistant") and isinstance(item.get("content"), str):
            messages.append(ChatMessage(role=item["role"], content=item["content"]))

    return HistoryResponse(max_turns=CHAT_WINDOW_TURNS, messages=messages)


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """
    Receives text from frontend, queries Poe, returns AI text reply.
    """
    if not request.message:
        raise HTTPException(status_code=400, detail="訊息唔可以留空")

    logger.info("User said: %s", request.message)

    try:
        async with _chat_lock:
            history_snapshot = list(_chat_history)

        logger.info("History messages (before): %d", len(history_snapshot))

        ai_reply = await query_poe(request.message, history_snapshot)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    logger.info("AI replied: %s", ai_reply)

    async with _chat_lock:
        _chat_history.append({"role": "user", "content": request.message})
        _chat_history.append({"role": "assistant", "content": ai_reply})

        max_messages = CHAT_WINDOW_TURNS * 2
        if len(_chat_history) > max_messages:
            del _chat_history[:-max_messages]

        logger.info("History messages (after): %d", len(_chat_history))

    return ChatResponse(reply=ai_reply)


@app.post("/stt", response_model=STTResponse)
async def stt_endpoint(audio: UploadFile = File(...)) -> STTResponse:
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="音訊檔案係空嘅")

    try:
        text = await transcribe_audio(
            audio_bytes,
            audio.filename or "audio.wav",
            audio.content_type,
        )
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return STTResponse(text=text)


@app.post("/tts")
async def tts_endpoint(request: TTSRequest) -> StreamingResponse:
    if not request.text:
        raise HTTPException(status_code=400, detail="文字唔可以留空")

    try:
        audio_bytes, media_type = await synthesize_speech(request.text)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return StreamingResponse(io.BytesIO(audio_bytes), media_type=media_type)


if __name__ == "__main__":
    import uvicorn

    # Run server on localhost:8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
