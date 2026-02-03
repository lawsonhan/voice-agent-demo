const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking'
};

const RECORDING_TIMEOUT_MS = 5000;
const SUPPORTED_RECORDING_TYPES = [
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav'
];

class VoiceAgent {
    constructor(elementId) {
        this.element = document.getElementById(elementId);
        this.transcriptDisplay = document.getElementById('transcript');
        this.state = STATES.IDLE;
        this.listeningTimer = null;

        this.mediaStream = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.ignoreNextRecording = false;

        this.audio = null;
        this.fetchController = null;

        this.chatUrl = 'http://localhost:8000/chat';
        this.sttUrl = 'http://localhost:8000/stt';
        this.ttsUrl = 'http://localhost:8000/tts';

        this.element.addEventListener('click', () => {
            this.handleInteraction().catch((error) => {
                console.error('Interaction error:', error);
            });
        });
    }

    getSupportedMimeType() {
        if (!window.MediaRecorder) return '';
        for (const type of SUPPORTED_RECORDING_TYPES) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return '';
    }

    getFileExtension(mimeType) {
        if (mimeType.includes('ogg')) return 'ogg';
        if (mimeType.includes('wav')) return 'wav';
        return 'audio';
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
        const mimeType = this.getSupportedMimeType();
        if (!mimeType) {
            this.updateTranscript('Browser does not support OGG/WAV recording.');
            return;
        }

        this.cancelActiveWork();
        this.transitionTo(STATES.LISTENING);
        this.updateTranscript('Listening...');

        try {
            if (!this.mediaStream) {
                this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.recordedChunks = [];
            this.ignoreNextRecording = false;

            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.handleRecordingStop(mimeType).catch((error) => {
                    console.error('Recording stop error:', error);
                });
            };

            this.mediaRecorder.start();
            this.startListeningTimer();
        } catch (error) {
            console.error('Microphone error:', error);
            this.updateTranscript('Microphone access denied.');
            this.transitionTo(STATES.IDLE);
        }
    }

    stopListening() {
        this.clearListeningTimer();

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    }

    async handleRecordingStop(mimeType) {
        this.clearListeningTimer();

        if (this.ignoreNextRecording) {
            this.ignoreNextRecording = false;
            return;
        }

        if (!this.recordedChunks.length) {
            this.updateTranscript('No speech detected.');
            this.transitionTo(STATES.IDLE);
            return;
        }

        const blob = new Blob(this.recordedChunks, { type: mimeType });
        await this.sendForTranscription(blob, mimeType);
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

    async sendForTranscription(blob, mimeType) {
        this.transitionTo(STATES.PROCESSING);
        this.updateTranscript('Transcribing...');

        const formData = new FormData();
        const extension = this.getFileExtension(mimeType);
        formData.append('audio', blob, `recording.${extension}`);

        const controller = this.createAbortController();

        try {
            const response = await fetch(this.sttUrl, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error('STT backend error');
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
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.ignoreNextRecording = true;
            this.mediaRecorder.stop();
        }

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
