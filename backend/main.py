import io
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.services import UpstreamServiceError, query_poe, synthesize_speech, transcribe_audio

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

logger = logging.getLogger("voice-agent-demo")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Voice Agent Backend")

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


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/status")
def read_root() -> StatusResponse:
    return StatusResponse(status="Voice Agent Backend is running")


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """
    Receives text from frontend, queries Poe, returns AI text reply.
    """
    if not request.message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    logger.info("User said: %s", request.message)

    try:
        ai_reply = await query_poe(request.message)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    logger.info("AI replied: %s", ai_reply)

    return ChatResponse(reply=ai_reply)


@app.post("/api/stt", response_model=STTResponse)
async def stt_endpoint(audio: UploadFile = File(...)) -> STTResponse:
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    try:
        text = await transcribe_audio(
            audio_bytes,
            audio.filename or "audio.wav",
            audio.content_type,
        )
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return STTResponse(text=text)


@app.post("/api/tts")
async def tts_endpoint(request: TTSRequest) -> StreamingResponse:
    if not request.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        audio_bytes, media_type = await synthesize_speech(request.text)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return StreamingResponse(io.BytesIO(audio_bytes), media_type=media_type)


# Serve the static frontend (Cloud Run-friendly single service).
app.mount("/", StaticFiles(directory=str(PROJECT_ROOT / "frontend"), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
