import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createC64ProcessorClass } from "../src/audio_worklet.js";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import {
  AUDIO_MODE_STORAGE_KEY,
  createAudioContextManager,
  createWorkbenchPlayer,
} from "../src/player_engine.js";
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

function createWorkletHarness({ addModule = () => Promise.resolve(), state = "running" } = {}) {
  const nodes = [];
  const fakeContext = {
    sampleRate: 48000,
    state,
    destination: {},
    audioWorklet: { addModule },
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
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

  return { nodes, fakeContext, FakeAudioWorkletNode };
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
  const frames = [0, 128, 384, 512];
  globalThis.currentFrame = frames[0];
  try {
    for (let block = 0; block < 4; block++) {
      globalThis.currentFrame = frames[block];
      processor.process([], [[left, right]]);
    }

    const first = await waitForMessage(port, "audio-diagnostics");
    const firstDiagnostics = first.diagnostics;
    assert.equal(firstDiagnostics.processCalls, 4);
    assert.ok(firstDiagnostics.p50Us >= 0);
    assert.ok(firstDiagnostics.maxUs >= firstDiagnostics.p50Us);
    assert.ok(Math.abs(firstDiagnostics.budgetUs - 2666.67) < 1);
    assert.ok(firstDiagnostics.lateQuanta >= 0);
    assert.ok(firstDiagnostics.lateWindow >= 0);
    assert.ok(firstDiagnostics.latePeakWindow >= firstDiagnostics.lateWindow);
    assert.ok(firstDiagnostics.missedQuanta >= 1, "A 256-frame gap must count as missed");
    assert.equal(firstDiagnostics.missedWindow, 1);
    assert.ok(firstDiagnostics.missedPeakWindow >= 1);
    assert.ok(firstDiagnostics.processPeakUs >= firstDiagnostics.maxUs);
    assert.ok(firstDiagnostics.telemetryDropWindow >= 0);
    assert.ok(firstDiagnostics.telemetryDropPeakWindow >= 0);

    for (const key of [
      "renderAudioMaxUs",
      "renderAudioPeakUs",
      "packTelemetryMaxUs",
      "packTelemetryPeakUs",
      "postMessageMaxUs",
      "postMessagePeakUs",
      "applyGainMaxUs",
      "applyGainPeakUs",
    ]) {
      assert.equal(typeof firstDiagnostics[key], "number", `${key} must be numeric`);
      assert.ok(firstDiagnostics[key] >= 0, `${key} must be non-negative`);
    }
    assert.ok(firstDiagnostics.renderAudioPeakUs >= firstDiagnostics.renderAudioMaxUs);
    assert.ok(firstDiagnostics.packTelemetryPeakUs >= firstDiagnostics.packTelemetryMaxUs);
    assert.ok(firstDiagnostics.postMessagePeakUs >= firstDiagnostics.postMessageMaxUs);
    assert.ok(firstDiagnostics.applyGainPeakUs >= firstDiagnostics.applyGainMaxUs);
    assert.ok(firstDiagnostics.gain > 0, "Play should ramp the output gain up");

    port.messages.length = 0;
    for (let block = 0; block < 4; block++) {
      globalThis.currentFrame += 128;
      processor.process([], [[left, right]]);
    }

    const second = await waitForMessage(port, "audio-diagnostics");
    const secondDiagnostics = second.diagnostics;
    assert.ok(secondDiagnostics.processPeakUs >= firstDiagnostics.processPeakUs);
    assert.ok(secondDiagnostics.processPeakUs >= secondDiagnostics.maxUs);
    assert.equal(secondDiagnostics.missedWindow, 0, "The clean window must reset missedWindow");
    assert.equal(secondDiagnostics.missedPeakWindow, firstDiagnostics.missedPeakWindow);
  } finally {
    delete globalThis.currentFrame;
  }
});

