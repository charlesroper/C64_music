import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createEngineCore, GAME_LOADERS } from "../src/engine_core.js";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import { GAME_FILES } from "../src/tracks_catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const wasmBytes = fs.readFileSync(path.join(ROOT, "wasm/c64_engine.wasm"));
const rawSources = {};
for (const name of Object.keys(GAME_LOADERS)) {
  rawSources[name] = fs.readFileSync(path.join(ROOT, name), "latin1");
}
const assembled = {};
for (const name of Object.keys(GAME_LOADERS)) {
  assembled[name] = assembleOceanSource(rawSources[name]);
}

function getGame(gameId) {
  return GAME_FILES.find((game) => game.id === gameId);
}

function getTrack(gameId, trackId) {
  const game = getGame(gameId);
  return game.tracks.find((track) => track.id === trackId) || game.tracks[0];
}

async function createTestCore() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const messages = [];
  const core = createEngineCore({
    wasm: instance.exports,
    postMessage: (message) => messages.push(message),
  });
  return { core, wasm: instance.exports, messages };
}

function loadTrack(core, gameId, trackId, extra = {}) {
  const asm = assembled[gameId];
  core.onmessage({
    data: {
      type: "loadTrack",
      gameId,
      track: getTrack(gameId, trackId),
      mem: asm.mem,
      symbols: asm.symbols,
      ...extra,
    },
  });
}

function peak(samples) {
  let maximum = 0;
  for (const sample of samples) {
    const value = Math.abs(sample);
    if (value > maximum) maximum = value;
  }
  return maximum;
}

test("engine core loads raw assembled bytecode, renders audio, and reports telemetry over messages", async () => {
  const { core, wasm, messages } = await createTestCore();

  core.onmessage({ data: { type: "init", sampleRate: 48000 } });
  loadTrack(core, "wizball.asm", "wiz-title", { autoPlay: true });

  assert.equal(wasm.wasm_get_cpu_pc(), assembled["wizball.asm"].symbols.DLoop);

  const loadMessage = messages.at(-1);
  assert.equal(loadMessage.type, "telemetry");
  assert.ok(loadMessage.snapshot.ram instanceof Uint8Array);
  assert.equal(loadMessage.snapshot.ram.length, 65536);
  assert.equal(typeof loadMessage.snapshot.frameCount, "number");

  const telemetryCount = messages.length;
  const block = new Float32Array(2048);
  const other = new Float32Array(2048);
  let maximum = 0;
  for (let i = 0; i < 8; i++) {
    core.renderAudio(block, other);
    maximum = Math.max(maximum, peak(block));
  }
  assert.ok(maximum > 0.01, `Expected audible Wizball title audio, got peak ${maximum}`);
  assert.equal(block.length, 2048);
  assert.ok(messages.length > telemetryCount, "Rendering must emit telemetry on frame ticks");

  core.onmessage({ data: { type: "pause" } });
  block.fill(1);
  core.renderAudio(block, other);
  assert.equal(peak(block), 0, "Paused core must render exact silence");

  core.onmessage({ data: { type: "play" } });
  maximum = 0;
  for (let i = 0; i < 8; i++) {
    core.renderAudio(block, other);
    maximum = Math.max(maximum, peak(block));
  }
  assert.ok(maximum > 0.01, "Resumed core must render audio again");
});

test("engine core loads an arkanoid bytecode payload for arkadrum drum tracks", async () => {
  const { core, wasm } = await createTestCore();
  const arkanoid = assembled["arkanoid.asm"];

  loadTrack(core, "arkadrum.asm", "arkd-title-drums-only", {
    arkanoidMem: arkanoid.mem,
    arkanoidSymbols: arkanoid.symbols,
    autoPlay: true,
  });

  assert.equal(wasm.wasm_get_cpu_pc(), assembled["arkadrum.asm"].symbols.MAIN);

  const left = new Float32Array(2048);
  const right = new Float32Array(2048);
  let maximum = 0;
  for (let i = 0; i < 24; i++) {
    core.renderAudio(left, right);
    maximum = Math.max(maximum, peak(left));
  }
  assert.ok(maximum > 0.15, `Expected isolated digi-drums, got peak ${maximum}`);
});

test("track load freezes the clock, starts at frame 0, and never pre-renders audio", async () => {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const wasm = {};
  for (const [name, value] of Object.entries(instance.exports)) wasm[name] = value;
  let renderCalls = 0;
  const originalRender = wasm.wasm_render_audio;
  wasm.wasm_render_audio = (samples) => {
    renderCalls++;
    originalRender(samples);
  };

  const messages = [];
  const core = createEngineCore({
    wasm,
    postMessage: (message) => messages.push(message),
  });

  loadTrack(core, "rambload.asm", "rambo-full", { autoPlay: false });

  assert.equal(renderCalls, 0, "Track load must not call wasm_render_audio");
  assert.equal(messages.at(-1).snapshot.frameCount, 0, "Track must start at frame 0");

  const left = new Float32Array(2048);
  const right = new Float32Array(2048);
  left.fill(1);
  right.fill(1);
  core.renderAudio(left, right);
  assert.equal(peak(left), 0, "Frozen clock must output silence while paused");
  assert.equal(peak(right), 0, "Frozen clock must output silence while paused");

  core.onmessage({ data: { type: "requestTelemetry" } });
  assert.equal(messages.at(-1).snapshot.frameCount, 0, "Silence must not advance the clock");
});

