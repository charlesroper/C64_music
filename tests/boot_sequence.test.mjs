import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOT_FADE_MS,
  BOOT_LOADER_MS,
  BOOT_PHASES,
  BOOT_READY_MS,
  createBootSequence,
} from "../src/boot_sequence.js";
import { createTapeLoadingSound } from "../src/tape_loading_sound.js";
import { createBrowserHarness } from "./helpers/browser_harness.mjs";

function createClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();

  function add(fn, ms, interval) {
    const id = ++sequence;
    timers.set(id, { fn, ms, at: now + ms, interval });
    return id;
  }

  function cancel(id) {
    timers.delete(id);
  }

  function advance(ms) {
    const end = now + ms;
    while (true) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.at <= end && (!next || timer.at < next.timer.at)) {
          next = { id, timer };
        }
      }
      if (!next) break;
      now = next.timer.at;
      if (next.timer.interval) {
        next.timer.at += next.timer.ms;
      } else {
        timers.delete(next.id);
      }
      next.timer.fn();
    }
    now = end;
  }

  return {
    schedule: (fn, ms) => add(fn, ms, false),
    cancel,
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: cancel,
    advance,
  };
}

function createBoot(options = {}) {
  const clock = createClock();
  const phases = [];
  const completions = [];
  const boot = createBootSequence({
    document: globalThis.document,
    target: { gameId: "wizball.asm", trackId: "wiz-title", title: "WIZBALL" },
    schedule: clock.schedule,
    cancel: clock.cancel,
    setIntervalFn: clock.setInterval,
    clearIntervalFn: clock.clearInterval,
    animationDuration: 0,
    onPhase: (phase) => phases.push(phase),
    onComplete: (result) => completions.push(result),
    ...options,
  });
  return { boot, clock, phases, completions };
}

function assertImmediateReveal(harness, label) {
  const overlay = harness.elementsById.get("boot-sequence");
  assert.ok(overlay.classList.contains("hidden"), `${label} must reveal immediately`);
  assert.ok(!overlay.classList.contains("is-fading"));
  assert.equal(globalThis.document.body.dataset.bootState, undefined);
}

test("boot sequence reaches the gate, waits for readiness and completes with Wizball playing", async () => {
  const harness = createBrowserHarness();
  try {
    const bootFrame = harness.elementsById.get("boot-frame");
    bootFrame.width = 1440;
    bootFrame.height = 1020;
    const tape = { starts: 0, stops: 0 };
    const { boot, clock, completions } = createBoot({
      tapeSound: {
        start: () => {
          tape.starts++;
        },
        stop: () => {
          tape.stops++;
        },
      },
    });
    const overlay = harness.elementsById.get("boot-sequence");
    assert.equal(
      globalThis.document.body.dataset.bootState,
      "booting",
      "The static boot state must exist before boot.start()",
    );
    assert.ok(
      !overlay.classList.contains("hidden"),
      "The boot overlay must be visible at first paint",
    );
    boot.start();

    assert.ok(!overlay.classList.contains("hidden"));
    assert.equal(globalThis.document.body.dataset.bootState, "booting");
    assert.equal(boot.getState().phase, BOOT_PHASES.POWER_ON);

    clock.advance(120);
    assert.equal(boot.getState().phase, BOOT_PHASES.BASIC);
    clock.advance(600);
    assert.equal(boot.getState().phase, BOOT_PHASES.TYPING);
    clock.advance(6 * 80 + 300);
    assert.equal(boot.getState().phase, BOOT_PHASES.GATE);

    const hint = harness.elementsById.get("boot-hint");
    clock.advance(600);
    assert.ok(!hint.classList.contains("hidden"));

    globalThis.document.dispatchEvent("pointerdown");
    assert.equal(boot.getState().phase, BOOT_PHASES.LOADING);
    assert.equal(completions.length, 0);
    assert.equal(tape.starts, 1);

    boot.setReady();
    clock.advance(2400);
    assert.equal(boot.getState().phase, BOOT_PHASES.LOADING);
    clock.advance(BOOT_LOADER_MS - 2400 + 300);
    assert.equal(boot.getState().phase, BOOT_PHASES.READY);
    assert.equal(tape.stops, 1);
    clock.advance(2000);
    assert.equal(boot.getState().phase, BOOT_PHASES.READY);
    clock.advance(BOOT_READY_MS - 2000);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(boot.getState().phase, BOOT_PHASES.COMPLETE);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].autoPlay, true);
    assert.equal(completions[0].reason, "gate");
    assert.ok(overlay.classList.contains("is-fading"), "Gate completion must start the fade");
    assert.ok(
      !overlay.classList.contains("hidden"),
      "The overlay must stay visible during the fade",
    );
    const frame = harness.elementsById.get("boot-frame");
    assert.equal(frame.style.width, "384px", "The collapsed frame must stay at monitor width");
    assert.equal(frame.style.height, "272px", "The collapsed frame must stay at monitor height");
    assert.equal(globalThis.document.body.dataset.bootState, undefined);

    clock.advance(BOOT_FADE_MS);
    assert.ok(overlay.classList.contains("hidden"), "The overlay must hide after the fade");
    assert.ok(!overlay.classList.contains("is-fading"));
  } finally {
    harness.restoreGlobals();
  }
});

