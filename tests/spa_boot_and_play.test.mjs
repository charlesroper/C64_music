import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeNextVersion } from "../scripts/bump_version.mjs";
import { bootWorkbench } from "../src/app.js";
import { createAudioDiagnosticsOverlay } from "../src/audio_diagnostics.js";
import { resolveAudioMode, resolveLatencyHint, writeStoredAudioMode } from "../src/latency_hint.js";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import { createWorkbenchPlayer } from "../src/player_engine.js";
import { createWorkbenchView } from "../src/workbench_view.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

import { createBrowserHarness, createFakePlayer } from "./helpers/browser_harness.mjs";

function pullAudioFrames(player, blocks = 20, blockSize = 2048) {
  const left = new Float32Array(blockSize);
  const right = new Float32Array(blockSize);
  let peakL = 0;
  let peakR = 0;
  let sumSq = 0;
  let nanCount = 0;

  for (let block = 0; block < blocks; block++) {
    left.fill(0);
    right.fill(0);
    player.pullAudioBlock(left, right);
    for (let i = 0; i < blockSize; i++) {
      if (Number.isNaN(left[i]) || Number.isNaN(right[i])) nanCount++;
      const amplitudeL = Math.abs(left[i]);
      const amplitudeR = Math.abs(right[i]);
      if (amplitudeL > peakL) peakL = amplitudeL;
      if (amplitudeR > peakR) peakR = amplitudeR;
      sumSq += amplitudeL * amplitudeL;
    }
  }

  return { peakL, peakR, rms: Math.sqrt(sumSq / (blocks * blockSize)), nanCount };
}

test("audio mode defaults to interactive and accepts only two hints", () => {
  assert.equal(resolveAudioMode(), "interactive");
  assert.equal(resolveAudioMode({ override: "playback" }), "playback");
  assert.equal(resolveAudioMode({ override: "interactive" }), "interactive");
  assert.equal(resolveAudioMode({ override: "balanced" }), "interactive");
  assert.equal(resolveAudioMode({ override: "0.2" }), "interactive");
  assert.equal(resolveAudioMode({ override: "bogus" }), "interactive");
  assert.equal(resolveLatencyHint("bogus"), "interactive");
});

test("audio mode survives a storage write failure", () => {
  assert.equal(
    writeStoredAudioMode(
      {
        localStorage: {
          setItem() {
            throw new Error("storage unavailable");
          },
        },
      },
      "playback",
    ),
    false,
  );
  assert.equal(writeStoredAudioMode({}, "playback"), false);
  assert.equal(writeStoredAudioMode({ localStorage: {} }, "bogus"), false);
});

test("audio mode load order is URL override, stored choice, default", () => {
  const win = (value) => ({ localStorage: { getItem: () => value } });
  assert.equal(resolveAudioMode({ override: "playback", window: win("interactive") }), "playback");
  assert.equal(
    resolveAudioMode({ override: "interactive", window: win("playback") }),
    "interactive",
  );
  assert.equal(resolveAudioMode({ override: "bogus", window: win("playback") }), "playback");
  assert.equal(resolveAudioMode({ window: win("playback") }), "playback");
  assert.equal(resolveAudioMode({ window: win("interactive") }), "interactive");
  assert.equal(resolveAudioMode({ window: win("broken") }), "interactive");
  assert.equal(
    resolveAudioMode({
      window: {
        get localStorage() {
          throw new Error("storage unavailable");
        },
      },
    }),
    "interactive",
  );
});

test("unified browser harness enforces strict element IDs and shares environment between UI tests", () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 48000,
    viewport: { width: 375, height: 812 },
  });
  try {
    // 1. Existing element lookup succeeds
    const playBtn = globalThis.document.getElementById("btn-play");
    assert.ok(playBtn, "Expected #btn-play in document");
    assert.equal(playBtn.tagName, "BUTTON");

    // 2. Missing element ID throws with the id name (preventing silent test fakes)
    assert.throws(
      () => globalThis.document.getElementById("missing-element-xyz"),
      /Element with id "missing-element-xyz" not found in document/,
      "Looking up an unindexed element ID must throw with the id name",
    );

    // 3. Dynamic element registration on id assignment or DOM append
    const dynamicDiv = globalThis.document.createElement("div");
    dynamicDiv.id = "dynamic-created-row";
    assert.equal(
      globalThis.document.getElementById("dynamic-created-row"),
      dynamicDiv,
      "Dynamically assigned id must be registered in the harness",
    );

    // 4. Query selectors match classes, attributes and compounds
    const chips = globalThis.document.querySelectorAll(".legend-chip");
    assert.ok(chips.length >= 4, "Expected legend chips");
    const v1Chip = globalThis.document.querySelector('.legend-chip[data-voice="1"]');
    assert.ok(v1Chip, "Expected Voice 2 legend chip");
  } finally {
    harness.restoreGlobals();
  }
});

test("booting index.html + app.js and clicking PLAY generates non-silent stereo audio on mobile/WebKit AudioContext", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 44100,
    rejectSampleRateOption: true,
  });

  try {
    const { player } = await bootWorkbench({ skipBoot: true });
    harness.stepAnimationFrame();

    // Simulate user tapping PLAY on mobile Safari (44.1 kHz hardware, sampleRate option rejected)
    harness.elementsById.get("btn-play").click();

    assert.equal(harness.audioState.audioSession.type, "playback");
    assert.equal(harness.elementsById.get("play-label").textContent, "PAUSE");
    assert.equal(player.getState().audioBackend, "in-thread");

    const stats = pullAudioFrames(player, 24);
    assert.equal(stats.nanCount, 0);
    assert.ok(stats.peakL > 0.1, `Expected left channel peak > 0.1, got ${stats.peakL}`);
    assert.ok(stats.peakR > 0.1, `Expected right channel peak > 0.1, got ${stats.peakR}`);
    assert.ok(stats.rms > 0.02, `Expected RMS > 0.02, got ${stats.rms}`);
  } finally {
    harness.restoreGlobals();
  }
});

test("SID, audio mode and telemetry switches apply options", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  try {
    const player = createFakePlayer();
    const view = createWorkbenchView({
      document: globalThis.document,
      elements: harness.elementsById,
      player,
    });
    view.selectGameAndTrack("wizball.asm", "wiz-title", false);

    assert.equal(
      harness.elementsById.get("select-sid-model"),
      undefined,
      "SID chip must no longer use a dropdown",
    );
    assert.equal(
      harness.elementsById.get("chk-video-ntsc"),
      undefined,
      "The PAL/NTSC switch must be removed from the interface",
    );

    const sidToggle = harness.elementsById.get("chk-sid-8580");
    sidToggle.checked = true;
    sidToggle.dispatchEvent("change");
    assert.equal(player.getState().sidModel8580, true);
    assert.equal(harness.elementsById.get("sid-model-value").textContent, "8580");

    const latencyToggle = harness.elementsById.get("chk-latency-interactive");
    assert.equal(latencyToggle.checked, true, "Interactive must be the default");
    latencyToggle.checked = false;
    latencyToggle.dispatchEvent("change");
    assert.equal(player.getState().latencyHint, "playback");
    assert.equal(harness.elementsById.get("latency-mode-value").textContent, "PLAYBACK");
    assert.equal(
      harness.localStorage.getItem("galway2664.audioMode.v1"),
      "playback",
      "Changing Audio Mode must store the choice",
    );

    latencyToggle.checked = true;
    latencyToggle.dispatchEvent("change");
    assert.equal(player.getState().latencyHint, "interactive");
    assert.equal(harness.elementsById.get("latency-mode-value").textContent, "INTERACTIVE");
    assert.equal(harness.localStorage.getItem("galway2664.audioMode.v1"), "interactive");

    const telemetryToggle = harness.elementsById.get("chk-telemetry-high");
    assert.equal(telemetryToggle.checked, true, "62.5Hz must be the checked default");
    telemetryToggle.checked = false;
    telemetryToggle.dispatchEvent("change");
    assert.equal(player.getState().telemetryHz, 30);
    assert.equal(harness.elementsById.get("telemetry-rate-value").textContent, "30Hz");

    telemetryToggle.checked = true;
    telemetryToggle.dispatchEvent("change");
    assert.equal(player.getState().telemetryHz, 62.5);
    assert.equal(harness.elementsById.get("telemetry-rate-value").textContent, "62.5Hz");
  } finally {
    harness.restoreGlobals();
  }
});

