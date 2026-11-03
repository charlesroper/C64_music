import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeNextVersion } from "../scripts/bump_version.mjs";
import { assembleOceanSource } from "../src/ocean_assembler.js";
import { createWorkbenchPlayer } from "../src/player_engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function createBrowserHarness({ hardwareSampleRate = 44100, rejectSampleRateOption = false } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const elementsById = new Map();
  const allElements = [];

  class MockElement {
    constructor(tag = "div", id = "") {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.className = "";
      this.textContent = "";
      this._innerHTML = "";
      this.value = "";
      this.checked = false;
      this.style = {};
      this.dataset = {};
      this.children = [];
      this.parentElement = null;
      this.listeners = {};
      this.width = 384;
      this.height = 272;
      this.classList = {
        _set: new Set(),
        add: (...c) => {
          c.forEach((x) => {
            this.classList._set.add(x);
          });
        },
        remove: (...c) => {
          c.forEach((x) => {
            this.classList._set.delete(x);
          });
        },
        toggle: (c, force) => {
          const should = force === undefined ? !this.classList._set.has(c) : Boolean(force);
          if (should) this.classList._set.add(c);
          else this.classList._set.delete(c);
          return should;
        },
        contains: (c) => this.classList._set.has(c),
      };
      allElements.push(this);
    }
    set innerHTML(v) {
      this._innerHTML = v;
      if (v === "") this.children = [];
    }
    get innerHTML() {
      return this._innerHTML;
    }
    appendChild(child) {
      if (child.tagName === "FRAGMENT") {
        for (const sub of child.children) {
          sub.parentElement = this;
          this.children.push(sub);
          if (sub.id) elementsById.set(sub.id, sub);
        }
        child.children = [];
        return child;
      }
      child.parentElement = this;
      this.children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    }
    dispatchEvent(type, extra = {}) {
      for (const fn of this.listeners[type] || []) {
        fn({ currentTarget: this, target: this, preventDefault() {}, ...extra });
      }
    }
    click() {
      this.dispatchEvent("click");
    }
    closest() {
      return new MockElement("div");
    }
    scrollIntoView() {}
    getContext() {
      return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
        fillRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {},
      };
    }
  }

  for (const m of html.matchAll(/<([a-zA-Z0-9-]+)([^>]*)>/g)) {
    const tag = m[1];
    const attrs = m[2];
    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : "";
    const el = new MockElement(tag, id);
    const classMatch = attrs.match(/\bclass="([^"]+)"/);
    if (classMatch) {
      el.className = classMatch[1];
      classMatch[1]
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => {
          el.classList.add(c);
        });
    }
    const dataVoiceMatch = attrs.match(/\bdata-voice="([^"]+)"/);
    if (dataVoiceMatch) {
      el.dataset.voice = dataVoiceMatch[1];
    }
    if (id) {
      if (id === "slider-digi-boost") el.value = "1.3";
      if (id === "select-sid-model") el.value = "6581";
      if (id === "select-video-std") el.value = "pal";
      elementsById.set(id, el);
    }
  }

  const audioState = {
    ctx: null,
    processor: null,
    upstreamSourcesStarted: 0,
    upstreamConnectedToProcessor: false,
    processorConnectedToDestination: false,
    audioSession: { type: "ambient" },
  };

  // Spec-strict WebKit/Blink AudioContext fake:
  // - Starts "suspended" until resume() is called
  // - Optionally rejects { sampleRate } constructor option (simulating older iOS Safari)
  // - Requires numberOfInputChannels >= 1 AND a started upstream source connected to ScriptProcessor
  //   before onaudioprocess will fire (catching the WebKit 0-input ScriptProcessor silence bug)
  class StrictAudioContext {
    constructor(opts) {
      if (opts && opts.sampleRate && rejectSampleRateOption) {
        throw new DOMException("Unsupported sampleRate option", "NotSupportedError");
      }
      this.sampleRate = hardwareSampleRate;
      this.state = "suspended";
      this.destination = { isDestination: true };
      audioState.ctx = this;
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    createBuffer(channels, length, sampleRate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      };
    }
    createBufferSource() {
      const src = {
        buffer: null,
        loop: false,
        _connectedTargets: [],
        connect(target) {
          this._connectedTargets.push(target);
          if (target === audioState.processor) {
            audioState.upstreamConnectedToProcessor = true;
          }
          return target;
        },
        start() {
          audioState.upstreamSourcesStarted++;
        },
      };
      return src;
    }
    createScriptProcessor(bufferSize, inCh = 2, outCh = 2) {
      const proc = {
        bufferSize,
        inCh,
        outCh,
        onaudioprocess: null,
        connect(target) {
          if (target === audioState.ctx.destination) {
            audioState.processorConnectedToDestination = true;
          }
          return target;
        },
      };
      audioState.processor = proc;
      return proc;
    }
  }

  const rafQueue = [];
  const windowListeners = {};
  globalThis.window = {
    AudioContext: StrictAudioContext,
    addEventListener: (t, fn) => {
      if (!windowListeners[t]) windowListeners[t] = [];
      windowListeners[t].push(fn);
    },
    dispatchEvent: (type, extra = {}) => {
      for (const fn of windowListeners[type] || []) {
        fn({ type, preventDefault() {}, ...extra });
      }
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { audioSession: audioState.audioSession },
    configurable: true,
    writable: true,
  });
  globalThis.document = {
    activeElement: null,
    getElementById: (id) => {
      if (!elementsById.has(id)) {
        const el = new MockElement("div", id);
        elementsById.set(id, el);
      }
      return elementsById.get(id);
    },
    createElement: (tag) => new MockElement(tag),
    createDocumentFragment: () => new MockElement("fragment"),
    querySelectorAll: (sel) => {
      if (sel === ".legend-chip") {
        return allElements.filter((el) => el.classList && el.classList.contains("legend-chip"));
      }
      return [];
    },
    querySelector: (sel) => {
      if (sel === ".modal-backdrop:not(.hidden)") {
        return (
          allElements.find(
            (el) =>
              el.classList &&
              el.classList.contains("modal-backdrop") &&
              !el.classList.contains("hidden"),
          ) || null
        );
      }
      if (sel.includes('data-voice="seq"')) {
        return (
          allElements.find(
            (el) =>
              el.classList &&
              el.classList.contains("legend-chip") &&
              el.dataset &&
              el.dataset.voice === "seq",
          ) || null
        );
      }
      return null;
    },
  };
  globalThis.requestAnimationFrame = (cb) => {
    if (rafQueue.length < 4) rafQueue.push(cb);
    return rafQueue.length;
  };
  globalThis.fetch = async (relUrl) => {
    const clean = relUrl.replace(/^\.\//, "");
    const full = path.join(ROOT, clean);
    const buf = fs.readFileSync(full);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      text: async () => buf.toString("utf8"),
    };
  };

  return {
    elementsById,
    audioState,
    stepAnimationFrame() {
      const cb = rafQueue.shift();
      if (cb) cb();
    },
    pullWebKitStrictAudioFrames(blocks = 20) {
      assert.ok(audioState.ctx, "AudioContext was not created");
      assert.equal(audioState.ctx.state, "running", "AudioContext was not resumed");
      assert.ok(audioState.processor, "ScriptProcessorNode was not created");
      assert.equal(
        typeof audioState.processor.onaudioprocess,
        "function",
        "onaudioprocess missing",
      );
      assert.ok(
        audioState.processor.inCh >= 1 &&
          audioState.upstreamConnectedToProcessor &&
          audioState.upstreamSourcesStarted >= 1,
        "WebKit requires >=1 input channel and a started upstream source connected to ScriptProcessorNode",
      );
      assert.ok(
        audioState.processorConnectedToDestination,
        "ScriptProcessorNode must be connected to audioCtx.destination",
      );

      const n = audioState.processor.bufferSize;
      const outL = new Float32Array(n);
      const outR = new Float32Array(n);
      let peakL = 0;
      let peakR = 0;
      let sumSq = 0;
      let nanCount = 0;

      for (let b = 0; b < blocks; b++) {
        outL.fill(0);
        outR.fill(0);
        audioState.processor.onaudioprocess({
          outputBuffer: {
            getChannelData: (ch) => (ch === 0 ? outL : outR),
          },
        });
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(outL[i]) || Number.isNaN(outR[i])) nanCount++;
          const al = Math.abs(outL[i]);
          const ar = Math.abs(outR[i]);
          if (al > peakL) peakL = al;
          if (ar > peakR) peakR = ar;
          sumSq += al * al;
        }
      }
      const rms = Math.sqrt(sumSq / (blocks * n));
      return { peakL, peakR, rms, nanCount };
    },
  };
}