test("tape sound retries once audio is ready after an early gate tap", () => {
  const harness = createBrowserHarness();
  try {
    const tape = { starts: 0, contextReady: false, playing: false };
    const { boot, clock } = createBoot({
      tapeSound: {
        start() {
          tape.starts++;
          if (tape.contextReady) tape.playing = true;
        },
        stop() {
          tape.playing = false;
        },
      },
    });
    boot.start();
    clock.advance(120);
    clock.advance(600);
    clock.advance(6 * 80 + 300);
    assert.equal(boot.getState().phase, BOOT_PHASES.GATE);

    globalThis.document.dispatchEvent("pointerdown");
    assert.equal(tape.starts, 1);
    assert.equal(tape.playing, false, "The gate tap cannot play tape sound without audio");

    tape.contextReady = true;
    boot.setReady();
    assert.equal(tape.starts, 2, "Audio readiness must retry the tape sound");
    assert.equal(tape.playing, true);
  } finally {
    harness.restoreGlobals();
  }
});

test("skip completes with Wizball playing once the player is ready", async () => {
  const harness = createBrowserHarness();
  try {
    const { boot, completions } = createBoot();
    boot.start();
    boot.setReady();
    boot.skip();
    await Promise.resolve();
    assert.equal(completions.length, 1);
    assert.equal(completions[0].autoPlay, true);
    assert.equal(completions[0].reason, "skip");
    assertImmediateReveal(harness, "Skip");
  } finally {
    harness.restoreGlobals();
  }
});

test("reduced motion bypasses the boot and leaves Wizball paused", async () => {
  const harness = createBrowserHarness();
  try {
    const { boot, phases, completions } = createBoot({ reducedMotion: true });
    boot.start();
    assert.equal(completions.length, 1);
    assert.equal(completions[0].autoPlay, false);
    assert.equal(completions[0].reason, "reduced-motion");
    assert.ok(!phases.includes(BOOT_PHASES.POWER_ON));
    assertImmediateReveal(harness, "Reduced motion");
  } finally {
    harness.restoreGlobals();
  }
});

test("tape loading sound preloads, loops recording at balanced gain, and skips start if stopped during decode", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const sources = [];
  const gains = [];
  let fetchedUrl = null;
  const ctx = {
    state: "running",
    currentTime: 10,
    destination: { kind: "destination" },
    async decodeAudioData(copy) {
      assert.notEqual(copy, bytes);
      assert.equal(copy.byteLength, 4);
      return { duration: 28.74 };
    },
    createGain() {
      const targetCalls = [];
      const node = {
        gain: {
          value: 1,
          setTargetAtTime(val, at, tc) {
            targetCalls.push({ val, at, tc });
          },
        },
        targetCalls,
        connect(dest) {
          return dest;
        },
      };
      gains.push(node);
      return node;
    },
    createBufferSource() {
      const src = {
        buffer: null,
        loop: false,
        startedAt: null,
        stoppedAt: null,
        connect(dest) {
          return dest;
        },
        start(at) {
          src.startedAt = at;
        },
        stop(at) {
          src.stoppedAt = at;
        },
      };
      sources.push(src);
      return src;
    },
  };
  const tape = createTapeLoadingSound({
    getContext: () => ctx,
    fetchFn: async (url) => {
      fetchedUrl = url;
      return {
        ok: true,
        async arrayBuffer() {
          return bytes;
        },
      };
    },
  });

  await tape.preload();
  assert.equal(fetchedUrl, "./assets/c64_loading_noise.m4a");

  tape.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  assert.equal(sources[0].startedAt, 0);
  assert.equal(gains[0].gain.value, 0.35);

  tape.stop();
  assert.equal(gains[0].targetCalls.length, 1);
  assert.equal(gains[0].targetCalls[0].val, 0);
  assert.ok(sources[0].stoppedAt > 10);

  let finishDecode = null;
  const slowCtx = {
    ...ctx,
    decodeAudioData() {
      return new Promise((resolve) => {
        finishDecode = () => resolve({ duration: 28.74 });
      });
    },
  };
  const slowTape = createTapeLoadingSound({
    getContext: () => slowCtx,
    fetchFn: async () => ({
      ok: true,
      async arrayBuffer() {
        return bytes;
      },
    }),
  });
  slowTape.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(typeof finishDecode, "function");
  slowTape.stop();
  finishDecode();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sources.length, 1);
});

test("gate completion waits for waitBeforeFade callback before revealing workbench and starting fade", async () => {
  const harness = createBrowserHarness();
  try {
    let releaseFade = null;
    const { boot, clock, completions } = createBoot({
      waitBeforeFade: (ready) => {
        releaseFade = ready;
      },
    });
    const overlay = harness.elementsById.get("boot-sequence");

    boot.start();
    clock.advance(120);
    clock.advance(600);
    clock.advance(6 * 80 + 300);
    globalThis.document.dispatchEvent("pointerdown");
    boot.setReady();
    clock.advance(BOOT_LOADER_MS + 300 + BOOT_READY_MS);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(completions.length, 1);
    assert.equal(typeof releaseFade, "function");
    assert.equal(globalThis.document.body.dataset.bootState, "booting");
    assert.ok(!overlay.classList.contains("is-fading"));

    releaseFade();
    assert.equal(globalThis.document.body.dataset.bootState, undefined);
    assert.ok(overlay.classList.contains("is-fading"));

    clock.advance(BOOT_FADE_MS);
    assert.ok(overlay.classList.contains("hidden"));
  } finally {
    harness.restoreGlobals();
  }
});