test("SID and Audio Mode explainers are visible hardware copy", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  try {
    const player = createFakePlayer();
    const view = createWorkbenchView({
      document: globalThis.document,
      elements: harness.elementsById,
      player,
    });

    const sidHint = harness.elementsById.get("sid-model-hint");
    assert.match(sidHint.textContent, /6581/);
    assert.match(sidHint.textContent, /8580/);
    assert.match(sidHint.textContent, /1982/);
    assert.match(sidHint.textContent, /1987/);

    const audioHint = harness.elementsById.get("latency-mode-hint");
    assert.match(audioHint.textContent, /[Pp]layback/);
    assert.match(audioHint.textContent, /[Ii]nteractive/);
    assert.match(audioHint.textContent, /pop/);
    assert.match(audioHint.textContent, /Firefox/);

    view.destroy();
  } finally {
    harness.restoreGlobals();
  }
});

test("Workbench View defaults telemetry to 62.5Hz and accepts 30Hz", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  try {
    const player = createFakePlayer();
    const view = createWorkbenchView({
      document: globalThis.document,
      elements: harness.elementsById,
      player,
    });
    assert.equal(harness.elementsById.get("telemetry-rate-value").textContent, "62.5Hz");
    assert.equal(harness.elementsById.get("chk-telemetry-high").checked, true);
    assert.equal(
      harness.elementsById.get("hw-group-telemetry").hidden,
      true,
      "The Telemetry group must be hidden from the interface",
    );

    const lowRatePlayer = createFakePlayer();
    const lowRateView = createWorkbenchView({
      document: globalThis.document,
      elements: harness.elementsById,
      player: lowRatePlayer,
      telemetryHz: 30,
    });
    assert.equal(harness.elementsById.get("telemetry-rate-value").textContent, "30Hz");
    assert.equal(harness.elementsById.get("chk-telemetry-high").checked, false);
    assert.equal(lowRatePlayer.getState().telemetryHz, 30);

    lowRateView.destroy();
    view.destroy();
  } finally {
    harness.restoreGlobals();
  }
});

test("Stats defaults to 62.5Hz when diagnostics omit the rate", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: { getAudioDiagnostics: () => ({}) },
    window: globalThis.window,
  });
  try {
    const value = globalThis.document.querySelector('[data-metric="context:telemetry"]');
    assert.ok(value, "Stats must have a telemetry rate value");
    assert.equal(value.textContent, "62.5Hz");
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("Stats shows OFF when telemetry snapshots are disabled", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: {
      getAudioDiagnostics: () => ({ telemetryHz: 62.5, telemetryEnabled: false }),
    },
    window: globalThis.window,
  });
  try {
    const value = globalThis.document.querySelector('[data-metric="context:telemetry"]');
    assert.equal(value.textContent, "OFF");
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("Stats shows the interactive audio mode", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: { getAudioDiagnostics: () => ({ latencyHint: "interactive" }) },
    window: globalThis.window,
  });
  try {
    const value = globalThis.document.querySelector('[data-metric="latency:mode"]');
    assert.equal(value.textContent, "interactive");
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("Stats groups metrics and keeps each label with its value", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: {
      getAudioDiagnostics: () => ({
        backend: "worklet",
        contextState: "running",
        sampleRate: 48000,
        telemetryHz: 62.5,
        latencyHint: "playback",
        baseLatency: 0.0027,
        outputLatency: 0.01,
        processCalls: 375,
        p50Us: 30,
        p95Us: 1020,
        p99Us: 1020,
        maxUs: 1000,
        processPeakUs: 16000,
        budgetUs: 2666.67,
        renderAudioMaxUs: 900,
        renderAudioPeakUs: 14000,
        packTelemetryMaxUs: 100,
        packTelemetryPeakUs: 2000,
        postMessageMaxUs: 20,
        postMessagePeakUs: 300,
        applyGainMaxUs: 5,
        applyGainPeakUs: 50,
        lateQuanta: 64,
        lateWindow: 2,
        latePeakWindow: 6,
        missedQuanta: 1,
        missedWindow: 1,
        missedPeakWindow: 3,
        telemetryDrops: 10,
        telemetryDropWindow: 2,
        telemetryDropPeakWindow: 4,
        gain: 1,
        playing: true,
        contextEvents: [{ state: "running" }],
      }),
    },
    window: globalThis.window,
    getFrameDiagnostics: () => ({
      frameCalls: 60,
      frameP50Ms: 1.25,
      frameP95Ms: 4.5,
      frameMaxMs: 8,
      framePeakMs: 16,
    }),
  });

  try {
    const groups = globalThis.document.querySelectorAll(".diag-group");
    assert.equal(groups.length, 6, "Stats must render six metric groups");
    for (const id of ["context", "latency", "process", "deadlines", "telemetry", "events"]) {
      assert.ok(
        globalThis.document.querySelector(`.diag-group--${id}`),
        `Stats must render the ${id} group`,
      );
    }
    assert.equal(
      globalThis.document.querySelectorAll(".diag-group-description").length,
      6,
      "Every group must have a help description",
    );
    for (const description of globalThis.document.querySelectorAll(".diag-group-description")) {
      assert.ok(description.textContent.length > 0, "Every group description must have text");
    }
    assert.match(
      globalThis.document.querySelector(".diag-help-intro").textContent,
      /window is about one second/i,
    );

    const value = (metric) =>
      globalThis.document.querySelector(`[data-metric="${metric}"]`)?.textContent;
    assert.equal(value("context:telemetry"), "62.5Hz");
    assert.equal(value("process:peak"), "16.00");
    assert.equal(value("process:renderPeak"), "14.00");
    assert.equal(value("process:packPeak"), "2.00");
    assert.equal(value("process:postPeak"), "0.30");
    assert.equal(value("process:gainPeak"), "0.05");
    assert.equal(value("process:framePeak"), "16.00");
    assert.equal(value("process:frameCalls"), "60");
    assert.equal(value("deadlines:latePeak"), "6");
    assert.equal(value("deadlines:missedPeak"), "3");
    assert.equal(value("telemetry:dropsPeak"), "4");
    assert.equal(value("telemetry:volume"), "1.00");

    for (const item of globalThis.document.querySelectorAll(".diag-item")) {
      assert.equal(item.children.length, 3, "Each metric must have label, value and help");
      assert.equal(item.children[0].className, "diag-label");
      assert.equal(item.children[1].className, "diag-value");
      assert.equal(item.children[2].className, "diag-help");
      assert.ok(item.children[2].textContent.length > 0, "Every metric needs a help description");
    }
    assert.equal(
      globalThis.document.querySelectorAll(".diag-help").length,
      38,
      "All 38 metrics must have help text",
    );
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("Stats colour-codes values by health", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: {
      getAudioDiagnostics: () => ({
        backend: "worklet",
        contextState: "running",
        outputLatency: 0.0128,
        processCalls: 375,
        p50Us: 30,
        p95Us: 1020,
        p99Us: 1600,
        maxUs: 3000,
        processPeakUs: 37000,
        packTelemetryMaxUs: 100,
        packTelemetryPeakUs: 2000,
        postMessageMaxUs: 20,
        postMessagePeakUs: 37000,
        applyGainMaxUs: 5,
        applyGainPeakUs: 50,
        lateWindow: 2,
        latePeakWindow: 11,
        missedWindow: 0,
        missedPeakWindow: 0,
        telemetryDropWindow: 0,
        telemetryDropPeakWindow: 13,
      }),
    },
    window: globalThis.window,
    getFrameDiagnostics: () => ({
      frameP50Ms: 4,
      frameP95Ms: 17,
      frameMaxMs: 59,
      framePeakMs: 92,
    }),
  });

  try {
    const health = (metric) =>
      globalThis.document.querySelector(`[data-metric="${metric}"]`)?.dataset.health;

    assert.equal(health("context:backend"), "normal");
    assert.equal(health("context:ctx"), "normal");
    assert.equal(health("latency:out"), "bad", "12.8ms output buffer is bad");
    assert.equal(health("process:p50"), "normal");
    assert.equal(health("process:p95"), "pressure", "1.02ms is under pressure");
    assert.equal(health("process:p99"), "pressure", "1.60ms is under pressure");
    assert.equal(health("process:max"), "pressure", "3ms is under pressure");
    assert.equal(health("process:peak"), "bad", "37ms peak is bad");
    assert.equal(health("process:packPeak"), "pressure");
    assert.equal(health("process:postPeak"), "bad");
    assert.equal(health("process:gainPeak"), "normal");
    assert.equal(health("process:frameP50"), "pressure");
    assert.equal(health("process:frameP95"), "bad");
    assert.equal(health("process:frameMax"), "bad");
    assert.equal(health("process:framePeak"), "bad");
    assert.equal(health("deadlines:lateWindow"), "pressure");
    assert.equal(health("deadlines:latePeak"), "bad");
    assert.equal(health("deadlines:missedWindow"), "normal");
    assert.equal(health("telemetry:dropsWindow"), "normal");
    assert.equal(health("telemetry:dropsPeak"), "bad");
    assert.equal(health("process:budget"), undefined, "Unlisted values stay neutral");
    assert.equal(health("process:renderPeak"), undefined, "Unlisted values stay neutral");
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("Stats help mode includes a health legend", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: { getAudioDiagnostics: () => ({}) },
    window: globalThis.window,
  });

  try {
    const legend = globalThis.document.querySelector(".diag-health-legend");
    assert.ok(legend, "Stats must include a health legend");
    const items = globalThis.document.querySelectorAll(".diag-health-legend-item");
    assert.equal(items.length, 3, "Legend must list three health states");
    assert.deepEqual(
      items.map((item) => item.textContent),
      ["normal", "under pressure", "bad"],
    );
    assert.deepEqual(
      items.map((item) => item.dataset.health),
      ["normal", "pressure", "bad"],
    );
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("Stats help mode expands descriptions and closes back to compact", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const overlay = createAudioDiagnosticsOverlay({
    document: globalThis.document,
    player: { getAudioDiagnostics: () => ({}) },
    window: globalThis.window,
  });

  try {
    const button = globalThis.document.querySelector(".diag-help-toggle");
    assert.ok(button, "Stats must have a help toggle");
    assert.equal(button.textContent, "?");
    assert.equal(button.getAttribute("aria-label"), "Explain stats");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.ok(!overlay.element.classList.contains("is-help"));

    button.click();
    assert.ok(overlay.element.classList.contains("is-help"));
    assert.equal(button.getAttribute("aria-label"), "Close stats explanation");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(button.textContent, "×");

    overlay.element.scrollTop = 480;
    button.click();
    assert.ok(!overlay.element.classList.contains("is-help"));
    assert.equal(button.getAttribute("aria-expanded"), "false");

    button.click();
    assert.equal(overlay.element.scrollTop, 0, "Reopening help must return to the introduction");
    assert.ok(overlay.element.classList.contains("is-help"));

    overlay.hide();
    assert.ok(!overlay.element.classList.contains("is-help"));
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.ok(overlay.element.classList.contains("hidden"));

    overlay.show();
    assert.ok(!overlay.element.classList.contains("is-help"));
    button.click();
    assert.ok(overlay.element.classList.contains("is-help"));
    button.click();
    assert.ok(!overlay.element.classList.contains("is-help"));
    assert.equal(button.textContent, "?");
  } finally {
    overlay.stop();
    harness.restoreGlobals();
  }
});