test("booting index.html + app.js and clicking PLAY generates non-silent stereo audio on mobile/WebKit AudioContext", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 44100,
    rejectSampleRateOption: true,
  });

  // Cache-bust import so module runs fresh against this harness
  await import(path.join(ROOT, `src/app.js?t=${Date.now()}`));
  const readyDeadline = Date.now() + 4000;
  while (
    !harness.elementsById.get("status-led").classList.contains("ready") &&
    Date.now() < readyDeadline
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }

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
});

test("tapping PLAY on mobile while WASM/.asm assets are still downloading unlocks AudioContext inside the tap gesture and starts audio when ready", async () => {
  const harness = createBrowserHarness({
    hardwareSampleRate: 48000,
    rejectSampleRateOption: false,
  });

  // Delay fetch by 80ms to simulate mobile network latency
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    await new Promise((r) => setTimeout(r, 80));
    return origFetch(url);
  };

  const bootPromise = import(path.join(ROOT, `src/app.js?t=${Date.now()}_slow`));
  // Wait 10ms so setupUIHandlers() has run, but fetches have NOT completed yet
  await new Promise((r) => setTimeout(r, 10));

  // User taps PLAY while assets are still loading
  harness.elementsById.get("btn-play").click();

  // AudioContext MUST be created & resumed synchronously during the user tap gesture (iOS requirement)
  assert.ok(harness.audioState.ctx, "AudioContext must be created synchronously during early tap");
  assert.equal(harness.audioState.ctx.state, "running", "AudioContext must resume during gesture");

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
  await import(path.join(ROOT, `src/app.js?t=${Date.now()}`));
  const readyDeadline = Date.now() + 4000;
  while (
    !harness.elementsById.get("status-led").classList.contains("ready") &&
    Date.now() < readyDeadline
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }
  harness.stepAnimationFrame();

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
});

