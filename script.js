const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    SPEAKING: 'speaking'
};

class VoiceAgent {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.state = STATES.IDLE;
        this.listeningTimer = null; // Timer for silence timeout
        
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
        recognition.lang = 'en-US';     
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log("Microphone active.");
            // Start a 5-second safety timer. If no speech result by then, abort.
            this.startListeningTimer();
        };

        recognition.onresult = (event) => {
            this.clearListeningTimer(); // Speech detected, clear timeout
            const transcript = event.results[0][0].transcript;
            console.log("User said:", transcript);
            this.processUserUnput(transcript);
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            this.clearListeningTimer();
            this.transitionTo(STATES.IDLE);
        };

        recognition.onend = () => {
            // Usually fires after result or error. 
            // If we are still 'listening' (e.g. user just stopped speaking but no result yet processed),
            // we might want to go to idle. 
            // But usually onresult handles the state change to 'processing' (which we simulate by staying in listening or moving to thinking).
            
            // If we are still explicitly in LISTENING state after onend, it means no result was processed.
            if (this.state === STATES.LISTENING) {
                console.log("Recognition ended without result.");
                this.transitionTo(STATES.IDLE);
            }
        };

        return recognition;
    }

    handleInteraction() {
        if (this.state === STATES.IDLE) {
            this.startListening();
        } else if (this.state === STATES.LISTENING) {
            // Manual Stop Listening
            console.log("Manual stop listening");
            this.stopListening();
        } else if (this.state === STATES.SPEAKING) {
            // Manual Stop Speaking
            console.log("Manual stop speaking");
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

    stopListening() {
        if (this.recognition) {
            this.recognition.stop(); // This triggers onend
            this.clearListeningTimer();
        }
    }

    startListeningTimer() {
        this.clearListeningTimer();
        this.listeningTimer = setTimeout(() => {
            console.log("Listening timeout - no speech detected.");
            this.stopListening(); 
        }, 5000); // 5 seconds timeout
    }

    clearListeningTimer() {
        if (this.listeningTimer) {
            clearTimeout(this.listeningTimer);
            this.listeningTimer = null;
        }
    }

    async processUserUnput(text) {
        // Here we could transition to a 'THINKING' state if we had one.
        // For now, let's keep the waveform but maybe pause it? 
        // Or just let it stay until we get the reply.
        
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
            this.synth.cancel(); // Stop current speech if any
        }

        const utterance = new SpeechSynthesisUtterance(text);
        
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
        // Prevent state thrashing if already in state
        if (this.state === newState) return;

        console.log(`Transitioning: ${this.state} -> ${newState}`);
        this.state = newState;
        this.element.setAttribute('data-state', newState);
    }
}

// Initialize the agent
const agent = new VoiceAgent('agent-button');