test("worklet processor windows telemetry drops and keeps the peak", () => {
  const port = createPort();
  const processor = createProcessor(port);
  const snapshot = {
    frameCount: 0,
    cpuPc: 0,
    d418: 0,
    morseIndex: -1,
    ram: new Uint8Array(65536),
    scopeData: new Float32Array(4 * 512),
    sidRegs: new Uint8Array(32),
    scanlineBorder: new Uint8Array(312),
    voices: [
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
    ],
    filter: { fc: 0, res: 0, rout: 0, mode: 0, vol: 0 },
  };

  for (let i = 0; i < 8; i++) processor.sendTelemetry(snapshot);
  processor.reportDiagnostics();

  let report = port.messages.findLast((message) => message.type === "audio-diagnostics");
  assert.equal(report.diagnostics.telemetryDropWindow, 2);
  assert.equal(report.diagnostics.telemetryDropPeakWindow, 2);

  for (const message of port.messages.filter((message) => message.type === "telemetry")) {
    processor.recycleTelemetry(message.buffer);
  }
  port.messages.length = 0;

  processor.sendTelemetry(snapshot);
  processor.reportDiagnostics();

  report = port.messages.findLast((message) => message.type === "audio-diagnostics");
  assert.equal(report.diagnostics.telemetryDropWindow, 0);
  assert.equal(report.diagnostics.telemetryDropPeakWindow, 2);
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

test("player resolves Audio Mode as URL override, then Stored Audio Mode, then playback", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const modeFor = ({ latencyOverride, stored, brokenStorage = false }) => {
    const win = brokenStorage
      ? {
          get localStorage() {
            throw new Error("storage unavailable");
          },
        }
      : { localStorage: { getItem: (key) => (key === AUDIO_MODE_STORAGE_KEY ? stored : null) } };
    return createWorkbenchPlayer({
      wasm: instance.exports,
      wasmModule,
      rawSources: { "wizball.asm": wizballSource },
      latencyOverride,
      window: win,
    }).getState().latencyHint;
  };

  assert.equal(modeFor({}), "playback");
  assert.equal(modeFor({ stored: "interactive" }), "interactive");
  assert.equal(modeFor({ stored: "playback" }), "playback");
  assert.equal(modeFor({ stored: "broken" }), "playback");
  assert.equal(modeFor({ brokenStorage: true }), "playback");
  assert.equal(modeFor({ latencyOverride: "playback", stored: "interactive" }), "playback");
  assert.equal(modeFor({ latencyOverride: "interactive", stored: "playback" }), "interactive");
  for (const bogus of ["balanced", "0.2", "bogus"]) {
    assert.equal(modeFor({ latencyOverride: bogus, stored: "interactive" }), "interactive");
    assert.equal(modeFor({ latencyOverride: bogus }), "playback");
  }
});

test("setLatencyMode persists Stored Audio Mode and boot resolution never writes it", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const stored = new Map([[AUDIO_MODE_STORAGE_KEY, "playback"]]);
  const writes = [];
  const win = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => {
        writes.push(value);
        stored.set(key, value);
      },
    },
  };
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
    latencyOverride: "interactive",
    window: win,
  });

  assert.equal(player.getState().latencyHint, "interactive");
  assert.deepEqual(writes, [], "A one-load URL override must not overwrite the stored choice");
  assert.equal(stored.get(AUDIO_MODE_STORAGE_KEY), "playback");

  await player.setLatencyMode("interactive");
  assert.equal(
    stored.get(AUDIO_MODE_STORAGE_KEY),
    "interactive",
    "An explicit choice is stored even when the active mode does not change",
  );

  await player.setLatencyMode("playback");
  assert.equal(stored.get(AUDIO_MODE_STORAGE_KEY), "playback");
  assert.equal(player.getState().latencyHint, "playback");

  await player.setLatencyMode("bogus");
  assert.equal(
    stored.get(AUDIO_MODE_STORAGE_KEY),
    "playback",
    "Invalid modes normalise to playback",
  );
  assert.equal(player.getState().latencyHint, "playback");

  const unavailable = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
    window: {
      localStorage: {
        getItem: () => null,
        setItem() {
          throw new Error("storage unavailable");
        },
      },
    },
  });
  assert.equal(await unavailable.setLatencyMode("interactive"), "interactive");
  assert.equal(unavailable.getState().latencyHint, "interactive");

  const noStorage = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
    window: {},
  });
  assert.equal(await noStorage.setLatencyMode("interactive"), "interactive");
});