test("global keyboard shortcuts ignore Space and letter keys while modal is open, and preserve native button activation", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  await import(path.join(ROOT, `src/app.js?t=${Date.now()}`));
  const readyDeadline = Date.now() + 4000;
  while (
    !harness.elementsById.get("status-led").classList.contains("ready") &&
    Date.now() < readyDeadline
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }
  harness.stepAnimationFrame();

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
  assert.equal(playLabel.textContent, "PLAY", "Space while modal is open must not toggle playback");
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
});

test("DRM chip is track-aware, drum PC reads through seqPC symbol, and unchecking follow stays off across track switches", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  await import(path.join(ROOT, `src/app.js?t=${Date.now()}`));
  const readyDeadline = Date.now() + 4000;
  while (
    !harness.elementsById.get("status-led").classList.contains("ready") &&
    Date.now() < readyDeadline
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }
  harness.stepAnimationFrame();

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
  assert.equal(chkFollow.checked, false, "Follow checkbox must stay unchecked after track switch");

  // 3. Drum PC readout reads through seqPC symbol
  fullTrack.click();
  harness.stepAnimationFrame();
  const telSeq = harness.elementsById.get("seq-pc");
  assert.ok(telSeq.textContent.startsWith("DRUM: $"), "Drum PC readout should format address");
});

test("source viewer address gutter hides sentinel values and shows $0000 for address zero", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  await import(path.join(ROOT, `src/app.js?t=${Date.now()}`));
  const readyDeadline = Date.now() + 4000;
  while (
    !harness.elementsById.get("status-led").classList.contains("ready") &&
    Date.now() < readyDeadline
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }
  harness.stepAnimationFrame();

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
});

test("symbol jump and source search use the on-screen file instead of activeGameId", async () => {
  const harness = createBrowserHarness({ hardwareSampleRate: 44100 });
  await import(path.join(ROOT, `src/app.js?t=${Date.now()}`));
  const readyDeadline = Date.now() + 4000;
  while (
    !harness.elementsById.get("status-led").classList.contains("ready") &&
    Date.now() < readyDeadline
  ) {
    await new Promise((r) => setTimeout(r, 20));
  }
  harness.stepAnimationFrame();

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
