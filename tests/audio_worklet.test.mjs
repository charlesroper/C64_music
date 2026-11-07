import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createC64ProcessorClass } from "../src/audio_worklet.js";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import { createWorkbenchPlayer } from "../src/player_engine.js";
import { TELEMETRY_BUFFER_BYTES } from "../src/telemetry_buffer.js";
import { GAME_FILES } from "../src/tracks_catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const wasmModule = await WebAssembly.compile(
  fs.readFileSync(path.join(ROOT, "wasm/c64_engine.wasm")),
);
const wizballSource = fs.readFileSync(path.join(ROOT, "wizball.asm"), "latin1");
const wizball = assembleOceanSource(wizballSource);
const wizballGame = GAME_FILES.find((game) => game.id === "wizball.asm");
const wizballTitle = wizballGame.tracks.find((track) => track.id === "wiz-title");

function createPort() {
  const messages = [];
  const transfers = [];
  return {
    messages,
    transfers,
    onmessage: null,
    postMessage(message, transfer) {
      messages.push(message);
      if (transfer) transfers.push(transfer);
    },
  };
}

function createProcessor(port, options = {}) {
  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = port;
    }
  }
  const Processor = createC64ProcessorClass(FakeAudioWorkletProcessor);
  return new Processor({
    processorOptions: { wasmModule, sampleRate: 48000, ...options },
  });
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

test("worklet processor reports process timing and audio budget diagnostics", async () => {
  const port = createPort();
  const processor = createProcessor(port, { diagnosticsInterval: 4 });
  await waitForMessage(port, "ready");

  loadWizball(port);
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let block = 0; block < 4; block++) {
    processor.process([], [[left, right]]);
  }

  const report = await waitForMessage(port, "audio-diagnostics");
  assert.equal(report.diagnostics.processCalls, 4);
  assert.ok(report.diagnostics.p50Us >= 0);
  assert.ok(report.diagnostics.maxUs >= report.diagnostics.p50Us);
  assert.ok(Math.abs(report.diagnostics.budgetUs - 2666.67) < 1);
  assert.ok(report.diagnostics.gain > 0, "Play should ramp the output gain up");
});

test("player defaults to the playback latency hint", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
  });

  assert.equal(player.getAudioDiagnostics().latencyHint, "playback");
});

test("player queues play until the worklet is ready and then dispatches the active track", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const nodes = [];
  let resolveModule = null;
  const moduleReady = new Promise((resolve) => {
    resolveModule = resolve;
  });

  const fakeContext = {
    sampleRate: 48000,
    state: "suspended",
    destination: {},
    audioWorklet: {
      addModule: () => moduleReady,
    },
    resume: () => Promise.resolve(),
  };

  class FakeAudioWorkletNode {
    constructor(context, name, options) {
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = {
        messages: [],
        onmessage: null,
        postMessage: (message) => this.port.messages.push(message),
      };
      this.destination = null;
      nodes.push(this);
    }

    connect(destination) {
      this.destination = destination;
    }
  }

  const previousNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const player = createWorkbenchPlayer({
      wasm: instance.exports,
      wasmModule,
      rawSources: { "wizball.asm": wizballSource },
      createAudioContext: () => fakeContext,
      workletUrl: "/audio_worklet.js",
    });

    player.selectTrack("wizball.asm", "wiz-title", { autoPlay: false });
    player.play();
    assert.equal(nodes.length, 0, "Worklet node must not exist before addModule resolves");
    assert.equal(player.getState().isPlaying, true);

    resolveModule();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(nodes.length, 1);

    const node = nodes[0];
    assert.equal(node.name, "c64-engine");
    assert.equal(node.options.processorOptions.wasmModule, wasmModule);
    assert.equal(node.port.messages.length, 0, "Commands wait for the processor ready message");

    node.port.onmessage({ data: { type: "ready", sampleRate: 48000 } });
    const types = node.port.messages.map((message) => message.type);
    assert.ok(types.includes("loadTrack"), "Active track must be replayed to the worklet");
    assert.ok(types.includes("play"), "Queued play intent must reach the worklet");
    assert.equal(player.getState().audioBackend, "worklet");
  } finally {
    globalThis.AudioWorkletNode = previousNode;
  }
});

test("worklet processor transfers telemetry buffers and recycles them", async () => {
  const port = createPort();
  const processor = createProcessor(port);
  await waitForMessage(port, "ready");

  loadWizball(port);

  // Return the Track Load snapshot so the pool starts full.
  const loadTelemetry = port.messages.findLast((message) => message.type === "telemetry");
  port.onmessage({ data: { type: "telemetry-recycle", buffer: loadTelemetry.buffer } });
  port.messages.length = 0;
  port.transfers.length = 0;

  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let block = 0; block < 18; block++) {
    processor.process([], [[left, right]]);
  }

  const sent = port.messages.filter((message) => message.type === "telemetry");
  assert.equal(sent.length, 3, "Expected three telemetry messages to drain the pool");
  for (const message of sent) {
    assert.ok(message.buffer instanceof ArrayBuffer);
    assert.equal(message.buffer.byteLength, TELEMETRY_BUFFER_BYTES);
  }
  assert.equal(port.transfers.length, 3, "Every telemetry buffer must be transferred");

  const recycled = sent[0].buffer;
  port.onmessage({ data: { type: "telemetry-recycle", buffer: recycled } });
  for (let block = 0; block < 6; block++) {
    processor.process([], [[left, right]]);
  }

  const next = port.messages.filter((message) => message.type === "telemetry").at(-1);
  assert.equal(next.buffer, recycled, "Expected the worklet to reuse the recycled buffer");
});
