import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNextVersion } from "../scripts/bump_version.mjs";

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
        add: (...c) => c.forEach((x) => this.classList._set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
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
      child.parentElement = this;
      this.children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
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

  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1];
    const el = new MockElement("div", id);
    if (id === "slider-digi-boost") el.value = "1.3";
    if (id === "select-sid-model") el.value = "6581";
    if (id === "select-video-std") el.value = "pal";
    elementsById.set(id, el);
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
  globalThis.window = {
    AudioContext: StrictAudioContext,
    addEventListener: () => {},
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
    querySelectorAll: () => [],
    querySelector: () => null,
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
      assert.equal(typeof audioState.processor.onaudioprocess, "function", "onaudioprocess missing");
      assert.ok(
        audioState.processor.inCh >= 1 && audioState.upstreamConnectedToProcessor && audioState.upstreamSourcesStarted >= 1,
        "WebKit requires >=1 input channel and a started upstream source connected to ScriptProcessorNode"
      );
      assert.ok(
        audioState.processorConnectedToDestination,
        "ScriptProcessorNode must be connected to audioCtx.destination"
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
  await new Promise((r) => setTimeout(r, 120));

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
  const deadline = Date.now() + 2000;
  while (harness.elementsById.get("play-label").textContent === "LOADING..." && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(harness.elementsById.get("play-label").textContent, "PAUSE");
  const stats = harness.pullWebKitStrictAudioFrames(16);
  assert.ok(stats.peakL > 0.1, `Expected audio after delayed load, got peak=${stats.peakL}`);
});

test("CalVer version number appears immediately after the title of the app", async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  
  // Brand title contains Galway 64 logo with accessible text and brand-version badge
  const match = html.match(/<div class="brand-title">([\s\S]*?)<\/div>/);
  assert.ok(match, "index.html must contain brand-title");
  
  const titleContent = match[1];
  assert.match(
    titleContent,
    /<span class="brand-logo"[^>]*role="(?:img|button)"[^>]*aria-label="Galway 64"[^>]*>[\s\S]*?<span class="sr-only">Galway 64<\/span>\s*<\/span>\s*<span class="brand-accent">\/\/ OCEAN 6502-SID WORKBENCH<\/span>\s*<span class="brand-version" id="app-version">v([0-9]{4}\.[0-9]{2}\.[0-9]{2}(?:\.[0-9]+)?)<\/span>/,
    "Version badge must be placed immediately after the app title"
  );

  const calver = titleContent.match(/id="app-version">v([^<]+)<\/span>/)[1];
  assert.equal(pkg.version, calver, "package.json version must match CalVer in index.html");

  // Title tag also includes Galway 64 and the version
  assert.match(html, new RegExp(`<title>Galway 64[^<]*v${calver}[^<]*<\\/title>`));

  // scripts/bump_version.mjs calculation logic
  const mockDate = new Date("2026-10-30T12:00:00Z");
  assert.equal(computeNextVersion("2026.10.29", mockDate), "2026.10.30");
  assert.equal(computeNextVersion("2026.10.30", mockDate), "2026.10.30.1");
  assert.equal(computeNextVersion("2026.10.30.1", mockDate), "2026.10.30.2");
  assert.equal(computeNextVersion("2026.10.30.2", mockDate), "2026.10.30.3");
  assert.equal(computeNextVersion("2026.10.30.3", mockDate), "2026.10.30.4");
  assert.equal(computeNextVersion("2026.10.30.4", mockDate), "2026.10.30.5");

  // Verify Galway 64 C64 logo generator defaults to pure white and uses authentic character ROM
  const { getGalway64LogoSvg, generateC64TextSvg, C64_RAINBOW_PALETTE, C64_SPARKLE_PALETTE, VIC_PALETTE } = await import("../src/c64_charset.js");
  const svg = getGalway64LogoSvg();
  assert.ok(svg.includes('aria-label="Galway 64"'), "Logo SVG must contain accessible aria-label");
  assert.ok(svg.includes('<title>Galway 64</title>'), "Logo SVG must contain accessible title");
  assert.ok(svg.includes('shape-rendering="crispEdges"'), "Logo SVG must specify crispEdges");
  assert.ok(svg.includes(`fill="${VIC_PALETTE[1]}"`), "Logo SVG must default to authentic VIC White (#FFFFFF)");

  // Rainbow palette is preserved for custom color runs
  const rainbowSvg = generateC64TextSvg("GALWAY 64", { colors: C64_RAINBOW_PALETTE });
  assert.ok(rainbowSvg.includes(`fill="${VIC_PALETTE[10]}"`), "Custom rainbow logo must support Light Red");
  assert.equal(C64_RAINBOW_PALETTE.length, 8, "C64 rainbow palette must have 8 authentic colors");

  // Verify sparkle reflection palette and CSS rules
  assert.ok(C64_SPARKLE_PALETTE.includes(VIC_PALETTE[3]), "Sparkle palette must include Cyan");
  assert.ok(C64_SPARKLE_PALETTE.includes(VIC_PALETTE[7]), "Sparkle palette must include Yellow");
  assert.ok(C64_SPARKLE_PALETTE.includes(VIC_PALETTE[1]), "Sparkle palette must include White");

  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.ok(css.includes("@keyframes c64-sparkle-sweep"), "CSS must contain c64-sparkle-sweep keyframes");
  assert.ok(css.includes(".brand-logo.sparkle-active"), "CSS must contain sparkle-active class selector");
});
