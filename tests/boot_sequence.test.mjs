import assert from "node:assert/strict";
import test from "node:test";
import { createAudioLifecycle } from "../src/audio_lifecycle.js";
import { createBootHandoff, FIRST_FRAME_TIMEOUT_MS } from "../src/boot_handoff.js";
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
    now: () => now,
    activeCount: () => timers.size,
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
  assert.ok(!overlay.classList.contains("bootSequence-isFading"));
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
    assert.ok(
      overlay.classList.contains("bootSequence-isFading"),
      "Gate completion must start the fade",
    );
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
    assert.ok(!overlay.classList.contains("bootSequence-isFading"));
  } finally {
    harness.restoreGlobals();
  }
});

test("boot sequence omits startTapeSound and does not re-trigger tape sound on setReady", () => {
  const harness = createBrowserHarness();
  try {
    const tape = { starts: 0 };
    const { boot, clock } = createBoot({
      tapeSound: {
        start() {
          tape.starts++;
        },
        stop() {},
      },
    });
    assert.equal(boot.startTapeSound, undefined);

    boot.start();
    clock.advance(120);
    clock.advance(600);
    clock.advance(6 * 80 + 300);
    assert.equal(boot.getState().phase, BOOT_PHASES.GATE);

    globalThis.document.dispatchEvent("pointerdown");
    assert.equal(tape.starts, 1);

    boot.setReady();
    assert.equal(tape.starts, 1, "setReady must not call tapeSound.start() a second time");
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
      return { duration: 9.0 };
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
  const lifecycle = createAudioLifecycle({ createContext: () => ctx });
  lifecycle.unlock();
  const tape = createTapeLoadingSound({
    audioLifecycle: lifecycle,
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
        finishDecode = () => resolve({ duration: 9.0 });
      });
    },
  };
  const slowLifecycle = createAudioLifecycle({ createContext: () => slowCtx });
  slowLifecycle.unlock();
  const slowTape = createTapeLoadingSound({
    audioLifecycle: slowLifecycle,
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
    assert.ok(!overlay.classList.contains("bootSequence-isFading"));

    releaseFade();
    assert.equal(globalThis.document.body.dataset.bootState, undefined);
    assert.ok(overlay.classList.contains("bootSequence-isFading"));

    clock.advance(BOOT_FADE_MS);
    assert.ok(overlay.classList.contains("hidden"));
  } finally {
    harness.restoreGlobals();
  }
});

