// ============================================================================
// Audio Worklet Processor (C64 Worklet)
// Runs the Engine Core on the real-time audio thread. The main thread sends
// commands over the processor port and receives Telemetry Snapshots back.
// ============================================================================

import { createEngineCore } from "./engine_core.js";
import { packTelemetry, TELEMETRY_BUFFER_BYTES } from "./telemetry_buffer.js";

export const WORKLET_PROCESSOR_NAME = "c64-engine";

// The browser calls process() about 375 times per second at 48 kHz.
// Six callbacks per Telemetry Snapshot is about 62.5 Hz.
const TELEMETRY_INTERVAL = 6;
const TELEMETRY_DIVIDER = 2;
const TELEMETRY_POOL_SIZE = 6;
const QUANTUM_FRAMES = 128;
const GAIN_RAMP_SECONDS = 0.005;
const DIAGNOSTICS_INTERVAL = 375;
const HISTOGRAM_BUCKET_US = 50;
const HISTOGRAM_BUCKETS = 200;

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

export function createC64ProcessorClass(BaseProcessor) {
  return class C64WorkletProcessor extends BaseProcessor {
    constructor(options = {}) {
      super();
      const processorOptions = options.processorOptions || {};
      this.core = null;
      this.ready = false;
      this.pending = [];
      this.telemetryDivider = Number(processorOptions.telemetryDivider) || TELEMETRY_DIVIDER;
      this.telemetryCounter = 0;
      this.forceTelemetry = false;
      this.telemetryPool = [];
      for (let i = 0; i < TELEMETRY_POOL_SIZE; i++) {
        this.telemetryPool.push(new ArrayBuffer(TELEMETRY_BUFFER_BYTES));
      }
      this.port.onmessage = (event) => this.onMessage(event.data);

      const wasmModule = processorOptions.wasmModule;
      const sampleRate = Number(processorOptions.sampleRate) || 48000;
      this.sampleRate = sampleRate;
      this.gain = 0;
      this.targetGain = 0;
      this.gainStep = 1 / (sampleRate * GAIN_RAMP_SECONDS);
      this.playRequested = false;
      this.pendingPause = false;
      this.lastFrame = null;
      this.diagnosticsInterval =
        Number(processorOptions.diagnosticsInterval) || DIAGNOSTICS_INTERVAL;
      this.budgetUs = (QUANTUM_FRAMES / sampleRate) * 1e6;
      this.diagnostics = {
        windowCalls: 0,
        maxUs: 0,
        processPeakUs: 0,
        histogram: new Uint32Array(HISTOGRAM_BUCKETS + 1),
        missedQuanta: 0,
        missedWindow: 0,
        missedPeakWindow: 0,
        lateQuanta: 0,
        lateWindow: 0,
        latePeakWindow: 0,
        telemetryDrops: 0,
        telemetryDropWindow: 0,
        telemetryDropPeakWindow: 0,
        renderAudioMaxUs: 0,
        renderAudioPeakUs: 0,
        packTelemetryMaxUs: 0,
        packTelemetryPeakUs: 0,
        postMessageMaxUs: 0,
        postMessagePeakUs: 0,
        applyGainMaxUs: 0,
        applyGainPeakUs: 0,
      };

      if (!wasmModule) {
        this.port.postMessage({ type: "error", message: "Missing wasmModule" });
        return;
      }

      WebAssembly.instantiate(wasmModule, {})
        .then((instance) => {
          this.core = createEngineCore({
            wasm: instance.exports,
            sampleRate,
            telemetryInterval: TELEMETRY_INTERVAL,
            postMessage: (message) => {
              if (message.type === "telemetry") {
                if (this.forceTelemetry) {
                  this.forceTelemetry = false;
                  this.sendTelemetry(message.snapshot);
                  return;
                }
                this.telemetryCounter++;
                if (this.telemetryCounter % this.telemetryDivider !== 0) return;
                this.sendTelemetry(message.snapshot);
                return;
              }
              this.port.postMessage(message);
            },
          });
          this.ready = true;
          this.port.postMessage({ type: "ready", sampleRate });
          this.drainPending();
        })
        .catch((error) => {
          this.port.postMessage({ type: "error", message: String(error) });
        });
    }

    onMessage(message) {
      if (!message?.type) return;
      if (message.type === "telemetry-recycle") {
        this.recycleTelemetry(message.buffer);
        return;
      }
      if (message.type === "audio-interruption") {
        if (message.active) {
          this.gain = 0;
          this.targetGain = 0;
        } else {
          this.targetGain = this.playRequested ? 1 : 0;
        }
        return;
      }
      if (message.type === "setTelemetryDivider") {
        this.telemetryDivider = Math.max(1, Math.round(Number(message.divider)) || 1);
        this.telemetryCounter = 0;
        return;
      }
      if (message.type === "play") {
        this.playRequested = true;
        this.targetGain = 1;
        this.pendingPause = false;
      } else if (message.type === "pause") {
        this.playRequested = false;
        this.targetGain = 0;
        if (this.gain > 0) {
          this.pendingPause = true;
          return;
        }
      } else if (message.type === "loadTrack") {
        this.forceTelemetry = true;
        this.playRequested = Boolean(message.autoPlay);
        this.targetGain = this.playRequested ? 1 : 0;
        this.pendingPause = false;
      } else if (message.type === "requestTelemetry") {
        this.forceTelemetry = true;
      }
      this.forward(message);
    }

    forward(message) {
      if (!this.ready || !this.core) {
        this.pending.push(message);
        return;
      }
      this.core.onmessage({ data: message });
    }

    sendTelemetry(snapshot) {
      const buffer = this.telemetryPool.pop();
      if (!buffer) {
        this.diagnostics.telemetryDrops++;
        this.diagnostics.telemetryDropWindow++;
        return;
      }
      const packStarted = now();
      packTelemetry(snapshot, buffer);
      this.recordPhase("packTelemetryMaxUs", "packTelemetryPeakUs", (now() - packStarted) * 1000);
      const postStarted = now();
      this.port.postMessage({ type: "telemetry", buffer }, [buffer]);
      this.recordPhase("postMessageMaxUs", "postMessagePeakUs", (now() - postStarted) * 1000);
    }

    recycleTelemetry(buffer) {
      if (!(buffer instanceof ArrayBuffer)) return;
      if (this.telemetryPool.length < TELEMETRY_POOL_SIZE) {
        this.telemetryPool.push(buffer);
      }
    }

    drainPending() {
      while (this.pending.length > 0) {
        this.core.onmessage({ data: this.pending.shift() });
      }
    }

    applyGain(left, right) {
      if (this.gain === this.targetGain) {
        if (this.gain === 1) return;
      }

      let gain = this.gain;
      const target = this.targetGain;
      const step = this.gainStep;
      if (gain < target) {
        for (let i = 0; i < left.length; i++) {
          if (gain < target) gain = Math.min(target, gain + step);
          left[i] *= gain;
          right[i] *= gain;
        }
      } else if (gain > target) {
        for (let i = 0; i < left.length; i++) {
          if (gain > target) gain = Math.max(target, gain - step);
          left[i] *= gain;
          right[i] *= gain;
        }
      }
      this.gain = gain;
    }

    recordPhase(maxKey, peakKey, elapsedUs) {
      const diagnostics = this.diagnostics;
      if (elapsedUs > diagnostics[maxKey]) diagnostics[maxKey] = elapsedUs;
      if (elapsedUs > diagnostics[peakKey]) diagnostics[peakKey] = elapsedUs;
    }

    recordProcess(elapsedUs) {
      const diagnostics = this.diagnostics;
      diagnostics.windowCalls++;
      this.recordPhase("maxUs", "processPeakUs", elapsedUs);
      if (elapsedUs > this.budgetUs) {
        diagnostics.lateQuanta++;
        diagnostics.lateWindow++;
      }
      const bucket = Math.min(HISTOGRAM_BUCKETS, Math.floor(elapsedUs / HISTOGRAM_BUCKET_US));
      diagnostics.histogram[bucket]++;
    }

    percentile(fraction) {
      const diagnostics = this.diagnostics;
      if (diagnostics.windowCalls === 0) return 0;
      const target = Math.ceil(diagnostics.windowCalls * fraction);
      let count = 0;
      for (let i = 0; i < diagnostics.histogram.length; i++) {
        count += diagnostics.histogram[i];
        if (count >= target) {
          if (i === HISTOGRAM_BUCKETS) return HISTOGRAM_BUCKETS * HISTOGRAM_BUCKET_US;
          return i * HISTOGRAM_BUCKET_US + HISTOGRAM_BUCKET_US / 2;
        }
      }
      return diagnostics.maxUs;
    }

    reportDiagnostics() {
      const diagnostics = this.diagnostics;
      diagnostics.latePeakWindow = Math.max(diagnostics.latePeakWindow, diagnostics.lateWindow);
      diagnostics.missedPeakWindow = Math.max(
        diagnostics.missedPeakWindow,
        diagnostics.missedWindow,
      );
      diagnostics.telemetryDropPeakWindow = Math.max(
        diagnostics.telemetryDropPeakWindow,
        diagnostics.telemetryDropWindow,
      );
      const report = {
        processCalls: diagnostics.windowCalls,
        p50Us: this.percentile(0.5),
        p95Us: this.percentile(0.95),
        p99Us: this.percentile(0.99),
        maxUs: diagnostics.maxUs,
        processPeakUs: diagnostics.processPeakUs,
        budgetUs: this.budgetUs,
        missedQuanta: diagnostics.missedQuanta,
        missedWindow: diagnostics.missedWindow,
        missedPeakWindow: diagnostics.missedPeakWindow,
        lateQuanta: diagnostics.lateQuanta,
        lateWindow: diagnostics.lateWindow,
        latePeakWindow: diagnostics.latePeakWindow,
        telemetryDrops: diagnostics.telemetryDrops,
        telemetryDropWindow: diagnostics.telemetryDropWindow,
        telemetryDropPeakWindow: diagnostics.telemetryDropPeakWindow,
        renderAudioMaxUs: diagnostics.renderAudioMaxUs,
        renderAudioPeakUs: diagnostics.renderAudioPeakUs,
        packTelemetryMaxUs: diagnostics.packTelemetryMaxUs,
        packTelemetryPeakUs: diagnostics.packTelemetryPeakUs,
        postMessageMaxUs: diagnostics.postMessageMaxUs,
        postMessagePeakUs: diagnostics.postMessagePeakUs,
        applyGainMaxUs: diagnostics.applyGainMaxUs,
        applyGainPeakUs: diagnostics.applyGainPeakUs,
        gain: this.gain,
        playing: this.playRequested,
      };
      this.port.postMessage({ type: "audio-diagnostics", diagnostics: report });

      diagnostics.windowCalls = 0;
      diagnostics.maxUs = 0;
      diagnostics.lateWindow = 0;
      diagnostics.missedWindow = 0;
      diagnostics.telemetryDropWindow = 0;
      diagnostics.renderAudioMaxUs = 0;
      diagnostics.packTelemetryMaxUs = 0;
      diagnostics.postMessageMaxUs = 0;
      diagnostics.applyGainMaxUs = 0;
      diagnostics.histogram.fill(0);
    }

    process(_inputs, outputs) {
      const output = outputs[0];
      if (!output || output.length < 2) return true;

      const left = output[0];
      const right = output[1];
      if (!this.core) {
        left.fill(0);
        right.fill(0);
        return true;
      }

      const started = now();
      const frame = typeof currentFrame === "number" ? currentFrame : 0;
      if (this.lastFrame !== null) {
        const delta = frame - this.lastFrame;
        if (delta > QUANTUM_FRAMES) {
          const missed = Math.max(1, Math.round(delta / QUANTUM_FRAMES) - 1);
          this.diagnostics.missedQuanta += missed;
          this.diagnostics.missedWindow += missed;
        }
      }
      this.lastFrame = frame;

      const renderStarted = now();
      this.core.renderAudio(left, right);
      this.recordPhase("renderAudioMaxUs", "renderAudioPeakUs", (now() - renderStarted) * 1000);

      const gainStarted = now();
      this.applyGain(left, right);
      this.recordPhase("applyGainMaxUs", "applyGainPeakUs", (now() - gainStarted) * 1000);

      if (this.pendingPause && this.gain <= 0) {
        this.pendingPause = false;
        this.forward({ type: "pause" });
      }

      this.recordProcess((now() - started) * 1000);
      if (this.diagnostics.windowCalls >= this.diagnosticsInterval) {
        this.reportDiagnostics();
      }
      return true;
    }
  };
}

const BaseProcessor =
  typeof AudioWorkletProcessor === "function" ? AudioWorkletProcessor : class {};

export const C64WorkletProcessor = createC64ProcessorClass(BaseProcessor);

if (typeof registerProcessor === "function") {
  registerProcessor(WORKLET_PROCESSOR_NAME, C64WorkletProcessor);
}
