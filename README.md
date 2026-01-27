# Local AI Voice Agent Demo 🤖

A privacy-focused, fully local AI voice assistant featuring an expressive "Robot Eyes" UI. This project demonstrates how to build a voice agent using modern web technologies and local LLMs (Large Language Models) without relying on cloud APIs.

![Project Status](https://img.shields.io/badge/Status-Complete-success)
![Tech Stack](https://img.shields.io/badge/Stack-Python%20%7C%20FastAPI%20%7C%20Ollama%20%7C%20JS-blue)

## ✨ Features

*   **100% Local Intelligence**: Powered by [Ollama](https://ollama.com/) running on your machine. No API keys required.
*   **Expressive UI**: A "Robot Eyes" interface that changes shape and color based on state:
    *   💙 **Idle**: Calm, static cyan eyes.
    *   💚 **Listening**: Alert, round green eyes that pulse.
    *   💜 **Processing**: Squinting purple eyes that scan side-to-side.
    *   💛 **Speaking**: Happy, bouncing yellow eyes.
*   **Full Voice Interaction**:
    *   **STT (Ears)**: Uses browser-native Web Speech API for real-time transcription.
    *   **LLM (Brain)**: Connects to a local Python backend to query the AI model.
    *   **TTS (Mouth)**: Uses browser-native Speech Synthesis to read the response aloud.
*   **Developer Controls**: Built-in buttons to manually test visual states.

## 🛠️ Architecture

*   **Frontend**: HTML5, CSS3 (Animations), Vanilla JavaScript.
*   **Backend**: Python (FastAPI) acting as a bridge between the browser and Ollama.
*   **AI Engine**: Ollama (configured for `qwen3:1.7b`).

## 🚀 Getting Started

### Prerequisites

1.  **Python 3.8+** installed.
2.  **[Ollama](https://ollama.com/)** installed and running.
3.  A modern browser (Chrome, Edge, or Safari) for Web Speech API support.

### 1. Setup AI Model (Ollama)

Ensure Ollama is running and pull the model configured in the backend (default: `qwen3:1.7b`).

```bash
# Pull the model
ollama pull qwen3:1.7b
```

### 2. Setup Backend

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

# 4. Start the backend server
python backend/main.py
```
*The backend runs on `http://localhost:8000`.*

### 3. Run Frontend

Since this project uses microphone permissions, it's best served via a local web server rather than opening `index.html` directly.

**Option A: Using Python (Simplest)**
Open a new terminal window in the project root:
```bash
python -m http.server 3000
```
Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

**Option B: VS Code Live Server**
Right-click `index.html` and select "Open with Live Server".

## 🎮 Usage

1.  **Click the Robot Face** (or the screen) to wake the agent.
2.  **Speak** your query clearly (e.g., "Hello, who are you?").
3.  The agent will:
    *   **Listen** (Green Eyes)
    *   **Think** (Purple Eyes)
    *   **Speak** the answer (Yellow Eyes)
4.  **Interrupt**: Click the screen again while it's speaking to stop it.

## 📂 Project Structure

```text
voice-agent-demo/
├── index.html           # Main UI structure
├── style.css            # Robot eyes animations and styling
├── script.js            # Frontend logic (State machine, STT/TTS, API calls)
├── .gitignore           # Git ignore rules
├── README.md            # Documentation
└── backend/             # Python Backend
    ├── main.py          # FastAPI application entry point
    ├── services.py      # Logic to communicate with Ollama
    └── requirements.txt # Python dependencies
```

## ⚙️ Configuration

*   **Change AI Model**: Edit `MODEL_NAME` in `backend/services.py`.
*   **Adjust Timeout**: Edit `startListeningTimer` duration in `script.js` (default: 5000ms).
*   **Change Voice**: Edit `utterance.voice` in the `speak()` function in `script.js`.

## 🤝 Troubleshooting

*   **"Backend Error"**: Ensure the Python server is running (`python backend/main.py`) and Ollama is running (`ollama serve`).
*   **Microphone not working**: Ensure you are accessing via `localhost` or `https`. Check browser permissions.
*   **No Audio Output**: Check system volume and ensure the browser tab isn't muted.
