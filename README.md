# External AI Voice Agent Demo

A voice assistant demo featuring an expressive "Robot Eyes" UI and **fully external** AI services. This project uses Cantonese AI for speech-to-text and text-to-speech, plus Poe for LLM responses.

![Project Status](https://img.shields.io/badge/Status-Complete-success)
![Tech Stack](https://img.shields.io/badge/Stack-Python%20%7C%20FastAPI%20%7C%20Cantonese%20AI%20%7C%20Poe%20%7C%20JS-blue)

## ✨ Features

*   **External STT (Ears)**: Cantonese AI speech-to-text (recorded in the browser and uploaded).
*   **External LLM (Brain)**: Poe OpenAI-compatible chat completions.
*   **External TTS (Mouth)**: Cantonese AI text-to-speech.
*   **Expressive UI**: A "Robot Eyes" interface that changes shape and color based on state.
*   **Developer Controls**: Buttons to manually test visual states.
*   **Browser Recording**: Records from the user's microphone via `getUserMedia`.

## 🛠️ Architecture

*   **Frontend**: HTML5, CSS3 (Animations), Vanilla JavaScript.
*   **Backend**: Python (FastAPI) acting as a bridge to external APIs.
*   **AI Services**:
    *   Cantonese AI for STT/TTS.
    *   Poe for LLM chat responses.

## 🚀 Getting Started

### Prerequisites

1.  **Python 3.8+** installed.
2.  **Cantonese AI API key**.
3.  **Poe API key**.

### 1. Setup Backend

Navigate to the project root and set up the Python environment.

```bash
# 1. Create a virtual environment
python3 -m venv venv

# 2. Activate it (macOS/Linux)
source venv/bin/activate
# OR (Windows)
# venv\Scripts\activate

# 3. Install dependencies
pip install -r backend/requirements.txt
```

### 2. Configure Environment Variables

Set the required API keys (and optional settings) before starting the backend:

```bash
# Required
export CANTONESE_API_KEY="your_cantonese_api_key"
export POE_API_KEY="your_poe_api_key"

# Optional
export POE_MODEL="Claude-Sonnet-4"
export CANTONESE_TTS_VOICE_ID=""
export CANTONESE_TTS_OUTPUT="mp3"   # mp3 | wav
export CANTONESE_TTS_LANGUAGE="cantonese"
export CANTONESE_TTS_FRAME_RATE="24000"
export CANTONESE_TTS_SPEED="1.0"
```

### 3. Start Backend

```bash
python backend/main.py
```
Then open `http://localhost:8000` in your browser and allow microphone access.

## 🎮 Usage

1.  **Click the Robot Face** to start recording (browser microphone).
2.  **Speak** your query clearly.
3.  Click again to stop recording (or wait for the timeout).
4.  The agent will:
    *   **Listen** (Green Eyes)
    *   **Think** (Purple Eyes)
    *   **Speak** (Yellow Eyes)
5.  **Interrupt**: Click again while it’s speaking to stop playback.

## 📂 Project Structure

```text
voice-agent-demo/
├── frontend/            # Static UI (served by backend)
│   ├── index.html       # Main UI structure
│   ├── style.css        # Robot eyes animations and styling
│   └── script.js        # Frontend logic (State machine, STT/TTS, API calls)
├── .gitignore           # Git ignore rules
├── README.md            # Documentation
└── backend/             # Python Backend
    ├── main.py          # FastAPI application entry point
    ├── services.py      # API integrations (Cantonese AI + Poe)
    └── requirements.txt # Python dependencies
```

## ☁️ Deploy (Cloud Run)

This repo includes a `Dockerfile` that serves both the frontend and backend from one Cloud Run service.

```bash
gcloud run deploy voice-agent-demo \
  --source . \
  --region YOUR_REGION \
  --allow-unauthenticated \
  --set-env-vars CANTONESE_API_KEY=...,POE_API_KEY=...
```

## ⚙️ Configuration

*   **Change LLM model**: Edit `POE_MODEL` env var (see Poe model list).
*   **Change voice**: Edit `CANTONESE_TTS_VOICE_ID` env var.
*   **Adjust timeout**: Edit `RECORDING_TIMEOUT_MS` in `script.js`.

## 🤝 Troubleshooting

*   **"Backend error" / "STT error" / "TTS error"**: Ensure the Python server is running and API keys are set.
*   **Microphone not working**: Ensure the backend host has a microphone and permissions to access it.
*   **No Audio Output**: Check system volume and ensure the browser tab isn't muted.