test("destroy during waitBeforeFade invokes returned cancel handle and prevents late reveal or fade", async () => {
  const harness = createBrowserHarness();
  try {
    let releaseFade = null;
    let cancelCalls = 0;
    const { boot, clock, completions } = createBoot({
      waitBeforeFade: (ready) => {
        releaseFade = ready;
        return () => {
          cancelCalls++;
        };
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
    assert.equal(cancelCalls, 0);
    assert.equal(globalThis.document.body.dataset.bootState, "booting");

    boot.destroy();
    assert.equal(cancelCalls, 1, "destroy() must invoke cancel() returned by waitBeforeFade");
    assert.equal(globalThis.document.body.dataset.bootState, undefined);
    assert.ok(overlay.classList.contains("hidden"));

    releaseFade();
    assert.ok(
      !overlay.classList.contains("bootSequence-isFading"),
      "Late ready() after destroy() must not start fade",
    );
    assert.ok(overlay.classList.contains("hidden"));
  } finally {
    harness.restoreGlobals();
  }

  // Calling ready() asynchronously clears the handle so later destroy() skips cancel().
  const harnessAsync = createBrowserHarness();
  try {
    let releaseAsync = null;
    let cancelAfterFadeCalls = 0;
    const asyncCase = createBoot({
      waitBeforeFade: (ready) => {
        releaseAsync = ready;
        return () => {
          cancelAfterFadeCalls++;
        };
      },
    });
    asyncCase.boot.start();
    asyncCase.clock.advance(120 + 600 + 6 * 80 + 300);
    globalThis.document.dispatchEvent("pointerdown");
    asyncCase.boot.setReady();
    asyncCase.clock.advance(BOOT_LOADER_MS + 300 + BOOT_READY_MS);
    await Promise.resolve();
    await Promise.resolve();

    releaseAsync();
    asyncCase.boot.destroy();
    assert.equal(cancelAfterFadeCalls, 0, "startFade() must clear pending cancel handle");
  } finally {
    harnessAsync.restoreGlobals();
  }

  // Synchronous ready() inside waitBeforeFade invokes returned cancel() immediately.
  const harnessSync = createBrowserHarness();
  try {
    let syncCancelCalls = 0;
    const syncCase = createBoot({
      waitBeforeFade: (ready) => {
        ready();
        return () => {
          syncCancelCalls++;
        };
      },
    });
    syncCase.boot.start();
    syncCase.clock.advance(120 + 600 + 6 * 80 + 300);
    globalThis.document.dispatchEvent("pointerdown");
    syncCase.boot.setReady();
    syncCase.clock.advance(BOOT_LOADER_MS + 300 + BOOT_READY_MS);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(
      syncCancelCalls,
      1,
      "Returned cancel handle must be invoked immediately when reveal already started",
    );
    syncCase.boot.destroy();
    assert.equal(syncCancelCalls, 1);
  } finally {
    harnessSync.restoreGlobals();
  }
});

function createFakeAudioEnv({ initiallyActivated = false } = {}) {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  let userActivation = initiallyActivated;
  let fetchCount = 0;
  const sources = [];

  function createContext() {
    const ctx = {
      state: userActivation ? "running" : "suspended",
      currentTime: 0,
      destination: {},
      resume() {
        if (userActivation) ctx.state = "running";
        return Promise.resolve();
      },
      async decodeAudioData() {
        return { duration: 9.0 };
      },
      createGain() {
        return {
          gain: { value: 1, setTargetAtTime() {} },
          connect(dest) {
            return dest;
          },
        };
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
    return ctx;
  }

  const fetchFn = async () => {
    fetchCount++;
    return {
      ok: true,
      async arrayBuffer() {
        return bytes;
      },
    };
  };

  return {
    createContext,
    fetchFn,
    sources,
    getFetchCount: () => fetchCount,
    setUserActivation: (value) => {
      userActivation = value;
    },
  };
}

test("tape loading sound warms bytes and plays once Audio Lifecycle unlocks across pointerdown to pointerup or click", async () => {
  const harness = createBrowserHarness();
  try {
    // Subcase A: start() before any context exists, then pointerdown (suspended), then pointerup (running)
    const envA = createFakeAudioEnv({ initiallyActivated: false });
    const lifecycleA = createAudioLifecycle({
      document: globalThis.document,
      createContext: envA.createContext,
    });
    const tapeA = createTapeLoadingSound({
      audioLifecycle: lifecycleA,
      fetchFn: envA.fetchFn,
    });

    tapeA.start();
    assert.equal(envA.getFetchCount(), 1, "start() before unlock must warm tape audio bytes");
    assert.equal(envA.sources.length, 0);

    globalThis.document.dispatchEvent("pointerdown", { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(lifecycleA.getContext().state, "suspended");
    assert.equal(envA.sources.length, 0, "Suspended context must not start BufferSource");

    envA.setUserActivation(true);
    globalThis.document.dispatchEvent("pointerup", { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(envA.sources.length, 1, "Unlock on pointerup must trigger armed tape playback");
    assert.equal(envA.sources[0].loop, true);
    tapeA.stop();
    lifecycleA.destroy();

    // Subcase B: pointerdown creates suspended context first, then start() is called, then click activates
    const envB = createFakeAudioEnv({ initiallyActivated: false });
    const lifecycleB = createAudioLifecycle({
      document: globalThis.document,
      createContext: envB.createContext,
    });
    const tapeB = createTapeLoadingSound({
      audioLifecycle: lifecycleB,
      fetchFn: envB.fetchFn,
    });

    globalThis.document.dispatchEvent("pointerdown", { pointerType: "touch" });
    assert.equal(lifecycleB.getContext().state, "suspended");
    tapeB.start();
    assert.equal(envB.getFetchCount(), 1, "start() while suspended must warm tape audio bytes");
    assert.equal(envB.sources.length, 0);

    envB.setUserActivation(true);
    globalThis.document.dispatchEvent("click", { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(envB.sources.length, 1, "Unlock on click must trigger armed tape playback");
    tapeB.stop();
    lifecycleB.destroy();
  } finally {
    harness.restoreGlobals();
  }
});

test("tape loading sound stop() before unlock disarms and unsubscribes immediately", async () => {
  const harness = createBrowserHarness();
  try {
    const env = createFakeAudioEnv({ initiallyActivated: false });
    const lifecycle = createAudioLifecycle({
      document: globalThis.document,
      createContext: env.createContext,
    });
    let activeSubscriptions = 0;
    const trackedLifecycle = {
      ...lifecycle,
      subscribe(listener) {
        activeSubscriptions++;
        const unsub = lifecycle.subscribe(listener);
        let removed = false;
        return () => {
          if (!removed) {
            removed = true;
            activeSubscriptions--;
          }
          unsub();
        };
      },
    };
    const tape = createTapeLoadingSound({
      audioLifecycle: trackedLifecycle,
      fetchFn: env.fetchFn,
    });

    tape.start();
    assert.equal(activeSubscriptions, 1, "start() before unlock must subscribe to Audio Lifecycle");

    tape.stop();
    assert.equal(activeSubscriptions, 0, "stop() must unsubscribe immediately before any unlock");

    env.setUserActivation(true);
    globalThis.document.dispatchEvent("pointerup", { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.sources.length, 0, "Later unlock must produce zero BufferSource playback");
    lifecycle.destroy();
  } finally {
    harness.restoreGlobals();
  }
});

test("tape loading sound ignores duplicate start() across synchronous resume and handles closed/replaced contexts during decode", async () => {
  const harness = createBrowserHarness();
  try {
    // 1. Re-entrant synchronous resume on repeated start() creates only one BufferSource
    const env = createFakeAudioEnv({ initiallyActivated: false });
    const lifecycle = createAudioLifecycle({
      document: globalThis.document,
      createContext: env.createContext,
    });
    const tape = createTapeLoadingSound({
      audioLifecycle: lifecycle,
      fetchFn: env.fetchFn,
    });

    globalThis.document.dispatchEvent("pointerdown", { pointerType: "touch" });
    tape.start();
    env.setUserActivation(true);
    tape.start();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.sources.length, 1, "Synchronous resume during start() must not play twice");
    tape.stop();
    lifecycle.destroy();

    // 2. Closing context during decode prevents BufferSource creation
    let finishCloseDecode = null;
    const closeSources = [];
    const closeCtx = {
      ...createFakeAudioEnv({ initiallyActivated: true }).createContext(),
      decodeAudioData() {
        return new Promise((resolve) => {
          finishCloseDecode = () => resolve({ duration: 9.0 });
        });
      },
      createBufferSource() {
        const src = {
          connect: (d) => d,
          start() {},
          stop() {},
        };
        closeSources.push(src);
        return src;
      },
    };
    const closeLifecycle = createAudioLifecycle({ createContext: () => closeCtx });
    closeLifecycle.unlock();
    const closeTape = createTapeLoadingSound({
      audioLifecycle: closeLifecycle,
      fetchFn: env.fetchFn,
    });
    closeTape.start();
    await new Promise((r) => setTimeout(r, 0));
    await closeLifecycle.close();
    finishCloseDecode();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      closeSources.length,
      0,
      "Closed context during decode must not start BufferSource",
    );
    closeTape.stop();
    closeLifecycle.destroy();
  } finally {
    harness.restoreGlobals();
  }
});

function createHandoffDoubles({
  pendingPlayOnBoot = false,
  audioBackend = "in-thread",
  telemetry = null,
} = {}) {
  const calls = [];
  let audioCtx = null;
  let currentTelemetry = telemetry;
  let readyCalls = 0;

  const boot = {
    setReady() {
      readyCalls++;
      calls.push(["boot.setReady"]);
    },
  };

  const view = {
    setRenderingPaused(paused) {
      calls.push(["view.setRenderingPaused", paused]);
    },
    selectGameAndTrack(gameId, trackId, autoPlay) {
      calls.push(["view.selectGameAndTrack", gameId, trackId, autoPlay]);
    },
    setPlaying(playing) {
      calls.push(["view.setPlaying", playing]);
    },
    renderTelemetry(snapshot) {
      calls.push(["view.renderTelemetry", snapshot.frameCount]);
    },
    isPendingPlayOnBoot() {
      return pendingPlayOnBoot;
    },
  };

  const player = {
    prepareAudio() {
      calls.push(["player.prepareAudio"]);
      audioCtx = { state: "running", audioWorklet: audioBackend === "worklet" ? {} : null };
    },
    getAudioContext() {
      return audioCtx;
    },
    setAudioContext(ctx) {
      audioCtx = ctx;
    },
    getState() {
      return { audioBackend };
    },
    getTelemetry() {
      return currentTelemetry;
    },
    setTelemetry(next) {
      currentTelemetry = next;
    },
  };

  return {
    calls,
    boot,
    view,
    player,
    getReadyCalls: () => readyCalls,
  };
}

test("Boot Handoff joins prewarm-before-gate and gate-before-prewarm orderings without WASM", async () => {
  assert.equal(FIRST_FRAME_TIMEOUT_MS, 3000);
  const target = { gameId: "wizball.asm", trackId: "wiz-title", title: "WIZBALL" };

  // 1. Prewarm finishes before gate activation (Audio Lifecycle notifies at gate).
  {
    const harness = createBrowserHarness();
    try {
      const lifecycle = createAudioLifecycle({
        document: globalThis.document,
        createContext: () => ({ state: "running", resume: () => Promise.resolve() }),
      });
      const doubles = createHandoffDoubles();
      let resolvePrewarm = null;
      const prewarm = new Promise((resolve) => {
        resolvePrewarm = resolve;
      });
      const handoff = createBootHandoff({ audioLifecycle: lifecycle });
      handoff.attachBoot(doubles.boot);
      handoff.attachView(doubles.view);
      handoff.attachPlayer(doubles.player, prewarm);

      assert.deepEqual(doubles.calls, [["view.setRenderingPaused", true]]);

      resolvePrewarm(true);
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(doubles.getReadyCalls(), 1);
      assert.ok(
        !doubles.calls.some(([name]) => name === "view.selectGameAndTrack"),
        "Prewarm before gate must wait for gate before loading track",
      );
      assert.ok(
        !doubles.calls.some(([name]) => name === "player.prepareAudio"),
        "Prewarm before gate must not prepare audio before user gesture",
      );

      globalThis.document.dispatchEvent("pointerdown");
      handoff.handleGate({ target });
      assert.deepEqual(doubles.calls.slice(1), [
        ["boot.setReady"],
        ["player.prepareAudio"],
        ["view.selectGameAndTrack", "wizball.asm", "wiz-title", false],
      ]);

      handoff.handleComplete({ target, autoPlay: true, reason: "gate" });
      assert.deepEqual(doubles.calls.slice(4), [
        ["view.setRenderingPaused", false],
        ["view.setPlaying", true],
      ]);
      handoff.destroy();
      lifecycle.destroy();
    } finally {
      harness.restoreGlobals();
    }
  }

  // 2. Gate activates before player attaches or prewarm finishes.
  {
    const harness = createBrowserHarness();
    try {
      const lifecycle = createAudioLifecycle({
        document: globalThis.document,
        createContext: () => ({ state: "running", resume: () => Promise.resolve() }),
      });
      const doubles = createHandoffDoubles();
      let resolvePrewarm = null;
      const prewarm = new Promise((resolve) => {
        resolvePrewarm = resolve;
      });
      const handoff = createBootHandoff({ audioLifecycle: lifecycle });
      handoff.attachBoot(doubles.boot);
      handoff.attachView(doubles.view);

      // Early gate unlock before player exists.
      globalThis.document.dispatchEvent("pointerdown");
      handoff.handleGate({ target });
      handoff.attachPlayer(doubles.player, prewarm);
      assert.deepEqual(doubles.calls, [["view.setRenderingPaused", true]]);

      resolvePrewarm(true);
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(doubles.calls.slice(1), [
        ["view.selectGameAndTrack", "wizball.asm", "wiz-title", false],
        ["player.prepareAudio"],
        ["boot.setReady"],
      ]);

      handoff.handleComplete({ target, autoPlay: true, reason: "gate" });
      assert.deepEqual(doubles.calls.slice(4), [
        ["view.setRenderingPaused", false],
        ["view.setPlaying", true],
      ]);
      handoff.destroy();
      lifecycle.destroy();
    } finally {
      harness.restoreGlobals();
    }
  }
});

test("Boot Handoff handles skipBoot, reducedMotion, and pendingPlayOnBoot across attachment orders", async () => {
  const target = { gameId: "wizball.asm", trackId: "wiz-title", title: "WIZBALL" };

  // 1. skipBoot with isPendingPlayOnBoot() === false loads paused.
  {
    const doubles = createHandoffDoubles({ pendingPlayOnBoot: false });
    const handoff = createBootHandoff();
    handoff.attachBoot(doubles.boot);
    handoff.handleComplete({ target, autoPlay: false, reason: "skip" });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player, Promise.resolve(true));
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(doubles.calls, [
      ["view.setRenderingPaused", false],
      ["boot.setReady"],
      ["view.selectGameAndTrack", "wizball.asm", "wiz-title", false],
    ]);
    handoff.destroy();
  }

  // 2. reducedMotion with isPendingPlayOnBoot() === true auto-plays once player & prewarm settle.
  {
    const doubles = createHandoffDoubles({ pendingPlayOnBoot: true });
    let resolvePrewarm = null;
    const prewarm = new Promise((resolve) => {
      resolvePrewarm = resolve;
    });
    const handoff = createBootHandoff();
    handoff.attachBoot(doubles.boot);
    handoff.handleComplete({ target, autoPlay: false, reason: "reduced-motion" });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player, prewarm);

    assert.deepEqual(doubles.calls, [["view.setRenderingPaused", false]]);

    resolvePrewarm(true);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(doubles.calls, [
      ["view.setRenderingPaused", false],
      ["boot.setReady"],
      ["view.selectGameAndTrack", "wizball.asm", "wiz-title", true],
    ]);
    handoff.destroy();
  }

  // 3. View attached after player & prewarm settle still resolves pending bootOutcome.
  {
    const doubles = createHandoffDoubles({ pendingPlayOnBoot: false });
    const handoff = createBootHandoff();
    handoff.attachBoot(doubles.boot);
    handoff.attachPlayer(doubles.player, Promise.resolve(true));
    await Promise.resolve();
    await Promise.resolve();
    handoff.handleComplete({ target, autoPlay: true, reason: "skip" });
    handoff.attachView(doubles.view);

    assert.deepEqual(doubles.calls, [
      ["boot.setReady"],
      ["view.setRenderingPaused", false],
      ["view.selectGameAndTrack", "wizball.asm", "wiz-title", true],
    ]);
    handoff.destroy();
  }
});

test("Boot Handoff waitBeforeFade resolves immediately, polls worklet telemetry, falls back on timeout, and cancels cleanly", () => {
  // 1. Immediate ready when frameCount > 0 (renders telemetry before ready, zero timers).
  {
    const clock = createClock();
    const doubles = createHandoffDoubles({
      audioBackend: "worklet",
      telemetry: { frameCount: 4 },
    });
    doubles.player.setAudioContext({ state: "running", audioWorklet: {} });
    const handoff = createBootHandoff({
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
    });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player);

    let readyCalls = 0;
    const cancelWait = handoff.waitBeforeFade(() => {
      doubles.calls.push(["ready"]);
      readyCalls++;
    });
    assert.equal(typeof cancelWait, "function");
    assert.equal(readyCalls, 1);
    assert.equal(clock.activeCount(), 0);
    assert.deepEqual(doubles.calls.slice(1), [["view.renderTelemetry", 4], ["ready"]]);
    handoff.destroy();
  }

  // 2. Immediate ready on in-thread backend (and non-running worklet context), zero timers.
  for (const setup of [
    { audioBackend: "in-thread", ctx: { state: "running", audioWorklet: null } },
    { audioBackend: "worklet", ctx: { state: "suspended", audioWorklet: {} } },
  ]) {
    const clock = createClock();
    const doubles = createHandoffDoubles({
      audioBackend: setup.audioBackend,
      telemetry: { frameCount: 0 },
    });
    doubles.player.setAudioContext(setup.ctx);
    const handoff = createBootHandoff({
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
    });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player);

    let readyCalls = 0;
    handoff.waitBeforeFade(() => {
      readyCalls++;
    });
    assert.equal(readyCalls, 1);
    assert.equal(clock.activeCount(), 0);
    handoff.destroy();
  }

  // 3. Running worklet waits for frameCount > 0, renders telemetry before ready, leaves zero timers.
  {
    const clock = createClock();
    const doubles = createHandoffDoubles({
      audioBackend: "worklet",
      telemetry: { frameCount: 0 },
    });
    doubles.player.setAudioContext({ state: "running", audioWorklet: {} });
    const handoff = createBootHandoff({
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
      pollIntervalMs: 16,
      firstFrameTimeoutMs: 200,
    });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player);

    let readyCalls = 0;
    handoff.waitBeforeFade(() => {
      doubles.calls.push(["ready"]);
      readyCalls++;
    });
    assert.equal(readyCalls, 0);
    assert.equal(clock.activeCount(), 1);

    clock.advance(16);
    assert.equal(readyCalls, 0);
    assert.equal(clock.activeCount(), 1);

    doubles.player.setTelemetry({ frameCount: 9 });
    clock.advance(16);
    assert.equal(readyCalls, 1);
    assert.equal(clock.activeCount(), 0);
    assert.deepEqual(doubles.calls.slice(1), [["view.renderTelemetry", 9], ["ready"]]);
    handoff.destroy();
  }

  // 4. Timeout fallback at firstFrameTimeoutMs renders current telemetry and invokes ready().
  {
    const clock = createClock();
    const doubles = createHandoffDoubles({
      audioBackend: "worklet",
      telemetry: { frameCount: 0 },
    });
    doubles.player.setAudioContext({ state: "running", audioWorklet: {} });
    const handoff = createBootHandoff({
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
      pollIntervalMs: 16,
      firstFrameTimeoutMs: 64,
    });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player);

    let readyCalls = 0;
    handoff.waitBeforeFade(() => {
      doubles.calls.push(["ready"]);
      readyCalls++;
    });
    clock.advance(48);
    assert.equal(readyCalls, 0);

    clock.advance(16);
    assert.equal(readyCalls, 1);
    assert.equal(clock.activeCount(), 0);
    assert.deepEqual(doubles.calls.slice(1), [["view.renderTelemetry", 0], ["ready"]]);
    handoff.destroy();
  }

  // 5. Explicit cancel() handle and destroy() leave zero timers and never invoke ready().
  for (const useDestroy of [false, true]) {
    const clock = createClock();
    const doubles = createHandoffDoubles({
      audioBackend: "worklet",
      telemetry: { frameCount: 0 },
    });
    doubles.player.setAudioContext({ state: "running", audioWorklet: {} });
    const handoff = createBootHandoff({
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
      pollIntervalMs: 16,
      firstFrameTimeoutMs: 100,
    });
    handoff.attachView(doubles.view);
    handoff.attachPlayer(doubles.player);

    let readyCalls = 0;
    const cancelWait = handoff.waitBeforeFade(() => {
      readyCalls++;
    });
    assert.equal(clock.activeCount(), 1);

    if (useDestroy) handoff.destroy();
    else cancelWait();

    assert.equal(clock.activeCount(), 0, "Cancellation must clear the poll timer immediately");
    clock.advance(200);
    assert.equal(readyCalls, 0, "Cancelled waitBeforeFade must never invoke ready()");
    assert.equal(clock.activeCount(), 0);
    handoff.destroy();
  }
});
