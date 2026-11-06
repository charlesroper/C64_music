import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createC64ProcessorClass } from "../src/audio_worklet.js";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import { GAME_FILES } from "../src/tracks_catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const wasmModule = await WebAssembly.compile(
  fs.readFileSync(path.join(ROOT, "wasm/c64_engine.wasm")),
);
const wizball = assembleOceanSource(fs.readFileSync(path.join(ROOT, "wizball.asm"), "latin1"));
const wizballGame = GAME_FILES.find((game) => game.id === "wizball.asm");
const wizballTitle = wizballGame.tracks.find((track) => track.id === "wiz-title");

function createPort() {
  const messages = [];
  return {
    messages,
    onmessage: null,
    postMessage(message) {
      messages.push(message);
    },
  };
}

function createProcessor(port) {
  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = port;
    }
  }
  const Processor = createC64ProcessorClass(FakeAudioWorkletProcessor);
  return new Processor({ processorOptions: { wasmModule, sampleRate: 48000 } });
}

function loadWizball(port) {
  port.onmessage({
    data: {
      type: "loadTrack",
      gameId: "wizball.asm",
      track: wizballTitle,
      mem: wizball.mem,
      symbols: wizball.symbols,
      autoPlay: true,
    },
  });
  port.onmessage({ data: { type: "play" } });
}

async function waitForMessage(port, type, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = port.messages.find((message) => message.type === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${type} message`);
}

function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

test("worklet processor instantiates the Engine Core from a compiled module and renders 128 stereo samples", async () => {
  const port = createPort();
  const processor = createProcessor(port);
  await waitForMessage(port, "ready");

  loadWizball(port);

  const left = new Float32Array(128);
  const right = new Float32Array(128);
  let peak = 0;
  for (let block = 0; block < 8; block++) {
    const keepProcessing = processor.process([], [[left, right]]);
    assert.equal(keepProcessing, true);
    assert.equal(left.length, 128);
    assert.equal(right.length, 128);
    peak = Math.max(peak, peakOf(left), peakOf(right));
  }

  assert.ok(peak > 0.01, `Expected Wizball worklet audio, got peak ${peak}`);
});

test("worklet processor queues commands that arrive before the Engine Core is ready", async () => {
  const port = createPort();
  const processor = createProcessor(port);

  // These messages arrive before WebAssembly.instantiate resolves.
  loadWizball(port);
  await waitForMessage(port, "ready");

  const left = new Float32Array(128);
  const right = new Float32Array(128);
  let peak = 0;
  for (let block = 0; block < 8; block++) {
    processor.process([], [[left, right]]);
    peak = Math.max(peak, peakOf(left), peakOf(right));
  }

  assert.ok(peak > 0.01, `Expected queued play command to start audio, got peak ${peak}`);
});

test("worklet processor returns silence before the Engine Core is ready", () => {
  const port = createPort();
  const processor = createProcessor(port);

  const left = new Float32Array(128).fill(1);
  const right = new Float32Array(128).fill(1);
  const keepProcessing = processor.process([], [[left, right]]);

  assert.equal(keepProcessing, true);
  assert.equal(peakOf(left), 0);
  assert.equal(peakOf(right), 0);
});

test("worklet processor throttles telemetry below the audio callback rate", async () => {
  const port = createPort();
  const processor = createProcessor(port);
  await waitForMessage(port, "ready");

  loadWizball(port);
  port.messages.length = 0;

  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let block = 0; block < 12; block++) {
    processor.process([], [[left, right]]);
  }

  const telemetryCount = port.messages.filter((message) => message.type === "telemetry").length;
  assert.ok(telemetryCount >= 1, "Expected telemetry while playing");
  assert.ok(telemetryCount <= 3, `Expected throttled telemetry, got ${telemetryCount} messages`);
});
