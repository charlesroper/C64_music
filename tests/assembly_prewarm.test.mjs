import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assembleSources } from "../src/assembly_worker.js";
import { createWorkbenchPlayer } from "../src/player_engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const wasmBytes = fs.readFileSync(path.join(ROOT, "wasm/c64_engine.wasm"));
const fileNames = [
  "wizball.asm",
  "arkanoid.asm",
  "arkadrum.asm",
  "gameover.asm",
  "greenberet.asm",
  "rambload.asm",
];
const rawSources = {};
for (const name of fileNames) {
  rawSources[name] = fs.readFileSync(path.join(ROOT, name), "latin1");
}

class FakeAssemblyWorker {
  constructor() {
    this.terminated = false;
  }

  postMessage(message) {
    const results = assembleSources(message.sources);
    queueMicrotask(() => this.onmessage?.({ data: { results } }));
  }

  terminate() {
    this.terminated = true;
  }
}

async function createPlayer(options = {}) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: () => ({
      sampleRate: 48000,
      state: "suspended",
      resume() {
        this.state = "running";
        return Promise.resolve();
      },
    }),
    navigatorObj: { audioSession: { type: "ambient" } },
    ...options,
  });
}

test("prewarm assembles all six sources off the main thread and rehydrates source indexes", async () => {
  const player = await createPlayer({
    createAssemblyWorker: () => new FakeAssemblyWorker(),
  });

  assert.equal(await player.prewarmAssemblies(), true);
  const cache = player.getAssembledCache();
  assert.deepEqual(Object.keys(cache).sort(), [...fileNames].sort());
  for (const gameId of fileNames) {
    assert.equal(cache[gameId].mem.length, 65536, `${gameId} memory image`);
    assert.equal(typeof cache[gameId].sourceIndex.lineForAddress, "function");
    assert.equal(typeof cache[gameId].sourceIndex.findLines, "function");
  }
  assert.equal(player.getAssembled("wizball.asm"), cache["wizball.asm"]);
});

test("prewarm falls back when no worker is available", async () => {
  const player = await createPlayer({
    createAssemblyWorker: () => null,
  });

  assert.equal(await player.prewarmAssemblies(), false);
  const assembled = player.getAssembled("wizball.asm");
  assert.ok(assembled);
  assert.equal(assembled.mem.length, 65536);
  assert.equal(typeof assembled.sourceIndex.lineForSymbol, "function");
});
