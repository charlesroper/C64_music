import assert from "node:assert/strict";
import test from "node:test";
import { BOOT_FADE_MS, BOOT_PHASES, createBootSequence } from "../src/boot_sequence.js";
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
    clock.advance(1000);
    assert.equal(boot.getState().phase, BOOT_PHASES.LOADING);
    clock.advance(1400 + 300);
    assert.equal(boot.getState().phase, BOOT_PHASES.READY);
    assert.equal(tape.stops, 1);
    clock.advance(500);
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