test("audio context manager unlocks early, adopts a matching context and closes a stale one", () => {
  const created = [];
  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.state = "suspended";
      this.closed = false;
      created.push(this);
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      return Promise.resolve();
    }
  }
  const navigatorObj = { audioSession: { type: "ambient" } };
  const manager = createAudioContextManager({
    window: { AudioContext: FakeAudioContext },
    navigator: navigatorObj,
    latencyHint: "playback",
  });

  manager.unlock();
  assert.equal(navigatorObj.audioSession.type, "playback");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].options, { sampleRate: 48000, latencyHint: "playback" });
  assert.equal(created[0].state, "running");

  manager.unlock();
  assert.equal(created.length, 1, "A second unlock must reuse the pre-unlocked context");

  const adopted = manager.createAudioContext({ sampleRate: 48000, latencyHint: "playback" });
  assert.equal(adopted, created[0], "A matching pre-unlocked context must be adopted");
  assert.equal(created[0].closed, false);

  manager.unlock();
  assert.equal(created.length, 2);
  const fresh = manager.createAudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  assert.equal(created[1].closed, true, "A stale pre-unlocked context must close");
  assert.notEqual(fresh, created[1]);
  assert.deepEqual(fresh.options, { sampleRate: 48000, latencyHint: "interactive" });

  const direct = manager.createAudioContext({ sampleRate: 48000, latencyHint: "playback" });
  assert.equal(created.length, 4, "Without a pre-unlocked context a new one is created");
  assert.notEqual(direct, fresh);
});

test("audio context manager falls back when the context rejects its options", () => {
  class PickyAudioContext {
    constructor(options) {
      if (options) throw new DOMException("Unsupported option", "NotSupportedError");
      this.state = "running";
    }
    close() {
      return Promise.resolve();
    }
  }
  const manager = createAudioContextManager({
    window: { AudioContext: PickyAudioContext },
    navigator: null,
    latencyHint: "interactive",
  });

  manager.unlock();
  const adopted = manager.createAudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  assert.ok(adopted instanceof PickyAudioContext);
  assert.equal(adopted.state, "running");
});

test("player builds its own AudioContext from the window when no factory is injected", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const created = [];
  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.sampleRate = 48000;
      this.state = "running";
      this.destination = {};
      created.push(this);
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
    latencyOverride: "interactive",
    window: { AudioContext: FakeAudioContext },
  });

  player.prepareAudio();
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].options, { sampleRate: 48000, latencyHint: "interactive" });
  assert.equal(player.getAudioContext(), created[0]);
});

test("player passes the two audio modes to the AudioContext", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});

  for (const hint of ["playback", "interactive"]) {
    let received = null;
    const player = createWorkbenchPlayer({
      wasm: instance.exports,
      wasmModule,
      rawSources: { "wizball.asm": wizballSource },
      latencyHint: hint,
      createAudioContext: (options) => {
        received = options;
        return {
          sampleRate: 48000,
          state: "running",
          destination: {},
          resume: () => Promise.resolve(),
        };
      },
    });

    player.play();
    assert.equal(received.latencyHint, hint);
    assert.equal(player.getAudioDiagnostics().latencyHint, hint);
  }
});

test("player reports the fixed 62.5Hz telemetry rate", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
  });

  assert.equal(player.getState().telemetryHz, 62.5);
  assert.equal(player.getAudioDiagnostics().telemetryHz, 62.5);
  assert.equal(typeof player.setTelemetryHz, "undefined");
  assert.equal(typeof player.setTelemetryEnabled, "undefined");
});

