import io

from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from recorder import BackendRecorder, RecorderError
from services import UpstreamServiceError, query_poe, transcribe_audio, synthesize_speech

app = FastAPI()
recorder = BackendRecorder()

# Enable CORS so our frontend (which might run on a different port or file://) can query this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local demo, allow all. In prod, lock this down.
    allow_credentials=True,
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


class RecordResponse(BaseModel):
    status: str


@app.get("/")
def read_root():
    return {"status": "Voice Agent Backend is running"}


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """
    Receives text from frontend, queries Poe, returns AI text reply.
    """
    if not request.message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    print(f"User said: {request.message}")

    try:
        ai_reply = await query_poe(request.message)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    print(f"AI replied: {ai_reply}")

    return ChatResponse(reply=ai_reply)


@app.post("/stt", response_model=STTResponse)
async def stt_endpoint(audio: UploadFile = File(...)):
    if not audio:
        raise HTTPException(status_code=400, detail="Audio file is required")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    try:
        text = await transcribe_audio(audio_bytes, audio.filename or "audio.ogg", audio.content_type)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return STTResponse(text=text)


@app.post("/record/start", response_model=RecordResponse)
async def start_recording():
    try:
        recorder.start()
    except RecorderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to start recording") from exc

    return RecordResponse(status="recording")


@app.post("/record/stop", response_model=STTResponse)
async def stop_recording(
    wait_for_silence: bool = Query(True, description="Wait for silence before stopping"),
    max_duration: float = Query(5.0, description="Max seconds to wait for silence"),
):
    try:
        if wait_for_silence:
            audio_bytes = recorder.stop_when_silent(max_duration=max_duration)
        else:
            audio_bytes = recorder.stop()
    except RecorderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to stop recording") from exc

    try:
        text = await transcribe_audio(audio_bytes, "recording.wav", "audio/wav")
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return STTResponse(text=text)


@app.post("/tts")
async def tts_endpoint(request: TTSRequest):
    if not request.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    try:
        audio_bytes, media_type = await synthesize_speech(request.text)
    except UpstreamServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return StreamingResponse(io.BytesIO(audio_bytes), media_type=media_type)


if __name__ == "__main__":
    import uvicorn

    # Run server on localhost:8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
