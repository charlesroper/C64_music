// ============================================================================
// Audio Worklet Processor (C64 Worklet)
// Runs the Engine Core on the real-time audio thread. The main thread sends
// commands over the processor port and receives Telemetry Snapshots back.
// ============================================================================

import { createEngineCore } from "./engine_core.js";
import {
  createTelemetryHeader,
  packTelemetry,
  TELEMETRY_BUFFER_BYTES,
} from "./telemetry_buffer.js";

export const WORKLET_PROCESSOR_NAME = "c64-engine";

// The browser calls process() about 375 times per second at 48 kHz.
// Six callbacks per Telemetry Snapshot is about 62.5 Hz.
const TELEMETRY_INTERVAL = 6;
const TELEMETRY_POOL_SIZE = 3;

export function createC64ProcessorClass(BaseProcessor) {
  return class C64WorkletProcessor extends BaseProcessor {
    constructor(options = {}) {
      super();
      this.core = null;
      this.ready = false;
      this.pending = [];
      this.telemetryHeader = createTelemetryHeader();
      this.telemetryPool = [];
      for (let i = 0; i < TELEMETRY_POOL_SIZE; i++) {
        this.telemetryPool.push(new ArrayBuffer(TELEMETRY_BUFFER_BYTES));
      }
      this.port.onmessage = (event) => this.onMessage(event.data);

      const processorOptions = options.processorOptions || {};
      const wasmModule = processorOptions.wasmModule;
      const sampleRate = Number(processorOptions.sampleRate) || 48000;

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
      if (!this.ready || !this.core) {
        this.pending.push(message);
        return;
      }
      this.core.onmessage({ data: message });
    }

    sendTelemetry(snapshot) {
      const buffer = this.telemetryPool.pop();
      if (!buffer) return;
      const header = packTelemetry(snapshot, buffer, this.telemetryHeader);
      this.port.postMessage({ type: "telemetry", header, buffer }, [buffer]);
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

      this.core.renderAudio(left, right);
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