test("boot sequence hides the workbench and hands off to a playing Wizball", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 48000 });
  try {
    const booted = await bootWorkbench();
    assert.equal(globalThis.document.body.dataset.bootState, "booting");
    assert.ok(
      !harness.elementsById.get("boot-sequence").classList.contains("hidden"),
      "Boot overlay must be visible",
    );
    assert.ok(!booted.boot.getState().completed, "Boot must still be running");
    assert.doesNotMatch(
      harness.elementsById.get("now-playing-pill").textContent,
      /Wizball/,
      "Track must not be selected before the boot completes",
    );

    booted.boot.skip();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(globalThis.document.body.dataset.bootState, undefined);
    assert.ok(
      harness.elementsById.get("boot-sequence").classList.contains("hidden"),
      "Boot overlay must hide after handoff",
    );
    assert.match(
      harness.elementsById.get("now-playing-pill").textContent,
      /Wizball/,
      "Wizball must be selected at handoff",
    );
    assert.equal(booted.player.getState().isPlaying, true);
  } finally {
    harness.restoreGlobals();
  }
});

test("Stats for Nerds button toggles the audio diagnostics overlay", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 48000 });
  let diagnostics = null;
  try {
    const booted = await bootWorkbench({ skipBoot: true });
    diagnostics = booted.diagnostics;
    const btnStats = harness.elementsById.get("btn-stats-nerds");

    assert.ok(diagnostics, "Audio diagnostics overlay must exist");
    assert.ok(
      diagnostics.element.classList.contains("hidden"),
      "Overlay must start hidden without ?audioDebug=1",
    );
    assert.ok(!btnStats.classList.contains("active"), "Stats button must start inactive");

    btnStats.click();
    assert.ok(!diagnostics.element.classList.contains("hidden"));
    assert.ok(btnStats.classList.contains("active"));

    btnStats.click();
    assert.ok(diagnostics.element.classList.contains("hidden"));
    assert.ok(!btnStats.classList.contains("active"));
  } finally {
    diagnostics?.stop();
    harness.restoreGlobals();
  }
});

test("?telemetry=30 boots the workbench at 30Hz", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 48000 });
  try {
    globalThis.window.location = { search: "?telemetry=30" };
    const booted = await bootWorkbench({ skipBoot: true });

    assert.equal(booted.player.getAudioDiagnostics().telemetryHz, 30);
    assert.equal(harness.elementsById.get("telemetry-rate-value").textContent, "30Hz");
    assert.equal(harness.elementsById.get("chk-telemetry-high").checked, false);
  } finally {
    harness.restoreGlobals();
  }
});

test("?telemetry=off boots with snapshots disabled and locked", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 48000 });
  try {
    globalThis.window.location = { search: "?telemetry=off" };
    const booted = await bootWorkbench({ skipBoot: true });

    assert.equal(booted.player.getState().telemetryEnabled, false);
    assert.equal(booted.player.getState().telemetryLockedOff, true);
    assert.equal(booted.player.getAudioDiagnostics().telemetryEnabled, false);
    assert.equal(
      booted.player.setTelemetryEnabled(true),
      false,
      "The capture override must not be re-enabled",
    );
    assert.equal(booted.player.getState().telemetryEnabled, false);
    assert.equal(booted.player.getAudioDiagnostics().telemetryHz, 62.5);
  } finally {
    harness.restoreGlobals();
  }
});

test("audio mode boots interactive by default and reaches the AudioContext", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 48000 });
  try {
    globalThis.window.location = { search: "" };
    const booted = await bootWorkbench({ skipBoot: true });
    booted.player.prepareAudio();

    assert.equal(booted.player.getState().latencyHint, "interactive");
    assert.equal(booted.player.getAudioDiagnostics().latencyHint, "interactive");
    assert.equal(harness.audioState.ctx.latencyHint, "interactive");
    assert.equal(harness.elementsById.get("latency-mode-value").textContent, "INTERACTIVE");
    assert.equal(harness.elementsById.get("chk-latency-interactive").checked, true);
  } finally {
    harness.restoreGlobals();
  }
});

