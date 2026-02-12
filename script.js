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

    // All user-visible UI strings must be Traditional Chinese (Hong Kong).
    const UI_TEXT = {
        listening: '聽緊你講…',
        noSpeechDetected: '我聽唔到聲喎，可以再講一次嗎？',
        microphoneFailed: '開唔到咪高峰，請檢查權限。',
        transcribing: '幫你轉做文字中…',
        noSpeechRecognized: '我聽唔清楚，可以再講一次嗎？',
        synthesizing: '我準備講返出嚟…',
        missingRecorder: '缺少 wav-recorder.js',
        historyEmpty: '（暫時未有對話）',
        unknownError: '未知錯誤',
        sttErrorPrefix: '語音識別出錯：',
        chatErrorPrefix: '對話服務出錯：',
        ttsErrorPrefix: '語音合成出錯：',
        recorderNotStarted: '未開始錄音'
    };

    const CONFIG = {
        recordingTimeoutMs: 8000,

        // Silence detector tuning (works well for typical laptop mics).
        silenceThresholdRms: 0.015,
        silenceDurationMs: 800,
        minRecordingMs: 500,
        minVoiceRms: 0.004,

        // WAV output for STT.
        wavTargetSampleRate: 16000
    };

    class VoiceAgent {
        constructor(elementId) {
            this.element = document.getElementById(elementId);
            this.transcriptDisplay = document.getElementById('transcript');
            this.historyContainer = document.getElementById('history-messages');
            this.volumeMeter = document.getElementById('volume-meter');
            this.volumeFill = document.getElementById('volume-fill');
            this.volumeValue = document.getElementById('volume-value');
            this.latestRms = 0;
            this.volumeRaf = null;

            this.state = STATES.IDLE;
            this.listeningTimer = null;

            this.recorder = null;
            this.isStoppingRecording = false;

            this.audio = null;
            this.fetchController = null;

            const runningFrontendOnLocal3000 =
                (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
                window.location.port === '3000';
            const backendBaseUrl = runningFrontendOnLocal3000 ? 'http://localhost:8000' : '';

            this.chatUrl = `${backendBaseUrl}/chat`;
            this.sttUrl = `${backendBaseUrl}/stt`;
            this.ttsUrl = `${backendBaseUrl}/tts`;
            this.historyUrl = `${backendBaseUrl}/history`;

            if (!this.element) {
                throw new Error(`Missing element: #${elementId}`);
            }

            this.element.addEventListener('click', () => {
                this.handleInteraction().catch((error) => {
                    console.error('Interaction error:', error);
                });
            });

            // Show an initial empty state, then load from backend.
            this.renderHistory([]);

            // Load history when the page is opened/refreshed (as long as the backend is still running).
            this.refreshHistory().catch((error) => {
                console.warn('History load failed:', error);
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
            this.updateTranscript(UI_TEXT.listening);
            this.renderVolume(0);

            if (!window.WavRecorder) {
                this.updateTranscript(UI_TEXT.missingRecorder);
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
            this.recorder.onRms = (rms) => {
                if (this.state === STATES.LISTENING) {
                    this.updateVolume(rms);
                }
            };

            try {
                await this.recorder.start();
                this.startListeningTimer();
            } catch (error) {
                console.error('Recording start error:', error);
                this.updateTranscript(UI_TEXT.microphoneFailed);
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
                    this.updateTranscript(formatUserFacingError(error));
                    this.transitionTo(STATES.IDLE);
                } finally {
                    this.isStoppingRecording = false;
                }
            })();
        }

        async stopAndTranscribe() {
            if (!this.recorder) {
                throw new Error(UI_TEXT.recorderNotStarted);
            }

            const recorder = this.recorder;
            this.recorder = null;

            this.transitionTo(STATES.PROCESSING);
            this.updateTranscript(UI_TEXT.transcribing);

            const wavBlob = await recorder.stop();
            const maxRms = recorder.maxRms || 0;
            if (maxRms < CONFIG.minVoiceRms) {
                this.updateTranscript(UI_TEXT.noSpeechDetected);
                this.transitionTo(STATES.IDLE);
                return;
            }
            await this.sendForTranscription(wavBlob);
        }

        startListeningTimer() {
            this.clearListeningTimer();
            this.listeningTimer = setTimeout(() => {
                this.updateTranscript(UI_TEXT.noSpeechDetected);
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

        updateVolume(rms) {
            this.latestRms = rms;
            if (this.volumeRaf) return;
            this.volumeRaf = requestAnimationFrame(() => {
                this.volumeRaf = null;
                this.renderVolume(this.latestRms);
            });
        }

        renderVolume(rms) {
            if (!this.volumeFill || !this.volumeValue) return;

            const normalized = Math.min(1, rms * 20);
            this.volumeFill.style.width = `${Math.round(normalized * 100)}%`;
            this.volumeValue.textContent = rms.toFixed(4);

            if (this.volumeMeter) {
                const isActive = rms > 0.001;
                this.volumeMeter.classList.toggle('active', isActive);
                if (!isActive) {
                    this.volumeMeter.setAttribute('data-volume-state', 'idle');
                } else if (rms >= CONFIG.minVoiceRms) {
                    this.volumeMeter.setAttribute('data-volume-state', 'good');
                } else {
                    this.volumeMeter.setAttribute('data-volume-state', 'low');
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
                    return UI_TEXT.unknownError;
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
                    throw new Error(`${UI_TEXT.sttErrorPrefix}${detail}`);
                }

                const data = await response.json();
                const text = (data.text || '').trim();

                if (!text) {
                    this.updateTranscript(UI_TEXT.noSpeechRecognized);
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
                    throw new Error(`${UI_TEXT.chatErrorPrefix}${detail}`);
                }

                const data = await response.json();
                const aiReply = data.reply || '';

                // After /chat, the backend updates its in-memory sliding window.
                // Refresh the sidebar so students can see what the agent \"remembers\".
                await this.refreshHistory();

                await this.speak(aiReply);
            } finally {
                this.clearAbortController();
            }
        }

        async refreshHistory() {
            if (!this.historyContainer) return;

            const response = await fetch(this.historyUrl, { method: 'GET' });
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const messages = Array.isArray(data.messages) ? data.messages : [];
            this.renderHistory(messages);
        }

        renderHistory(messages) {
            if (!this.historyContainer) return;

            this.historyContainer.innerHTML = '';

            if (!messages.length) {
                const empty = document.createElement('div');
                empty.className = 'history-item';
                empty.textContent = UI_TEXT.historyEmpty;
                this.historyContainer.appendChild(empty);
                return;
            }

            for (const message of messages) {
                const role = message.role;
                const content = typeof message.content === 'string' ? message.content : '';

                const item = document.createElement('div');
                item.className = 'history-item';

                const roleEl = document.createElement('div');
                roleEl.className = `history-role ${role}`;
                roleEl.textContent = role === 'user' ? '你' : '小幫手';

                const contentEl = document.createElement('div');
                contentEl.className = 'history-content';
                contentEl.textContent = content;

                item.appendChild(roleEl);
                item.appendChild(contentEl);

                this.historyContainer.appendChild(item);
            }

            // When the history reaches the 4-turn window, it becomes scrollable.
            // Auto-scroll so students always see the latest remembered messages.
            this.historyContainer.scrollTop = this.historyContainer.scrollHeight;
        }

        async speak(text) {
            if (!text) {
                this.transitionTo(STATES.IDLE);
                return;
            }

            this.transitionTo(STATES.PROCESSING);
            this.updateTranscript(UI_TEXT.synthesizing);

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
                    throw new Error(`${UI_TEXT.ttsErrorPrefix}${detail}`);
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
                this.renderVolume(0);
            }
        }
    }

    function isAbortError(error) {
        return Boolean(error && error.name === 'AbortError');
    }

    function formatUserFacingError(error) {
        if (error && typeof error.message === 'string') {
            // Keep our own errors (they are already Traditional Chinese).
            if (error.message.startsWith(UI_TEXT.sttErrorPrefix)) return error.message;
            if (error.message.startsWith(UI_TEXT.chatErrorPrefix)) return error.message;
            if (error.message.startsWith(UI_TEXT.ttsErrorPrefix)) return error.message;

            if (error.message === UI_TEXT.recorderNotStarted) return error.message;

            // If the message already contains Chinese characters, assume it's user-facing.
            if (/[\u4e00-\u9fff]/.test(error.message)) return error.message;
        }

        // Browser/network errors are often English. Show a friendly message instead.
        if (error && (error.name === 'TypeError' || String(error.message || '').includes('Failed to fetch'))) {
            return '連唔到後端，請檢查後端有冇開。';
        }

        return UI_TEXT.unknownError;
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
