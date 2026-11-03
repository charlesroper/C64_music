import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeNextVersion } from "../scripts/bump_version.mjs";
import { bootWorkbench } from "../src/app.js";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import { createWorkbenchPlayer } from "../src/player_engine.js";
import { GAME_FILES } from "../src/tracks_catalog.js";
import { createWorkbenchView } from "../src/workbench_view.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

import { createBrowserHarness, createFakePlayer } from "./helpers/browser_harness.mjs";

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
    await bootWorkbench();
    harness.stepAnimationFrame();

    // Simulate user tapping PLAY on mobile Safari (44.1 kHz hardware, sampleRate option rejected)
    harness.elementsById.get("btn-play").click();

    assert.equal(harness.audioState.audioSession.type, "playback");
    assert.equal(harness.elementsById.get("play-label").textContent, "PAUSE");

    const stats = harness.pullWebKitStrictAudioFrames(24);
    assert.equal(stats.nanCount, 0);
    assert.ok(stats.peakL > 0.1, `Expected left channel peak > 0.1, got ${stats.peakL}`);
    assert.ok(stats.peakR > 0.1, `Expected right channel peak > 0.1, got ${stats.peakR}`);
    assert.ok(stats.rms > 0.02, `Expected RMS > 0.02, got ${stats.rms}`);
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

    const bootPromise = bootWorkbench();
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
    await bootPromise;
    const deadline = Date.now() + 5000;
    while (
      harness.elementsById.get("play-label").textContent === "LOADING..." &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.equal(harness.elementsById.get("play-label").textContent, "PAUSE");
    const stats = harness.pullWebKitStrictAudioFrames(16);
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
    const gameOverItem = gameList.children.find(
      (c) => c.innerHTML && c.innerHTML.includes("gameover.asm"),
    );
    assert.ok(gameOverItem, "gameover item in game-list");
    gameOverItem.click();

    // First track is go-title-full: withDrums is true, DRM chip must be ENABLED
    assert.ok(!drmChip.classList.contains("disabled"), "go-title-full should enable DRM chip");

    // Switch to a gameover SFX track without drums (e.g. go-sfx-laser)
    const trackList = harness.elementsById.get("track-list");
    const sfxTrack = trackList.children.find(
      (c) => c.innerHTML && c.innerHTML.includes("Player Laser"),
    );
    assert.ok(sfxTrack, "SFX Player Laser track in track-list");
    sfxTrack.click();

    // DRM chip must be DISABLED for SFX track
    assert.ok(drmChip.classList.contains("disabled"), "Game Over SFX track must disable DRM chip");

    // Switch back to go-title-full
    const fullTrack = trackList.children.find(
      (c) => c.innerHTML && c.innerHTML.includes("Title Screen (Full"),
    );
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
    const badRows = viewer.children.filter((r) => r.innerHTML && r.innerHTML.includes("$00-1"));
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
    const arkadrumItem = gameList.children.find(
      (c) => c.innerHTML && c.innerHTML.includes("arkadrum.asm"),
    );
    assert.ok(arkadrumItem, "arkadrum item in game-list");
    arkadrumItem.click();

    // Verify the viewer has arkanoid lines (arkanoid has ~1787 lines, arkadrum has ~328)
    const viewer = harness.elementsById.get("source-viewer");
    assert.ok(viewer.children.length > 1000, "Viewer should display arkanoid.asm (>1000 lines)");

    // 2. Search for 'TITLE0', which only exists in arkanoid.asm
    const searchInput = harness.elementsById.get("input-source-search");
    searchInput.value = "TITLE0";
    searchInput.dispatchEvent("input");

    const matches = viewer.children.filter(
      (r) => r.classList && r.classList.contains("search-match"),
    );
    assert.ok(matches.length > 0, "Searching TITLE0 must find matches in arkanoid.asm on screen");

    // 3. Switch to drum follow (seq), so on-screen file becomes arkadrum.asm
    const drmChip = globalThis.document.querySelector('.legend-chip[data-voice="seq"]');
    assert.ok(drmChip, "DRM chip exists");
    drmChip.click();
    assert.ok(viewer.children.length < 500, "Viewer should display arkadrum.asm (<500 lines)");

    // Search for 'TOMhiTABLE', which only exists in arkadrum.asm
    searchInput.value = "TOMhiTABLE";
    searchInput.dispatchEvent("input");

    const drmMatches = viewer.children.filter(
      (r) => r.classList && r.classList.contains("search-match"),
    );
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