test("stored playback audio mode boots without a URL override", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 48000,
    localStorage: { "galway2664.audioMode.v1": "playback" },
  });
  try {
    globalThis.window.location = { search: "" };
    const booted = await bootWorkbench({ skipBoot: true });
    booted.player.prepareAudio();

    assert.equal(booted.player.getState().latencyHint, "playback");
    assert.equal(harness.audioState.ctx.latencyHint, "playback");
    assert.equal(harness.elementsById.get("latency-mode-value").textContent, "PLAYBACK");
    assert.equal(harness.elementsById.get("chk-latency-interactive").checked, false);
  } finally {
    harness.restoreGlobals();
  }
});

test("?latency=interactive overrides stored playback without saving", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 48000,
    localStorage: { "galway2664.audioMode.v1": "playback" },
  });
  try {
    globalThis.window.location = { search: "?latency=interactive" };
    const booted = await bootWorkbench({ skipBoot: true });
    booted.player.prepareAudio();

    assert.equal(booted.player.getState().latencyHint, "interactive");
    assert.equal(harness.audioState.ctx.latencyHint, "interactive");
    assert.equal(harness.elementsById.get("chk-latency-interactive").checked, true);
    assert.equal(
      harness.localStorage.getItem("galway2664.audioMode.v1"),
      "playback",
      "A URL override must not overwrite the stored choice",
    );
  } finally {
    harness.restoreGlobals();
  }
});

test("?latency=playback overrides stored interactive for one load", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 48000,
    localStorage: { "galway2664.audioMode.v1": "interactive" },
  });
  try {
    globalThis.window.location = { search: "?latency=playback" };
    const booted = await bootWorkbench({ skipBoot: true });

    assert.equal(booted.player.getState().latencyHint, "playback");
    assert.equal(harness.localStorage.getItem("galway2664.audioMode.v1"), "interactive");
  } finally {
    harness.restoreGlobals();
  }
});

test("?render=minimal boots with the minimal render class and paused loop", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 48000 });
  try {
    globalThis.window.location = { search: "?render=minimal" };
    const booted = await bootWorkbench({ skipBoot: true });

    assert.ok(globalThis.document.body.classList.contains("render-minimal"));

    for (const timestamp of [2000, 2016, 2033, 2050, 2066, 2083, 2100]) {
      harness.stepAnimationFrame(timestamp);
    }
    assert.equal(
      booted.view.getFrameDiagnostics().frameCalls,
      0,
      "The boot handoff must not resume the loop in minimal render mode",
    );
  } finally {
    harness.restoreGlobals();
  }
});

test("tapping PLAY on mobile while WASM/.asm assets are still downloading unlocks AudioContext inside the tap gesture and starts audio when ready", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 48000,
    rejectSampleRateOption: false,
  });

  try {
    // Delay fetch by 80ms to simulate mobile network latency
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      await new Promise((r) => setTimeout(r, 80));
      return origFetch(url);
    };

    const bootPromise = bootWorkbench({ skipBoot: true });
    // Wait 10ms so setupUIHandlers() has run, but fetches have NOT completed yet
    await new Promise((r) => setTimeout(r, 10));

    // User taps PLAY while assets are still loading
    harness.elementsById.get("btn-play").click();

    // AudioContext MUST be created & resumed synchronously during the user tap gesture (iOS requirement)
    assert.ok(
      harness.audioState.ctx,
      "AudioContext must be created synchronously during early tap",
    );
    assert.equal(
      harness.audioState.ctx.state,
      "running",
      "AudioContext must resume during gesture",
    );

    // Wait for fetches + WASM assembly to complete
    const { player } = await bootPromise;
    const deadline = Date.now() + 5000;
    while (
      harness.elementsById.get("play-label").textContent === "LOADING..." &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.equal(harness.elementsById.get("play-label").textContent, "PAUSE");
    const stats = pullAudioFrames(player, 16);
    assert.ok(stats.peakL > 0.1, `Expected audio after delayed load, got peak=${stats.peakL}`);
  } finally {
    harness.restoreGlobals();
  }
});

test("CalVer version number appears immediately after the title of the app", async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  // Brand title contains Galway 2664 logo with accessible text and brand-version badge
  const match = html.match(/<div class="brand-title">([\s\S]*?)<\/div>/);
  assert.ok(match, "index.html must contain brand-title");

  const titleContent = match[1];
  assert.match(
    titleContent,
    /<span[^>]*class="brand-logo"[^>]*role="(?:img|button)"[^>]*aria-label="Galway 2664"[\s\S]*?<span class="sr-only">Galway 2664<\/span>[\s\S]*?<\/span>[\s\S]*?<span class="brand-accent">\/\/ OCEAN 6502-SID WORKBENCH<\/span>[\s\S]*?<span class="brand-version" id="app-version">v([0-9]{4}\.[0-9]{2}\.[0-9]{2}(?:\.[0-9]+)?)<\/span>/,
    "Version badge must be placed immediately after the app title",
  );

  const calver = titleContent.match(/id="app-version">v([^<]+)<\/span>/)[1];
  assert.equal(pkg.version, calver, "package.json version must match CalVer in index.html");

  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const { APP_VERSION } = await import("../src/version.js");
  assert.equal(APP_VERSION, calver, "src/version.js APP_VERSION must match CalVer in index.html");
  assert.equal(lock.version, calver, "package-lock.json version must match CalVer in index.html");
  assert.equal(
    lock.packages[""].version,
    calver,
    "package-lock.json root package version must match CalVer in index.html",
  );

  // Title tag also includes Galway 2664 and the version
  assert.match(html, new RegExp(`<title>Galway 2664[^<]*v${calver}[^<]*<\\/title>`));

  // scripts/bump_version.mjs calculation logic
  const mockDate = new Date("2026-10-30T12:00:00Z");
  assert.equal(computeNextVersion("2026.10.29", mockDate), "2026.10.30");
  assert.equal(computeNextVersion("2026.10.30", mockDate), "2026.10.30.1");
  assert.equal(computeNextVersion("2026.10.30.1", mockDate), "2026.10.30.2");
  assert.equal(computeNextVersion("2026.10.30.2", mockDate), "2026.10.30.3");
  assert.equal(computeNextVersion("2026.10.30.3", mockDate), "2026.10.30.4");
  assert.equal(computeNextVersion("2026.10.30.4", mockDate), "2026.10.30.5");

  // Verify Galway 2664 C64 logo generator defaults to pure white and uses authentic character ROM
  const {
    getGalway2664LogoSvg,
    generateC64TextSvg,
    C64_RAINBOW_PALETTE,
    C64_SPARKLE_PALETTE,
    VIC_PALETTE,
  } = await import("../src/c64_charset.js");
  const svg = getGalway2664LogoSvg();
  assert.ok(
    svg.includes('aria-label="Galway 2664"'),
    "Logo SVG must contain accessible aria-label",
  );
  assert.ok(svg.includes("<title>Galway 2664</title>"), "Logo SVG must contain accessible title");
  assert.ok(svg.includes('shape-rendering="crispEdges"'), "Logo SVG must specify crispEdges");
  assert.ok(
    svg.includes(`fill="${VIC_PALETTE[1]}"`),
    "Logo SVG must default to authentic VIC White (#FFFFFF)",
  );

  // Rainbow palette is preserved for custom color runs
  const rainbowSvg = generateC64TextSvg("GALWAY 64", { colors: C64_RAINBOW_PALETTE });
  assert.ok(
    rainbowSvg.includes(`fill="${VIC_PALETTE[10]}"`),
    "Custom rainbow logo must support Light Red",
  );
  assert.equal(C64_RAINBOW_PALETTE.length, 8, "C64 rainbow palette must have 8 authentic colors");

  // Verify sparkle reflection palette and CSS rules
  assert.ok(C64_SPARKLE_PALETTE.includes(VIC_PALETTE[3]), "Sparkle palette must include Cyan");
  assert.ok(C64_SPARKLE_PALETTE.includes(VIC_PALETTE[7]), "Sparkle palette must include Yellow");
  assert.ok(C64_SPARKLE_PALETTE.includes(VIC_PALETTE[1]), "Sparkle palette must include White");

  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.ok(
    css.includes("@keyframes c64-sparkle-sweep"),
    "CSS must contain c64-sparkle-sweep keyframes",
  );
  assert.ok(
    css.includes(".brand-logo.sparkle-active"),
    "CSS must contain sparkle-active class selector",
  );
});

