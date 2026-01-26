const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking'
};

class VoiceAgent {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.transcriptDisplay = document.getElementById('transcript');
        this.state = STATES.IDLE;
        this.listeningTimer = null;
        
        this.recognition = this.initSpeechRecognition();
        this.synth = window.speechSynthesis;
        this.backendUrl = 'http://localhost:8000/chat';

        this.element.addEventListener('click', () => this.handleInteraction());
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser does not support Speech Recognition.");
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';     
        recognition.interimResults = true; 
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log("Microphone active.");
            this.updateTranscript("Listening...");
            this.startListeningTimer();
        };

        recognition.onresult = (event) => {
            this.clearListeningTimer();
            
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            const textToShow = finalTranscript || interimTranscript;
            this.updateTranscript(textToShow);

            if (finalTranscript) {
                console.log("Final User said:", finalTranscript);
                this.processUserInput(finalTranscript);
            }
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            this.clearListeningTimer();
            this.updateTranscript("Error: " + event.error);
            setTimeout(() => this.transitionTo(STATES.IDLE), 2000);
        };

        recognition.onend = () => {
            if (this.state === STATES.LISTENING) {
                console.log("Recognition ended without result.");
                this.updateTranscript(""); 
                this.transitionTo(STATES.IDLE);
            }
        };

        return recognition;
    }

    handleInteraction() {
        if (this.state === STATES.IDLE) {
            this.startListening();
        } else if (this.state === STATES.LISTENING) {
            this.stopListening();
        } else if (this.state === STATES.SPEAKING || this.state === STATES.PROCESSING) {
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
            this.recognition.stop();
            this.clearListeningTimer();
        }
    }

    startListeningTimer() {
        this.clearListeningTimer();
        this.listeningTimer = setTimeout(() => {
            console.log("Listening timeout.");
            this.updateTranscript("No speech detected.");
            this.stopListening(); 
        }, 5000);
    }

    clearListeningTimer() {
        if (this.listeningTimer) {
            clearTimeout(this.listeningTimer);
            this.listeningTimer = null;
        }
    }

    updateTranscript(text) {
        if (this.transcriptDisplay) {
            this.transcriptDisplay.textContent = text;
            if (text) {
                this.transcriptDisplay.classList.add('active');
            } else {
                this.transcriptDisplay.classList.remove('active');
            }
        }
    }

    async processUserInput(text) {
        this.updateTranscript(text); 
        this.transitionTo(STATES.PROCESSING);

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
            this.updateTranscript("Backend Error. Is it running?");
            this.speak("Sorry, I couldn't reach my brain.");
        }
    }

    speak(text) {
        if (this.synth.speaking) {
            this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        
        utterance.onstart = () => {
            this.transitionTo(STATES.SPEAKING);
            this.updateTranscript(text); 
        };

        utterance.onend = () => {
            this.transitionTo(STATES.IDLE);
            this.updateTranscript(""); 
        };

        utterance.onerror = (e) => {
            console.error('TTS Error:', e);
            this.transitionTo(STATES.IDLE);
        };

        this.synth.speak(utterance);
    }

    transitionTo(newState) {
        if (this.state === newState) return;

        console.log(`Transitioning: ${this.state} -> ${newState}`);
        this.state = newState;
        this.element.setAttribute('data-state', newState);
        
        if (newState === STATES.IDLE) {
            this.updateTranscript("");
        }
    }
}

const agent = new VoiceAgent('agent-button');