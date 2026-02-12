(() => {
    'use strict';

    /**
     * A minimal WAV recorder for teaching/demo purposes.
     *
     * What it does:
     * - Captures microphone audio via WebAudio.
     * - Stores raw Float32 PCM samples in memory.
     * - Detects silence using RMS threshold and fires `onSilence` (optional).
     * - Converts the audio to 16-bit PCM WAV on `stop()`.
     *
     * Why not MediaRecorder?
     * - MediaRecorder often produces `audio/webm` in Chrome.
     * - Our STT service expects `wav/mp3/m4a/flac/ogg`.
     * - For a classroom setting (no extra software like ffmpeg), producing WAV in-browser is the most portable.
     *
     * Note:
     * - ScriptProcessorNode is deprecated. AudioWorklet is the modern approach.
     * - We use ScriptProcessorNode here because it is simpler and works in Chrome.
     */
    class WavRecorder {
        constructor(options = {}) {
            this.targetSampleRate = options.targetSampleRate ?? 16000;
            this.silenceThresholdRms = options.silenceThresholdRms ?? 0.01;
            this.silenceDurationMs = options.silenceDurationMs ?? 800;
            this.minRecordingMs = options.minRecordingMs ?? 500;

            this.onSilence = null;
            this.onRms = null;

            this._stream = null;
            this._audioContext = null;
            this._sourceNode = null;
            this._processorNode = null;
            this._zeroGainNode = null;

            this._chunks = [];
            this._inputSampleRate = null;

            this._stopped = false;
            this._silenceEmitted = false;
            this._startTimeMs = null;
            this._lastVoiceTimeMs = null;
            this._hasVoice = false;
            this._maxRms = 0;
        }

        get isRecording() {
            return Boolean(this._stream) && !this._stopped;
        }

        get maxRms() {
            return this._maxRms;
        }

        async start() {
            if (this.isRecording) {
                throw new Error('錄音已經開始咗');
            }

            this._resetState();

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                throw new Error('呢個瀏覽器唔支援 AudioContext');
            }

            // Request microphone permission.
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this._audioContext = new AudioContext();
            this._inputSampleRate = this._audioContext.sampleRate;

            // Some browsers create the context in "suspended" state until a user gesture.
            // Our start() is called from a click, but resume() makes behavior more predictable.
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }

            this._sourceNode = this._audioContext.createMediaStreamSource(this._stream);

            if (!this._audioContext.createScriptProcessor) {
                throw new Error('呢個瀏覽器唔支援 ScriptProcessorNode');
            }

            const bufferSize = 4096;
            this._processorNode = this._audioContext.createScriptProcessor(bufferSize, 1, 1);

            this._startTimeMs = performance.now();
            this._lastVoiceTimeMs = this._startTimeMs;

            this._processorNode.onaudioprocess = (event) => {
                if (this._stopped) return;

                const input = event.inputBuffer.getChannelData(0);
                this._chunks.push(new Float32Array(input));

                this._updateSilenceDetector(input);
            };

            // ScriptProcessorNode must be connected to run.
            // We connect it to a 0-gain node so we don't output audio to speakers.
            this._zeroGainNode = this._audioContext.createGain();
            this._zeroGainNode.gain.value = 0;

            this._sourceNode.connect(this._processorNode);
            this._processorNode.connect(this._zeroGainNode);
            this._zeroGainNode.connect(this._audioContext.destination);
        }

        async stop() {
            const floatSamples = await this._stopCaptureAndGetSamples();

            // Resample to a stable rate for STT (16kHz is a common choice).
            const resampled = resampleFloat32(
                floatSamples,
                this._inputSampleRate,
                this.targetSampleRate
            );

            const wavBuffer = encodeWavPcm16(resampled, this.targetSampleRate, 1);
            return new Blob([wavBuffer], { type: 'audio/wav' });
        }

        async cancel() {
            // Stop recording and free resources without encoding.
            await this._cleanupAudio();
            this._resetState();
        }

        _resetState() {
            this._stopped = false;
            this._silenceEmitted = false;
            this._hasVoice = false;
            this._maxRms = 0;
            this._chunks = [];
            this._inputSampleRate = null;

            this._startTimeMs = null;
            this._lastVoiceTimeMs = null;
        }

        _updateSilenceDetector(input) {
            const rms = computeRms(input);
            if (rms > this._maxRms) {
                this._maxRms = rms;
            }
            if (typeof this.onRms === 'function') {
                try {
                    this.onRms(rms);
                } catch (error) {
                    console.error('onRms handler error:', error);
                }
            }
            const now = performance.now();

            if (rms >= this.silenceThresholdRms) {
                this._hasVoice = true;
                this._lastVoiceTimeMs = now;
                return;
            }

            if (!this._hasVoice) {
                return;
            }

            if (this._startTimeMs === null || this._lastVoiceTimeMs === null) {
                return;
            }

            if ((now - this._startTimeMs) < this.minRecordingMs) {
                return;
            }

            if ((now - this._lastVoiceTimeMs) >= this.silenceDurationMs) {
                this._emitSilence();
            }
        }

        _emitSilence() {
            if (this._silenceEmitted) return;
            this._silenceEmitted = true;

            if (typeof this.onSilence === 'function') {
                try {
                    this.onSilence();
                } catch (error) {
                    console.error('onSilence handler error:', error);
                }
            }
        }

        async _stopCaptureAndGetSamples() {
            if (this._stopped) {
                throw new Error('錄音已經停止咗');
            }
            this._stopped = true;

            await this._cleanupAudio();

            const merged = mergeFloat32Chunks(this._chunks);
            this._chunks = [];

            if (!merged.length) {
                throw new Error('錄唔到任何聲音');
            }

            return merged;
        }

        async _cleanupAudio() {
            if (this._processorNode) {
                this._processorNode.onaudioprocess = null;
            }

            if (this._sourceNode) {
                try {
                    this._sourceNode.disconnect();
                } catch (error) {
                    // Ignore disconnect errors.
                }
            }
            if (this._processorNode) {
                try {
                    this._processorNode.disconnect();
                } catch (error) {
                    // Ignore disconnect errors.
                }
            }
            if (this._zeroGainNode) {
                try {
                    this._zeroGainNode.disconnect();
                } catch (error) {
                    // Ignore disconnect errors.
                }
            }

            if (this._stream) {
                for (const track of this._stream.getTracks()) {
                    track.stop();
                }
            }

            if (this._audioContext) {
                try {
                    await this._audioContext.close();
                } catch (error) {
                    // Ignore close errors.
                }
            }

            this._stream = null;
            this._audioContext = null;
            this._sourceNode = null;
            this._processorNode = null;
            this._zeroGainNode = null;
        }
    }

    function computeRms(samples) {
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i += 1) {
            const value = samples[i];
            sumSquares += value * value;
        }
        return Math.sqrt(sumSquares / samples.length);
    }

    function mergeFloat32Chunks(chunks) {
        let totalLength = 0;
        for (const chunk of chunks) {
            totalLength += chunk.length;
        }

        const result = new Float32Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        return result;
    }

    function resampleFloat32(input, inputSampleRate, targetSampleRate) {
        if (!inputSampleRate || inputSampleRate === targetSampleRate) {
            return input;
        }

        const ratio = inputSampleRate / targetSampleRate;
        const outputLength = Math.max(1, Math.round(input.length / ratio));
        const output = new Float32Array(outputLength);

        // Linear interpolation resampling.
        for (let i = 0; i < outputLength; i += 1) {
            const position = i * ratio;
            const index = Math.floor(position);
            const fraction = position - index;

            const sample0 = input[index] ?? 0;
            const sample1 = input[index + 1] ?? 0;

            output[i] = sample0 + (sample1 - sample0) * fraction;
        }

        return output;
    }

    function encodeWavPcm16(samples, sampleRate, numChannels) {
        const bytesPerSample = 2;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = samples.length * bytesPerSample;

        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeAscii(view, 8, 'WAVE');

        writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);

        writeAscii(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i += 1) {
            let sample = samples[i];
            sample = Math.max(-1, Math.min(1, sample));

            // Convert float [-1, 1] to int16.
            const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            view.setInt16(offset, int16, true);
            offset += 2;
        }

        return buffer;
    }

    function writeAscii(view, offset, text) {
        for (let i = 0; i < text.length; i += 1) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    }

    window.WavRecorder = WavRecorder;
})();
