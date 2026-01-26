const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    SPEAKING: 'speaking'
};

class VoiceAgent {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.state = STATES.IDLE;
        
        // --- Core Components ---
        this.recognition = this.initSpeechRecognition();
        this.synth = window.speechSynthesis;
        this.backendUrl = 'http://localhost:8000/chat';

        // --- Event Listeners ---
        this.element.addEventListener('click', () => this.handleInteraction());
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser does not support Speech Recognition. Please use Chrome or Safari.");
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false; // Stop after one sentence
        recognition.lang = 'en-US';     // Default to English, change to 'zh-CN' for Chinese
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log("Microphone active.");
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log("User said:", transcript);
            this.processUserUnput(transcript);
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            this.transitionTo(STATES.IDLE);
        };

        recognition.onend = () => {
            // If we are still in listening state but no result, go back to idle
            // (Handled by processUserUnput logic usually)
        };

        return recognition;
    }

    handleInteraction() {
        if (this.state === STATES.IDLE) {
            this.startListening();
        } else if (this.state === STATES.SPEAKING) {
            // Allow interrupting the agent
            this.synth.cancel();
            this.transitionTo(STATES.IDLE);
        }
    }

    startListening() {
        if (!this.recognition) return;
        
        try {
            this.transitionTo(STATES.LISTENING);
            this.recognition.start();
        } catch (e) {
            console.error("Could not start recognition:", e);
            this.transitionTo(STATES.IDLE);
        }
    }

    async processUserUnput(text) {
        // Visual feedback: Maybe stay in 'Listening' but freeze animation? 
        // For now, we keep the green waveform while "Thinking"
        
        try {
            const response = await fetch(this.backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            if (!response.ok) throw new Error('Backend error');

            const data = await response.json();
            const aiReply = data.reply;
            
            console.log("AI replied:", aiReply);
            this.speak(aiReply);

        } catch (error) {
            console.error("Error talking to backend:", error);
            this.speak("Sorry, I couldn't reach my brain. Is the backend running?");
        }
    }

    speak(text) {
        if (this.synth.speaking) {
            console.error('speechSynthesis.speaking');
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        
        // Optional: Select a specific voice
        // const voices = this.synth.getVoices();
        // utterance.voice = voices.find(v => v.name === 'Samantha'); 

        utterance.onstart = () => {
            this.transitionTo(STATES.SPEAKING);
        };

        utterance.onend = () => {
            this.transitionTo(STATES.IDLE);
        };

        utterance.onerror = (e) => {
            console.error('TTS Error:', e);
            this.transitionTo(STATES.IDLE);
        };

        this.synth.speak(utterance);
    }

    transitionTo(newState) {
        console.log(`Transitioning: ${this.state} -> ${newState}`);
        this.state = newState;
        this.element.setAttribute('data-state', newState);
    }
}

// Initialize the agent
const agent = new VoiceAgent('agent-button');