test("source editor surfaces assembly errors, preserves edits on syntax failure, and protects dirty edits on track change", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });
  view.selectGameAndTrack("wizball.asm", "wiz-title", false);

  try {
    const btnToggle = harness.elementsById.get("btn-toggle-edit");
    const btnReassemble = harness.elementsById.get("btn-reassemble");
    const editorEl = harness.elementsById.get("source-editor");
    const badge = harness.elementsById.get("asm-compile-badge");

    // Open editor
    btnToggle.click();
    const originalSource = editorEl.value;
    assert.ok(originalSource.length > 0, "Editor should have original source");

    // 1. Submit broken source
    editorEl.value = "SYNTAX_ERROR_UNKNOWN_OPCODE ???";
    btnReassemble.click();

    // Badge should show error, editor should stay open, text preserved
    assert.match(badge.textContent, /ERROR/i);
    assert.equal(editorEl.value, "SYNTAX_ERROR_UNKNOWN_OPCODE ???");
    assert.ok(!editorEl.classList.contains("hidden"), "Editor should stay open on error");

    // 2. Submit valid edit
    const validEdit = `; Valid hot reload test\n${originalSource}`;
    editorEl.value = validEdit;
    btnReassemble.click();

    assert.equal(badge.textContent, "HOT-RELOADED OK");
    assert.ok(editorEl.classList.contains("hidden"), "Editor should close on success");

    // 3. Type edit, switch track, verify no silent data loss
    btnToggle.click();
    editorEl.value = "; My unsaved modification";
    editorEl.dispatchEvent("input");

    // Switch track via track list
    const trackList = harness.elementsById.get("track-list");
    const secondTrack = trackList.children[1];
    if (secondTrack) {
      secondTrack.click();
    }
    assert.equal(
      editorEl.value,
      "; My unsaved modification",
      "Unsaved editor edits must not be wiped on track switch",
    );
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("global keyboard shortcuts ignore Space and letter keys while modal is open, and preserve native button activation", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });
  view.selectGameAndTrack("wizball.asm", "wiz-title", false);

  try {
    const playLabel = harness.elementsById.get("play-label");
    assert.equal(playLabel.textContent, "PLAY");

    // 1. Open narrative modal
    const btnNarrative = harness.elementsById.get("btn-narrative-modal");
    const narrativeModal = harness.elementsById.get("narrative-modal");
    btnNarrative.click();
    assert.ok(!narrativeModal.classList.contains("hidden"), "Modal must be open");

    // Press Space while modal is open
    let spacePrevented = false;
    globalThis.window.dispatchEvent("keydown", {
      code: "Space",
      key: " ",
      preventDefault: () => {
        spacePrevented = true;
      },
    });

    // Playback must NOT start
    assert.equal(
      playLabel.textContent,
      "PLAY",
      "Space while modal is open must not toggle playback",
    );
    assert.equal(spacePrevented, false, "Space while modal is open must not preventDefault");

    // Press a letter key while modal is open
    globalThis.window.dispatchEvent("keydown", {
      code: "KeyW",
      key: "w",
      preventDefault: () => {},
    });
    assert.equal(
      playLabel.textContent,
      "PLAY",
      "Letter key while modal is open must not start playback",
    );

    // Close modal
    const btnClose = harness.elementsById.get("btn-close-narrative-modal");
    btnClose.click();
    assert.ok(narrativeModal.classList.contains("hidden"), "Modal must be closed");

    // 2. Focused button receives Space without global shortcut stealing it
    const btnPlay = harness.elementsById.get("btn-play");
    globalThis.document.activeElement = btnPlay;
    let btnSpacePrevented = false;
    globalThis.window.dispatchEvent("keydown", {
      code: "Space",
      key: " ",
      preventDefault: () => {
        btnSpacePrevented = true;
      },
    });
    assert.equal(
      btnSpacePrevented,
      false,
      "Space on focused button must not be prevented by global shortcut",
    );
    assert.equal(playLabel.textContent, "PLAY");

    // 3. Focus on body (no active element): global shortcut works
    globalThis.document.activeElement = null;
    globalThis.window.dispatchEvent("keydown", {
      code: "Space",
      key: " ",
      preventDefault: () => {},
    });
    assert.equal(playLabel.textContent, "PAUSE", "Space on page body toggles playback");
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("DRM chip is track-aware, drum PC reads through seqPC symbol, and unchecking follow stays off across track switches", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });
  view.selectGameAndTrack("wizball.asm", "wiz-title", false);

  try {
    const drmChip = globalThis.document.querySelector('.legend-chip[data-voice="seq"]');
    assert.ok(drmChip, "DRM chip should exist");

    // On boot (wizball.asm): hasDrums is false, DRM chip disabled
    assert.ok(drmChip.classList.contains("disabled"), "Wizball should disable DRM chip");

    // 1. Select gameover.asm
    const gameList = harness.elementsById.get("game-list");
    const gameOverItem = gameList.children.find((c) => c.innerHTML?.includes("gameover.asm"));
    assert.ok(gameOverItem, "gameover item in game-list");
    gameOverItem.click();

    // First track is go-title-full: withDrums is true, DRM chip must be ENABLED
    assert.ok(!drmChip.classList.contains("disabled"), "go-title-full should enable DRM chip");

    // Switch to a gameover SFX track without drums (e.g. go-sfx-laser)
    const trackList = harness.elementsById.get("track-list");
    const sfxTrack = trackList.children.find((c) => c.innerHTML?.includes("Player Laser"));
    assert.ok(sfxTrack, "SFX Player Laser track in track-list");
    sfxTrack.click();

    // DRM chip must be DISABLED for SFX track
    assert.ok(drmChip.classList.contains("disabled"), "Game Over SFX track must disable DRM chip");

    // Switch back to go-title-full
    const fullTrack = trackList.children.find((c) => c.innerHTML?.includes("Title Screen (Full"));
    assert.ok(fullTrack, "Title Screen (Full) in track-list");
    fullTrack.click();
    assert.ok(!drmChip.classList.contains("disabled"), "go-title-full re-enables DRM chip");

    // 2. Uncheck follow, switch songs, follow stays off
    const chkFollow = harness.elementsById.get("chk-follow-pc");
    chkFollow.checked = false;
    chkFollow.dispatchEvent("change");

    // Switch song
    sfxTrack.click();
    assert.equal(
      chkFollow.checked,
      false,
      "Follow checkbox must stay unchecked after track switch",
    );

    // 3. Drum PC readout reads through seqPC symbol
    fullTrack.click();
    view.renderTelemetry(player.getTelemetry());
    const telSeq = harness.elementsById.get("seq-pc");
    assert.ok(telSeq.textContent.startsWith("DRUM: $"), "Drum PC readout should format address");
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("source viewer address gutter hides sentinel values and shows $0000 for address zero", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });
  view.selectGameAndTrack("wizball.asm", "wiz-title", false);

  try {
    // Wizball on boot has blank lines and comments
    const viewer = harness.elementsById.get("source-viewer");
    assert.ok(viewer.children.length > 0, "Source viewer should have rows");

    // Check that no row in wizball contains '$00-1'
    const badRows = viewer.children.filter((r) => r.innerHTML?.includes("$00-1"));
    assert.equal(badRows.length, 0, `Expected 0 rows with $00-1, found ${badRows.length}`);

    // Now hot-reload a snippet containing ORG, EQU, comment, blank, address 0, and code row
    const btnToggle = harness.elementsById.get("btn-toggle-edit");
    const btnReassemble = harness.elementsById.get("btn-reassemble");
    const editorEl = harness.elementsById.get("source-editor");

    const testSource = [
      "; Comment line",
      "",
      "SOME_VAL EQU 42",
      " ORG $0000",
      " NOP",
      " ORG $1000",
      " LDA #1",
    ].join("\n");

    btnToggle.click();
    editorEl.value = testSource;
    btnReassemble.click();

    const row1 = viewer.children[0];
    const row2 = viewer.children[1];
    const row3 = viewer.children[2];
    const row4 = viewer.children[3];
    const row5 = viewer.children[4];
    const row6 = viewer.children[5];
    const row7 = viewer.children[6];

    assert.match(row1.innerHTML, /<span class="ln-addr"><\/span>/);
    assert.match(row2.innerHTML, /<span class="ln-addr"><\/span>/);
    assert.match(row3.innerHTML, /<span class="ln-addr"><\/span>/);
    assert.match(row4.innerHTML, /<span class="ln-addr"><\/span>/);
    assert.match(row5.innerHTML, /<span class="ln-addr">\$0000<\/span>/);
    assert.match(row6.innerHTML, /<span class="ln-addr"><\/span>/);
    assert.match(row7.innerHTML, /<span class="ln-addr">\$1000<\/span>/);
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("symbol jump and source search use the on-screen file instead of activeGameId", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });
  view.selectGameAndTrack("wizball.asm", "wiz-title", false);

  try {
    // 1. Select arkadrum.asm. With default followVoice = 0, on-screen file is arkanoid.asm
    const gameList = harness.elementsById.get("game-list");
    const arkadrumItem = gameList.children.find((c) => c.innerHTML?.includes("arkadrum.asm"));
    assert.ok(arkadrumItem, "arkadrum item in game-list");
    arkadrumItem.click();

    // Verify the viewer has arkanoid lines (arkanoid has ~1787 lines, arkadrum has ~328)
    const viewer = harness.elementsById.get("source-viewer");
    assert.ok(viewer.children.length > 1000, "Viewer should display arkanoid.asm (>1000 lines)");

    // 2. Search for 'TITLE0', which only exists in arkanoid.asm
    const searchInput = harness.elementsById.get("input-source-search");
    searchInput.value = "TITLE0";
    searchInput.dispatchEvent("input");

    const matches = viewer.children.filter((r) => r.classList?.contains("search-match"));
    assert.ok(matches.length > 0, "Searching TITLE0 must find matches in arkanoid.asm on screen");

    // 3. Switch to drum follow (seq), so on-screen file becomes arkadrum.asm
    const drmChip = globalThis.document.querySelector('.legend-chip[data-voice="seq"]');
    assert.ok(drmChip, "DRM chip exists");
    drmChip.click();
    assert.ok(viewer.children.length < 500, "Viewer should display arkadrum.asm (<500 lines)");

    // Search for 'TOMhiTABLE', which only exists in arkadrum.asm
    searchInput.value = "TOMhiTABLE";
    searchInput.dispatchEvent("input");

    const drmMatches = viewer.children.filter((r) => r.classList?.contains("search-match"));
    assert.ok(
      drmMatches.length > 0,
      "Searching TOMhiTABLE must find matches in arkadrum.asm on screen",
    );
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("assembler hardens against empty operands, converges deterministically, and guards loader execution", async () => {
  // 1. Missing operand on instruction without implied mode throws naming line and opcode
  assert.throws(() => {
    assembleOceanSource("        ORG $1000\n        STA\n");
  }, /Missing operand for instruction 'STA' at line 2/);

  assert.throws(() => {
    assembleOceanSource("        ORG $1000\n        ADC\n");
  }, /Missing operand for instruction 'ADC' at line 2/);

  // 2. Deliberately unstable source throws when addresses fail to stabilise
  const unstableSrc = `
        ORG $1000
        LDA OSCILLATE
L1
OSCILLATE EQU (1 - (L1 AND 1)) * $04B0 + $0050
`;
  assert.throws(() => {
    assembleOceanSource(unstableSrc);
  }, /Assembly failed to converge/);

  // 3. All six sources assemble byte-identical across passes and on warm re-assembly
  const gameFiles = [
    "wizball.asm",
    "arkanoid.asm",
    "arkadrum.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
  ];
  for (const file of gameFiles) {
    const src = fs.readFileSync(path.join(ROOT, file), "latin1");
    const a1 = assembleOceanSource(src);
    const a2 = assembleOceanSource(src);
    assert.deepEqual(a1.mem, a2.mem, `${file} memory mismatch across warm passes`);
    assert.deepEqual(a1.symbols, a2.symbols, `${file} symbols mismatch across warm passes`);
    assert.equal(a1.entryPoint, a2.entryPoint, `${file} entryPoint mismatch`);
  }

  // 4. Player engine guards tracks without key and guards PMC/FMC independently
  const wasmBuf = fs.readFileSync(path.join(ROOT, "wasm/c64_engine.wasm"));
  const { instance } = await WebAssembly.instantiate(wasmBuf, {});
  const rawSources = {};
  for (const name of gameFiles) {
    rawSources[name] = fs.readFileSync(path.join(ROOT, name), "latin1");
  }
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: () => ({
      sampleRate: 44100,
      state: "running",
      destination: {},
      resume: async () => {},
      createBuffer: (_c, l, s) => ({
        length: l,
        sampleRate: s,
        getChannelData: () => new Float32Array(l),
      }),
      createBufferSource: () => ({
        buffer: null,
        connect: () => {},
        start: () => {},
        stop: () => {},
      }),
    }),
  });

  // Selecting tracks where key is missing must not throw
  assert.doesNotThrow(() => {
    player.selectTrack("greenberet.asm", "custom-no-key");
  });
  assert.doesNotThrow(() => {
    player.selectTrack("arkanoid.asm", "custom-no-key");
  });
  assert.doesNotThrow(() => {
    player.selectTrack("gameover.asm", "custom-no-key");
  });
});

