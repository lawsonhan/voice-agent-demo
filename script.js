const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking'
};

const RECORDING_TIMEOUT_MS = 5000;

class VoiceAgent {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.transcriptDisplay = document.getElementById('transcript');
        this.state = STATES.IDLE;
        this.listeningTimer = null;

        this.audio = null;
        this.fetchController = null;

        this.chatUrl = 'http://localhost:8000/chat';
        this.recordStartUrl = 'http://localhost:8000/record/start';
        this.recordStopUrl = 'http://localhost:8000/record/stop?wait_for_silence=true';
        this.ttsUrl = 'http://localhost:8000/tts';

        this.element.addEventListener('click', () => {
            this.handleInteraction().catch((error) => {
                console.error('Interaction error:', error);
            });
        });
    }

    async handleInteraction() {
        if (this.state === STATES.IDLE) {
            await this.startListening();
            return;
        }

        if (this.state === STATES.LISTENING) {
            this.stopListening();
            return;
        }

        if (this.state === STATES.SPEAKING || this.state === STATES.PROCESSING) {
            this.cancelActiveWork();
        }
    }

    async startListening() {
        this.cancelActiveWork();
        this.transitionTo(STATES.LISTENING);
        this.updateTranscript('Listening (backend recording)...');

        try {
            const controller = this.createAbortController();
            const response = await fetch(this.recordStartUrl, {
                method: 'POST',
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error('Backend recording start failed');
            }

            this.startListeningTimer();
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Recording start error:', error);
            this.updateTranscript('Recording start failed.');
            this.transitionTo(STATES.IDLE);
        } finally {
            this.clearAbortController();
        }
    }

    stopListening() {
        this.clearListeningTimer();
        this.stopBackendRecording().catch((error) => {
            console.error('Recording stop error:', error);
        });
    }

    startListeningTimer() {
        this.clearListeningTimer();
        this.listeningTimer = setTimeout(() => {
            console.log('Listening timeout.');
            this.updateTranscript('No speech detected.');
            this.stopListening();
        }, RECORDING_TIMEOUT_MS);
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

    createAbortController() {
        if (this.fetchController) {
            this.fetchController.abort();
        }
        this.fetchController = new AbortController();
        return this.fetchController;
    }

    clearAbortController() {
        this.fetchController = null;
    }

    async stopBackendRecording() {
        this.transitionTo(STATES.PROCESSING);
        this.updateTranscript('Transcribing...');

        const controller = this.createAbortController();

        try {
            const response = await fetch(this.recordStopUrl, {
                method: 'POST',
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error('Backend recording stop failed');
            }

            const data = await response.json();
            const text = (data.text || '').trim();

            if (!text) {
                this.updateTranscript('No speech recognized.');
                this.transitionTo(STATES.IDLE);
                return;
            }

            this.updateTranscript(text);
            await this.processUserInput(text);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('STT error:', error);
            this.updateTranscript('STT error.');
            this.transitionTo(STATES.IDLE);
        } finally {
            this.clearAbortController();
        }
    }

    async processUserInput(text) {
        this.transitionTo(STATES.PROCESSING);

        const controller = this.createAbortController();

        try {
            const response = await fetch(this.chatUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
                signal: controller.signal
            });

            if (!response.ok) throw new Error('Backend error');

            const data = await response.json();
            const aiReply = data.reply || '';

            console.log('AI replied:', aiReply);
            await this.speak(aiReply);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Chat error:', error);
            this.updateTranscript('Backend error.');
            this.transitionTo(STATES.IDLE);
        } finally {
            this.clearAbortController();
        }
    }

    async speak(text) {
        if (!text) {
            this.transitionTo(STATES.IDLE);
            return;
        }

        this.transitionTo(STATES.PROCESSING);
        this.updateTranscript('Synthesizing...');

        const controller = this.createAbortController();

        try {
            const response = await fetch(this.ttsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error('TTS backend error');
            }

            const audioBlob = await response.blob();
            await this.playAudioBlob(audioBlob, text);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('TTS error:', error);
            this.updateTranscript('TTS error.');
            this.transitionTo(STATES.IDLE);
        } finally {
            this.clearAbortController();
        }
    }

    async playAudioBlob(audioBlob, transcriptText) {
        if (this.audio) {
            this.audio.pause();
            if (this.audio.src) {
                URL.revokeObjectURL(this.audio.src);
            }
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        this.audio = new Audio(audioUrl);

        this.audio.onplay = () => {
            this.transitionTo(STATES.SPEAKING);
            this.updateTranscript(transcriptText);
        };

        this.audio.onended = () => {
            this.transitionTo(STATES.IDLE);
            this.updateTranscript('');
            URL.revokeObjectURL(audioUrl);
        };

        this.audio.onerror = (event) => {
            console.error('Audio playback error:', event);
            this.transitionTo(STATES.IDLE);
        };

        await this.audio.play();
    }

    cancelActiveWork() {
        if (this.fetchController) {
            this.fetchController.abort();
            this.fetchController = null;
        }

        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }

        this.transitionTo(STATES.IDLE);
    }

    transitionTo(newState) {
        if (this.state === newState) return;

        console.log(`Transitioning: ${this.state} -> ${newState}`);
        this.state = newState;
        this.element.setAttribute('data-state', newState);

        if (newState === STATES.IDLE) {
            this.updateTranscript('');
        }
    }
}

const agent = new VoiceAgent('agent-button');