test("fast-forward applies 3 extra frames per 2048 samples across small and large render blocks", async () => {
  for (const blockSize of [128, 2048]) {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const wasm = {};
    for (const [name, value] of Object.entries(instance.exports)) wasm[name] = value;
    const calls = [];
    const originalFastForward = wasm.wasm_fast_forward_frames;
    wasm.wasm_fast_forward_frames = (frames) => {
      calls.push(frames);
      return originalFastForward(frames);
    };

    const core = createEngineCore({ wasm, postMessage: () => {} });
    loadTrack(core, "wizball.asm", "wiz-title", { autoPlay: true });
    core.onmessage({ data: { type: "play" } });
    core.onmessage({ data: { type: "setHardwareOptions", options: { isFastForward: true } } });

    const left = new Float32Array(blockSize);
    const right = new Float32Array(blockSize);
    for (let rendered = 0; rendered < 4096; rendered += blockSize) {
      core.renderAudio(left, right);
    }

    assert.equal(
      calls.length,
      2,
      `Block size ${blockSize} must fast-forward twice across 4096 samples`,
    );
    assert.equal(
      calls.reduce((total, frames) => total + frames, 0),
      6,
    );
  }
});

test("commands received during a track load queue and apply in order afterwards", async () => {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const wasm = {};
  for (const [name, value] of Object.entries(instance.exports)) wasm[name] = value;

  const muteCalls = [];
  const keyCalls = [];
  const originalMute = wasm.wasm_set_voice_mute_mask;
  const originalKey = wasm.wasm_inject_key;
  wasm.wasm_set_voice_mute_mask = (mask) => {
    muteCalls.push(mask);
    originalMute(mask);
  };
  wasm.wasm_inject_key = (charCode) => {
    keyCalls.push(charCode);
    originalKey(charCode);
  };

  const core = createEngineCore({ wasm, postMessage: () => {} });
  const originalLoader = GAME_LOADERS["gameover.asm"];
  GAME_LOADERS["gameover.asm"] = (args) => {
    core.onmessage({ data: { type: "setHardwareOptions", options: { muteMask: 0x01 } } });
    core.onmessage({ data: { type: "injectKey", charCode: 0x41 } });
    core.onmessage({ data: { type: "setHardwareOptions", options: { muteMask: 0x02 } } });
    core.onmessage({ data: { type: "injectKey", charCode: 0x42 } });
    originalLoader(args);
  };

  try {
    loadTrack(core, "gameover.asm", "go-title-full", { autoPlay: false });
  } finally {
    GAME_LOADERS["gameover.asm"] = originalLoader;
  }

  assert.deepEqual(
    muteCalls,
    [0, 0, 1, 2],
    "Queued hardware options must apply after load in exact order",
  );
  assert.deepEqual(keyCalls, [0x41, 0x42], "Queued key injections must apply in exact order");
});

test("engine core applies hardware options, injects keys, and keeps loaded RAM through init", async () => {
  const { core, messages } = await createTestCore();

  loadTrack(core, "rambload.asm", "rambo-full", { autoPlay: false });
  const rendered = core.renderAudio(8);
  assert.ok(rendered.left instanceof Float32Array);
  assert.equal(rendered.right.length, 8);

  const before = messages.at(-1).snapshot.ram[0x0400 + 1 * 40 + 2];
  assert.equal(before, "R".charCodeAt(0));

  core.onmessage({ data: { type: "init", sampleRate: 44100 } });
  core.onmessage({ data: { type: "injectKey", charCode: "E".charCodeAt(0) } });
  core.onmessage({ data: { type: "requestTelemetry" } });

  const latest = messages.at(-1);
  assert.equal(latest.type, "telemetry");
  assert.equal(
    latest.snapshot.ram[0x0400 + 1 * 40 + 2],
    before,
    "Negotiating the sample rate must not wipe loaded C64 RAM",
  );

  core.onmessage({ data: { type: "setHardwareOptions", options: { muteMask: 0x0f } } });
  core.onmessage({ data: { type: "play" } });
  const left = new Float32Array(2048);
  const right = new Float32Array(2048);
  for (let i = 0; i < 4; i++) core.renderAudio(left, right);
  assert.ok(peak(left) < 0.005, "Muting every voice must silence the core output");
});
