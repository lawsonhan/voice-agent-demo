# External AI Voice Agent Demo

A simple teaching/demo voice assistant with an expressive "Robot Eyes" UI.

- STT: Cantonese AI (supports Cantonese)
- LLM: Poe (`/v1/chat/completions` compatible)
- TTS: Cantonese AI

## How It Works

1. Browser records microphone audio and encodes it as `wav`.
2. Backend sends audio to Cantonese AI STT.
3. Backend sends the transcript to Poe.
4. Backend sends the reply text to Cantonese AI TTS.
5. Browser plays the returned audio.

## Requirements

- Python 3.8+
- Chrome (recommended)
- No extra system software required (no ffmpeg).
- API keys:
  - `CANTONESE_API_KEY`
  - `POE_API_KEY`

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

cp .env.example .env
# edit .env
```

## Run

Backend:
```bash
python3 backend/main.py
```

Frontend:
```bash
python -m http.server 3000
```

Open `http://localhost:3000`.

Single-process mode (backend also serves frontend at `/`):
```bash
uvicorn backend.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open `http://localhost:8000`.

## Usage

- Click the face to start recording.
- Click again to stop (or wait for silence/timeout).
- The agent will transcribe, reply, and speak.
- The left floating panel shows the agent's current short-term memory (sliding window).

## Notes

- `.env` is auto-loaded by the backend (via `python-dotenv`).
- If STT/TTS fails, check backend logs and confirm API keys in `.env`.
- See `structure.md` for a detailed explanation of the code structure (香港繁體中文).

## Cloud Run (Docker)

Build and push the image:
```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/voice-agent-demo
```

Deploy to Cloud Run:
```bash
gcloud run deploy voice-agent-demo \
  --image gcr.io/PROJECT_ID/voice-agent-demo \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --set-env-vars CANTONESE_API_KEY=YOUR_KEY,POE_API_KEY=YOUR_KEY
```

After deployment:
- App UI: `https://YOUR_CLOUD_RUN_URL/`
- Health check: `https://YOUR_CLOUD_RUN_URL/healthz`
