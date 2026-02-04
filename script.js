(() => {
    'use strict';

    // Responsibilities:
    // - UI state machine (idle/listening/processing/speaking)
    // - Calls backend endpoints: /stt -> /chat -> /tts
    // - Plays the returned TTS audio

    const STATES = {
        IDLE: 'idle',
        LISTENING: 'listening',
        PROCESSING: 'processing',
        SPEAKING: 'speaking'
    };

    const CONFIG = {
        recordingTimeoutMs: 8000,

        // Silence detector tuning (works well for typical laptop mics).
        silenceThresholdRms: 0.01,
        silenceDurationMs: 800,
        minRecordingMs: 500,

        // WAV output for STT.
        wavTargetSampleRate: 16000
    };

    class VoiceAgent {
        constructor(elementId) {
            this.element = document.getElementById(elementId);
            this.transcriptDisplay = document.getElementById('transcript');

            this.state = STATES.IDLE;
            this.listeningTimer = null;

            this.recorder = null;
            this.isStoppingRecording = false;

            this.audio = null;
            this.fetchController = null;

            this.chatUrl = 'http://localhost:8000/chat';
            this.sttUrl = 'http://localhost:8000/stt';
            this.ttsUrl = 'http://localhost:8000/tts';

            if (!this.element) {
                throw new Error(`Missing element: #${elementId}`);
            }

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
            this.updateTranscript('Listening...');

            if (!window.WavRecorder) {
                this.updateTranscript('Missing wav-recorder.js');
                this.transitionTo(STATES.IDLE);
                return;
            }

            this.recorder = new window.WavRecorder({
                targetSampleRate: CONFIG.wavTargetSampleRate,
                silenceThresholdRms: CONFIG.silenceThresholdRms,
                silenceDurationMs: CONFIG.silenceDurationMs,
                minRecordingMs: CONFIG.minRecordingMs
            });

            // Auto-stop when silence is detected.
            this.recorder.onSilence = () => {
                if (this.state === STATES.LISTENING) {
                    this.stopListening();
                }
            };

            try {
                await this.recorder.start();
                this.startListeningTimer();
            } catch (error) {
                console.error('Recording start error:', error);
                this.updateTranscript('Microphone access failed.');
                this.transitionTo(STATES.IDLE);
                this.recorder = null;
            }
        }

        stopListening() {
            if (this.isStoppingRecording) return;
            this.isStoppingRecording = true;

            this.clearListeningTimer();

            (async () => {
                try {
                    await this.stopAndTranscribe();
                } catch (error) {
                    if (isAbortError(error)) return;
                    console.error('Recording stop error:', error);
                    this.updateTranscript(error.message || 'Recording stop failed.');
                    this.transitionTo(STATES.IDLE);
                } finally {
                    this.isStoppingRecording = false;
                }
            })();
        }

        async stopAndTranscribe() {
            if (!this.recorder) {
                throw new Error('Recorder not started');
            }

            const recorder = this.recorder;
            this.recorder = null;

            this.transitionTo(STATES.PROCESSING);
            this.updateTranscript('Transcribing...');

            const wavBlob = await recorder.stop();
            await this.sendForTranscription(wavBlob);
        }

        startListeningTimer() {
            this.clearListeningTimer();
            this.listeningTimer = setTimeout(() => {
                this.updateTranscript('No speech detected.');
                this.stopListening();
            }, CONFIG.recordingTimeoutMs);
        }

        clearListeningTimer() {
            if (this.listeningTimer) {
                clearTimeout(this.listeningTimer);
                this.listeningTimer = null;
            }
        }

        updateTranscript(text) {
            if (!this.transcriptDisplay) return;

            this.transcriptDisplay.textContent = text;
            if (text) {
                this.transcriptDisplay.classList.add('active');
            } else {
                this.transcriptDisplay.classList.remove('active');
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

        async readErrorDetail(response) {
            try {
                const data = await response.json();
                if (data && typeof data.detail === 'string') {
                    return data.detail;
                }
                return JSON.stringify(data);
            } catch {
                try {
                    return await response.text();
                } catch {
                    return 'Unknown error';
                }
            }
        }

        async sendForTranscription(wavBlob) {
            const formData = new FormData();
            formData.append('audio', wavBlob, 'recording.wav');

            const controller = this.createAbortController();

            try {
                const response = await fetch(this.sttUrl, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });

                if (!response.ok) {
                    const detail = await this.readErrorDetail(response);
                    throw new Error(`STT backend error: ${detail}`);
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

                if (!response.ok) {
                    const detail = await this.readErrorDetail(response);
                    throw new Error(`Chat backend error: ${detail}`);
                }

                const data = await response.json();
                const aiReply = data.reply || '';

                await this.speak(aiReply);
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
                    const detail = await this.readErrorDetail(response);
                    throw new Error(`TTS backend error: ${detail}`);
                }

                const audioBlob = await response.blob();
                await this.playAudioBlob(audioBlob, text);
            } finally {
                this.clearAbortController();
            }
        }

        async playAudioBlob(audioBlob, transcriptText) {
            // Stop previous audio.
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
            // Cancel in-flight HTTP requests.
            if (this.fetchController) {
                this.fetchController.abort();
                this.fetchController = null;
            }

            // Stop audio playback.
            if (this.audio) {
                this.audio.pause();
                this.audio.currentTime = 0;
            }

            // Cancel recording.
            if (this.recorder) {
                const recorder = this.recorder;
                this.recorder = null;
                recorder.cancel().catch((error) => {
                    console.warn('Recorder cancel failed:', error);
                });
            }

            this.clearListeningTimer();
            this.transitionTo(STATES.IDLE);
        }

        transitionTo(newState) {
            if (this.state === newState) return;

            this.state = newState;
            this.element.setAttribute('data-state', newState);

            if (newState === STATES.IDLE) {
                this.updateTranscript('');
            }
        }
    }

    function isAbortError(error) {
        return Boolean(error && error.name === 'AbortError');
    }

    function initDevControls(agent) {
        const container = document.getElementById('dev-controls');
        if (!container) return;

        const buttons = container.querySelectorAll('button[data-state]');
        for (const button of buttons) {
            button.addEventListener('click', () => {
                const state = button.getAttribute('data-state');
                if (state) {
                    agent.transitionTo(state);
                }
            });
        }
    }

    const agent = new VoiceAgent('agent-button');
    initDevControls(agent);

    // Expose for debugging in DevTools.
    window.agent = agent;
})();