test("player soft-restarts the audio context when latency mode changes", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  const contexts = [];
  const createAudioContext = (options) => {
    const ctx = {
      sampleRate: 48000,
      state: "running",
      destination: {},
      latencyHint: options?.latencyHint,
      closed: false,
      resume() {
        this.state = "running";
        return Promise.resolve();
      },
      close() {
        this.closed = true;
        return Promise.resolve();
      },
    };
    contexts.push(ctx);
    return ctx;
  };

  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    rawSources: { "wizball.asm": wizballSource },
    createAudioContext,
  });

  player.selectTrack("wizball.asm", "wiz-title", { autoPlay: true });
  const left = new Float32Array(2048);
  const right = new Float32Array(2048);
  player.pullAudioBlock(left, right);

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].latencyHint, "playback");

  await player.setLatencyMode("interactive");
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].closed, true, "Old AudioContext must close");
  assert.equal(contexts[1].latencyHint, "interactive");
  assert.equal(player.getState().latencyHint, "interactive");
  assert.equal(player.getState().isPlaying, true);
  assert.equal(player.getAudioDiagnostics().latencyHint, "interactive");

  left.fill(0);
  right.fill(0);
  player.pullAudioBlock(left, right);
  player.pullAudioBlock(left, right);
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]));
  }
  assert.ok(peak > 0.01, `Restarted track must still produce audio, got peak=${peak}`);

  await player.setLatencyMode("playback");
  assert.equal(contexts.length, 3);
  assert.equal(contexts[1].closed, true);
  assert.equal(contexts[2].latencyHint, "playback");
  assert.equal(player.getState().latencyHint, "playback");
});

test("player queues play until the worklet is ready and then dispatches the active track", async () => {
  const instance = await WebAssembly.instantiate(wasmModule, {});
  let resolveModule = null;
  const moduleReady = new Promise((resolve) => {
    resolveModule = resolve;
  });
  const { nodes, fakeContext, FakeAudioWorkletNode } = createWorkletHarness({
    addModule: () => moduleReady,
    state: "suspended",
  });

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

    node.port.onmessage({
      data: {
        type: "audio-diagnostics",
        diagnostics: {
          processPeakUs: 16000,
          latePeakWindow: 6,
          missedPeakWindow: 3,
          telemetryDropPeakWindow: 4,
          renderAudioPeakUs: 14000,
          packTelemetryPeakUs: 2000,
          postMessagePeakUs: 300,
          applyGainPeakUs: 50,
        },
      },
    });
    assert.equal(player.getAudioDiagnostics().processPeakUs, 16000);
    assert.equal(player.getAudioDiagnostics().latePeakWindow, 6);
    assert.equal(player.getAudioDiagnostics().missedPeakWindow, 3);
    assert.equal(player.getAudioDiagnostics().renderAudioPeakUs, 14000);
    assert.equal(player.getAudioDiagnostics().packTelemetryPeakUs, 2000);
    assert.equal(player.getAudioDiagnostics().postMessagePeakUs, 300);
    assert.equal(player.getAudioDiagnostics().applyGainPeakUs, 50);

    await player.setLatencyMode("interactive");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(nodes.length, 2, "Restart must create a new worklet node");
    const restartedNode = nodes[1];
    restartedNode.port.onmessage({ data: { type: "ready", sampleRate: 48000 } });
    assert.equal(player.getState().latencyHint, "interactive");

    restartedNode.port.onmessage({
      data: {
        type: "audio-diagnostics",
        diagnostics: {
          processPeakUs: 1000,
          latePeakWindow: 1,
          missedPeakWindow: 0,
          telemetryDropPeakWindow: 0,
          renderAudioPeakUs: 900,
          packTelemetryPeakUs: 100,
          postMessagePeakUs: 10,
          applyGainPeakUs: 5,
        },
      },
    });
    const diagnostics = player.getAudioDiagnostics();
    assert.equal(diagnostics.processPeakUs, 16000, "Process peak must survive a context restart");
    assert.equal(diagnostics.latePeakWindow, 6, "Late peak must survive a context restart");
    assert.equal(diagnostics.missedPeakWindow, 3, "Missed peak must survive a context restart");
    assert.equal(diagnostics.renderAudioPeakUs, 14000);
    assert.equal(diagnostics.packTelemetryPeakUs, 2000);
    assert.equal(diagnostics.postMessagePeakUs, 300);
    assert.equal(diagnostics.applyGainPeakUs, 50);
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