test("switching away from a game and back reuses cached source viewer HTML", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });
  view.selectGameAndTrack("wizball.asm", "wiz-title", false);

  try {
    // 1. Initial boot caches wizball.asm rendered HTML
    const state = globalThis.__workbenchState;
    assert.ok(state, "Expected global workbench state");
    assert.ok(state.sourceHtmlCache.has("wizball.asm"), "wizball.asm HTML must be cached");
    const wizHtml = state.sourceHtmlCache.get("wizball.asm");
    assert.ok(wizHtml.length > 1000);

    // 2. Switching to greenberet.asm caches greenberet HTML
    const gameList = harness.elementsById.get("game-list");
    const gbItem = gameList.children.find((c) => c.innerHTML?.includes("greenberet.asm"));
    assert.ok(gbItem, "greenberet item in game-list");
    gbItem.click();
    assert.ok(state.sourceHtmlCache.has("greenberet.asm"), "greenberet.asm HTML must be cached");

    // 3. Switching back to wizball.asm reuses exact cached HTML reference
    const wizItem = gameList.children.find((c) => c.innerHTML?.includes("wizball.asm"));
    assert.ok(wizItem, "wizball item in game-list");
    wizItem.click();
    assert.equal(
      state.sourceHtmlCache.get("wizball.asm"),
      wizHtml,
      "Switching back must reuse the cached HTML string",
    );
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("source index provides address lookup, symbol jump, and text search", () => {
  const sampleSrc = `
; Line 1 comment
        ORG $1000
MYLABEL EQU $2000
START   LDA #$00
        STA $D400
LOOP    JMP LOOP
`;
  const assembled = assembleOceanSource(sampleSrc);
  const idx = assembled.sourceIndex;
  assert.ok(idx, "sourceIndex must be exposed on assembled output");

  // 1. Symbol line resolution
  assert.equal(idx.lineForSymbol("MYLABEL"), 4);
  assert.equal(idx.lineForSymbol("START"), 5);
  assert.equal(idx.lineForSymbol("LOOP"), 7);
  assert.equal(idx.lineForSymbol("NONEXISTENT"), 0);

  // 2. Address resolution (with delta tolerance)
  assert.equal(idx.lineForAddress(0x1000), 5);
  assert.equal(idx.lineForAddress(0x1002), 6);
  assert.equal(idx.lineForAddress(0x1005), 7);
  assert.equal(idx.lineForAddress(0x1006), 7);
  assert.equal(idx.lineForAddress(0x0400), 0);

  // 3. Substring findLines
  assert.deepEqual(idx.findLines("loop"), [7]);
  assert.deepEqual(idx.findLines("org"), [3]);
  assert.deepEqual(idx.findLines("nonexistent_pattern"), []);
  assert.deepEqual(idx.findLines(""), []);
});

test("workbench view mounts behind focused interface and importing modules causes no side effects", async () => {
  // 1. Verify importing workbench_view and app does not boot the app or mutate globals
  const prevWorkbenchState = globalThis.__workbenchState;
  globalThis.__workbenchState = undefined;

  const viewModule = await import("../src/workbench_view.js");
  const appModule = await import("../src/app.js");

  assert.equal(typeof viewModule.createWorkbenchView, "function");
  assert.equal(typeof appModule.bootWorkbench, "function");
  assert.equal(typeof appModule.initWorkbench, "function");
  assert.equal(
    globalThis.__workbenchState,
    undefined,
    "Importing modules must not instantiate state",
  );

  // Restore prior state if any
  globalThis.__workbenchState = prevWorkbenchState;

  // 2. Mount view with fake player and element map
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = viewModule.createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });

  try {
    // 3. View surface exposes required methods
    assert.equal(typeof view.renderSession, "function");
    assert.equal(typeof view.renderTelemetry, "function");
    assert.equal(typeof view.renderSource, "function");
    assert.equal(typeof view.setPlaying, "function");
    assert.equal(typeof view.destroy, "function");

    // 4. Element registry encapsulates element lookup
    assert.ok(view.elements, "Expected elements registry");
    assert.equal(typeof view.elements.get, "function");
    const playBtn = view.elements.get("btn-play");
    assert.ok(playBtn, "Expected btn-play through view.elements");

    // 5. Driving playback updates UI
    view.setPlaying(true);
    assert.equal(player.getState().isPlaying, true);
    assert.equal(view.elements.get("play-label").textContent, "PAUSE");

    view.setPlaying(false);
    assert.equal(player.getState().isPlaying, false);
    assert.equal(view.elements.get("play-label").textContent, "PLAY");
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("telemetry change guards eliminate redundant DOM writes and morse re-renders on identical frames", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });

  try {
    let morseInnerHtmlWrites = 0;
    const morseContainer = harness.elementsById.get("morse-stream");
    let morseHtml = morseContainer.innerHTML;
    Object.defineProperty(morseContainer, "innerHTML", {
      get: () => morseHtml,
      set: (val) => {
        morseInnerHtmlWrites++;
        morseHtml = val;
      },
      configurable: true,
    });

    view.selectGameAndTrack("rambload.asm", "rambo-loader", false);
    assert.equal(
      morseInnerHtmlWrites,
      1,
      "Initial session selection must render morse stream once",
    );

    // List of element IDs that display dynamic telemetry and register values
    const watchedIds = [
      "tel-frame",
      "tel-pc",
      "tel-d418",
      "seq-pc",
      "filter-mode-tag",
      "flt-fc",
      "flt-res",
      "flt-rout",
      "flt-vol",
      ...Array.from({ length: 25 }, (_, i) => `sid-reg-${i}`),
      ...[0, 1, 2].flatMap((v) => [
        `v${v}-note`,
        `v${v}-wf`,
        `v${v}-pw`,
        `v${v}-adsr`,
        `v${v}-env`,
        `v${v}-pc`,
      ]),
    ];

    let textWrites = 0;
    for (const id of watchedIds) {
      const el = harness.elementsById.get(id);
      if (!el) continue;
      let textVal = el.textContent;
      Object.defineProperty(el, "textContent", {
        get: () => textVal,
        set: (val) => {
          textWrites++;
          textVal = val;
        },
        configurable: true,
      });
    }

    const tel = {
      frameCount: 100,
      cpuPc: 0x1000,
      d418: 0,
      sidRegs: new Uint8Array(25).fill(0x10),
      voices: [
        { freq: 0x1168, pw: 0x800, ctrl: 0x11, env: 0x80 },
        { freq: 0x08b4, pw: 0x400, ctrl: 0x21, env: 0x40 },
        { freq: 0x045a, pw: 0x200, ctrl: 0x41, env: 0x20 },
      ],
      filter: { fc: 0x400, res: 8, rout: 7, mode: 0x10, vol: 15 },
      scanlineBorder: new Uint8Array(312),
      ram: new Uint8Array(65536),
      morseIndex: 0,
    };

    // Frame 1: Initial telemetry render writes values to DOM
    morseInnerHtmlWrites = 0;
    view.renderTelemetry(tel);
    assert.ok(textWrites > 0, "Initial frame must populate DOM elements");
    assert.equal(morseInnerHtmlWrites, 0, "Identical morseIndex 0 must not rebuild morse stream");

    // Frame 2: Exactly identical telemetry must perform ZERO textContent writes and ZERO morse rebuilds
    textWrites = 0;
    morseInnerHtmlWrites = 0;
    view.renderTelemetry(tel);
    assert.equal(
      textWrites,
      0,
      "Two consecutive frames with identical telemetry must produce zero text writes",
    );
    assert.equal(
      morseInnerHtmlWrites,
      0,
      "Identical morseIndex must not rebuild morse stream innerHTML",
    );

    // Frame 3: Updating cpuPc writes only that element
    tel.cpuPc = 0x2500;
    textWrites = 0;
    view.renderTelemetry(tel);
    assert.equal(textWrites, 1, "Changing cpuPc must write only the updated element");
    assert.equal(harness.elementsById.get("tel-pc").textContent, "$2500");

    // Frame 4: Updating voice 0 frequency updates note text
    tel.voices[0].freq = 0x1b00;
    textWrites = 0;
    view.renderTelemetry(tel);
    assert.equal(textWrites, 1, "Changing voice 0 frequency must update note display");

    // Frame 5: Incrementing morseIndex (MWK) rebuilds morse stream exactly once
    morseInnerHtmlWrites = 0;
    tel.morseIndex = 1;
    view.renderTelemetry(tel);
    assert.equal(morseInnerHtmlWrites, 1, "Advancing morseIndex must rebuild morse stream");

    // Frame 6: Keeping the new morseIndex does not rebuild
    morseInnerHtmlWrites = 0;
    view.renderTelemetry(tel);
    assert.equal(
      morseInnerHtmlWrites,
      0,
      "Identical morseIndex on subsequent frame must not rebuild morse stream",
    );
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("Workbench View reports main-thread frame work p50, p95, max and peak", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });

  try {
    player.play();
    for (let i = 0; i < 60; i++) {
      player.getTelemetry().frameCount++;
      harness.stepAnimationFrame();
    }

    const frame = view.getFrameDiagnostics();
    assert.equal(frame.frameCalls, 60);
    assert.ok(frame.framePeakMs >= frame.frameMaxMs);
    assert.ok(frame.frameMaxMs >= frame.frameP95Ms);
    assert.ok(frame.frameP95Ms >= frame.frameP50Ms);
    assert.ok(frame.frameP50Ms >= 0);
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("Workbench View pauses and resumes rendering for boot presentation", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });

  try {
    let draws = 0;
    const ctx = harness.elementsById.get("c64-monitor-canvas").getContext("2d");
    ctx.putImageData = () => {
      draws++;
    };

    player.play();
    view.setRenderingPaused(true);
    for (let i = 0; i < 3; i++) {
      player.getTelemetry().frameCount++;
      harness.stepAnimationFrame();
    }
    assert.equal(draws, 0, "A paused view must not draw the C64 monitor");

    view.setRenderingPaused(false);
    player.getTelemetry().frameCount++;
    harness.stepAnimationFrame();
    assert.ok(draws > 0, "An unpaused view must draw the C64 monitor");
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("music-only controls are absent and the workbench always renders", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });

  try {
    for (const id of [
      "chk-low-power",
      "low-power-value",
      "music-only-bar",
      "select-mini-track",
      "btn-mini-play",
      "btn-mini-restart",
      "btn-mini-stats",
      "btn-mini-full-ui",
    ]) {
      assert.equal(harness.elementsById.has(id), false, `#${id} must be removed`);
    }
    assert.equal(typeof view.setStatsVisible, "undefined");

    player.play();
    for (const timestamp of [1000, 1016, 1033, 1050, 1066, 1083, 1100]) {
      harness.stepAnimationFrame(timestamp);
    }
    assert.ok(view.getFrameDiagnostics().frameCalls > 0, "the render loop must keep running");
    assert.ok(!globalThis.document.body.classList.contains("music-only"));
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});

