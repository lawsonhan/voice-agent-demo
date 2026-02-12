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

        this.chatUrl = '/api/chat';
        this.sttUrl = '/api/stt';
        this.ttsUrl = '/api/tts';

        // Browser mic recording
        this.mediaStream = null;
        this.audioContext = null;
        this.sourceNode = null;
        this.processorNode = null;
        this.recordedChunks = [];
        this.recordingSampleRate = 48000;

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
        this.updateTranscript('Listening (browser mic)...');

        try {
            await this.startBrowserRecording();
            this.startListeningTimer();
        } catch (error) {
            console.error('Recording start error:', error);
            this.updateTranscript('Recording start failed.');
            this.transitionTo(STATES.IDLE);
        }
    }

    stopListening() {
        this.clearListeningTimer();
        this.stopBrowserRecordingAndTranscribe().catch((error) => {
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

    async stopBrowserRecordingAndTranscribe() {
        this.transitionTo(STATES.PROCESSING);
        this.updateTranscript('Transcribing...');

        const controller = this.createAbortController();

        try {
            const wavBlob = await this.stopBrowserRecording();
            const text = await this.transcribeAudioBlob(wavBlob, controller.signal);

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

    async startBrowserRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('getUserMedia not supported');
        }

        await this.forceStopBrowserRecording();
        this.recordedChunks = [];

        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.recordingSampleRate = this.audioContext.sampleRate;

        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        // ScriptProcessor is deprecated but broadly supported and fine for this demo.
        this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

        this.processorNode.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            this.recordedChunks.push(new Float32Array(input));
        };

        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);
    }

    async forceStopBrowserRecording() {
        try {
            if (this.processorNode) {
                this.processorNode.disconnect();
                this.processorNode.onaudioprocess = null;
            }
        } catch (_) {}

        try {
            if (this.sourceNode) {
                this.sourceNode.disconnect();
            }
        } catch (_) {}

        if (this.mediaStream) {
            for (const track of this.mediaStream.getTracks()) {
                try { track.stop(); } catch (_) {}
            }
        }

        if (this.audioContext) {
            try { await this.audioContext.close(); } catch (_) {}
        }

        this.mediaStream = null;
        this.audioContext = null;
        this.sourceNode = null;
        this.processorNode = null;
    }

    async stopBrowserRecording() {
        if (!this.mediaStream || !this.audioContext) {
            throw new Error('Recording has not been started');
        }

        await this.forceStopBrowserRecording();

        const samples = this.flattenFloat32Chunks(this.recordedChunks);
        this.recordedChunks = [];

        if (!samples || samples.length === 0) {
            throw new Error('No audio captured');
        }

        const targetRate = 16000;
        const downsampled = this.downsampleBuffer(samples, this.recordingSampleRate, targetRate);
        const wavArrayBuffer = this.encodeWavPcm16(downsampled, targetRate);
        return new Blob([wavArrayBuffer], { type: 'audio/wav' });
    }

    flattenFloat32Chunks(chunks) {
        let totalLength = 0;
        for (const chunk of chunks) totalLength += chunk.length;
        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
        if (outputSampleRate >= inputSampleRate) return buffer;
        const sampleRateRatio = inputSampleRate / outputSampleRate;
        const newLength = Math.round(buffer.length / sampleRateRatio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
            let accum = 0;
            let count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }
            result[offsetResult] = count > 0 ? accum / count : 0;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    encodeWavPcm16(floatSamples, sampleRate) {
        const bytesPerSample = 2;
        const blockAlign = 1 * bytesPerSample;
        const buffer = new ArrayBuffer(44 + floatSamples.length * bytesPerSample);
        const view = new DataView(buffer);

        this.writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + floatSamples.length * bytesPerSample, true);
        this.writeAscii(view, 8, 'WAVE');

        this.writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);

        this.writeAscii(view, 36, 'data');
        view.setUint32(40, floatSamples.length * bytesPerSample, true);

        let offset = 44;
        for (let i = 0; i < floatSamples.length; i++, offset += 2) {
            let sample = Math.max(-1, Math.min(1, floatSamples[i]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            view.setInt16(offset, sample, true);
        }

        return buffer;
    }

    writeAscii(view, offset, text) {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    async transcribeAudioBlob(audioBlob, signal) {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.wav');

        const response = await fetch(this.sttUrl, {
            method: 'POST',
            body: formData,
            signal
        });

        if (!response.ok) {
            throw new Error('STT backend error');
        }

        const data = await response.json();
        return (data.text || '').trim();
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
            try { this.fetchController.abort(); } catch (_) {}
        }
        this.fetchController = null;

        // Stop mic capture if active
        this.forceStopBrowserRecording().catch(() => {});

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