test("Minimal render marks the body and pauses the workbench render loop", () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const originalRaf = globalThis.window.requestAnimationFrame;
  let rafCalls = 0;
  globalThis.window.requestAnimationFrame = (callback) => {
    rafCalls++;
    return originalRaf(callback);
  };
  let view = null;

  try {
    view = createWorkbenchView({
      document: globalThis.document,
      elements: harness.elementsById,
      player,
      renderMinimal: true,
    });

    assert.ok(globalThis.document.body.classList.contains("render-minimal"));
    assert.equal(rafCalls, 0, "Minimal render must not schedule animation frames");

    player.play();
    for (const timestamp of [1000, 1016, 1033, 1050, 1066, 1083, 1100]) {
      harness.stepAnimationFrame(timestamp);
    }
    assert.equal(
      view.getFrameDiagnostics().frameCalls,
      0,
      "Minimal render must pause the workbench render loop",
    );
    assert.equal(rafCalls, 0, "Minimal render must not schedule another frame");

    const before = view.state.activeTrackId;
    harness.elementsById.get("btn-next").click();
    assert.notEqual(
      view.state.activeTrackId,
      before,
      "Track switching must remain usable in minimal render mode",
    );
    assert.equal(player.getState().isPlaying, true, "Track switching must keep playback");
    assert.equal(
      harness.elementsById.get("source-viewer").children.length,
      0,
      "Track switching must not render the hidden source viewer",
    );

    harness.elementsById.get("btn-play").click();
    assert.equal(player.getState().isPlaying, false, "Pause must remain usable");
    assert.equal(view.getFrameDiagnostics().frameCalls, 0, "Pause must not resume the loop");

    const originalGetTelemetry = player.getTelemetry.bind(player);
    let telemetryReads = 0;
    player.getTelemetry = () => {
      telemetryReads++;
      return originalGetTelemetry();
    };
    globalThis.document.hidden = false;
    globalThis.document.dispatchEvent("visibilitychange");
    assert.equal(
      telemetryReads,
      0,
      "A visibility change must not render hidden telemetry in minimal render mode",
    );
  } finally {
    globalThis.window.requestAnimationFrame = originalRaf;
    view?.destroy();
    harness.restoreGlobals();
  }
});

test("idle render loop skips canvas repaints and DOM writes when paused or hidden, resuming on visibility", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  const player = createFakePlayer();
  const view = createWorkbenchView({
    document: globalThis.document,
    elements: harness.elementsById,
    player,
  });

  try {
    // Spy on C64 screen canvas putImageData
    let putImageDataCount = 0;
    const c64Canvas = harness.elementsById.get("c64-monitor-canvas");
    const mockCtx = c64Canvas.getContext("2d");
    mockCtx.putImageData = () => {
      putImageDataCount++;
    };

    // Spy on voice and filter scope fillRect and stroke
    let scopeDrawCount = 0;
    for (const scopeId of ["scope-v0", "scope-v1", "scope-v2", "scope-master"]) {
      const scopeEl = harness.elementsById.get(scopeId);
      const ctx = scopeEl.getContext("2d");
      const origFillRect = ctx.fillRect;
      const origStroke = ctx.stroke;
      ctx.fillRect = (...args) => {
        scopeDrawCount++;
        return origFillRect(...args);
      };
      ctx.stroke = (...args) => {
        scopeDrawCount++;
        return origStroke(...args);
      };
    }

    // Spy on telemetry text writes
    let telWrites = 0;
    const telFrame = harness.elementsById.get("tel-frame");
    let telFrameText = telFrame.textContent;
    Object.defineProperty(telFrame, "textContent", {
      get: () => telFrameText,
      set: (v) => {
        telWrites++;
        telFrameText = v;
      },
      configurable: true,
    });

    // 1. Paused player: start paused, advance one frame to flush initial state, then test idle path
    view.setPlaying(false);
    harness.stepAnimationFrame();

    putImageDataCount = 0;
    scopeDrawCount = 0;
    telWrites = 0;

    // Advance 5 animation frames while paused
    for (let i = 0; i < 5; i++) {
      harness.stepAnimationFrame();
    }
    assert.equal(
      putImageDataCount,
      0,
      "Paused player must perform zero canvas monitor draws across frames",
    );
    assert.equal(
      scopeDrawCount,
      0,
      "Paused player must perform zero oscilloscope draws across frames",
    );
    assert.equal(
      telWrites,
      0,
      "Paused player must perform zero telemetry text writes across frames",
    );

    // 2. Resume play: playback restarts rendering immediately
    view.setPlaying(true);
    player.getTelemetry().frameCount++;
    harness.stepAnimationFrame();
    assert.ok(putImageDataCount > 0, "Resuming playback must draw C64 monitor canvas");
    assert.ok(scopeDrawCount > 0, "Resuming playback must draw oscilloscopes");

    // 3. Document hidden: background tab skips canvas and DOM work while rescheduling
    globalThis.document.hidden = true;
    putImageDataCount = 0;
    scopeDrawCount = 0;
    telWrites = 0;

    for (let i = 0; i < 5; i++) {
      player.getTelemetry().frameCount++;
      harness.stepAnimationFrame();
    }
    assert.equal(putImageDataCount, 0, "Hidden document must perform zero canvas monitor draws");
    assert.equal(scopeDrawCount, 0, "Hidden document must perform zero oscilloscope draws");
    assert.equal(telWrites, 0, "Hidden document must perform zero telemetry text writes");

    // 4. Restore visibility: visibilitychange restores drawing
    globalThis.document.hidden = false;
    globalThis.document.dispatchEvent("visibilitychange");
    putImageDataCount = 0;
    scopeDrawCount = 0;
    player.getTelemetry().frameCount++;
    harness.stepAnimationFrame();
    assert.ok(putImageDataCount > 0, "Restoring visibility must resume C64 monitor canvas draws");
    assert.ok(scopeDrawCount > 0, "Restoring visibility must resume oscilloscope draws");

    // 5. Stale cache regression: re-rendering SID hex skeleton and stepping frame updates cell text
    player.getTelemetry().sidRegs[0] = 0x2b;
    player.getTelemetry().frameCount++;
    harness.stepAnimationFrame();
    assert.equal(harness.elementsById.get("sid-reg-0").textContent, "2B");

    // Re-render hex skeleton: DOM spans are recreated with default "00"
    view.renderSidHexStripSkeleton();
    assert.equal(harness.elementsById.get("sid-reg-0").textContent, "00");

    // Next frame must populate the new DOM node rather than writing to detached nodes
    player.getTelemetry().frameCount++;
    harness.stepAnimationFrame();
    assert.equal(
      harness.elementsById.get("sid-reg-0").textContent,
      "2B",
      "Advancing frame after skeleton rebuild must update newly mounted cell",
    );
  } finally {
    view.destroy();
    harness.restoreGlobals();
  }
});
