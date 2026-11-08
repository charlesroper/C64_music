import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleOceanSource } from "../../src/ocean_assembler.js";
import { buildSessionDescriptor } from "../../src/player_engine.js";
import { resolveTelemetryHz } from "../../src/telemetry_rate.js";
import { GAME_FILES } from "../../src/tracks_catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export function matchesSelector(el, sel) {
  if (!el || !sel) return false;

  if (sel.includes(",")) {
    return sel.split(",").some((part) => matchesSelector(el, part.trim()));
  }

  if (sel.includes(" ")) {
    const parts = sel.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (!matchesSelector(el, last)) return false;
    let curr = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      const ancestorSel = parts[i];
      while (curr && !matchesSelector(curr, ancestorSel)) {
        curr = curr.parentElement;
      }
      if (!curr) return false;
      curr = curr.parentElement;
    }
    return true;
  }

  if (sel === ".modal-backdrop:not(.hidden)") {
    return Boolean(el.classList?.contains("modal-backdrop") && !el.classList?.contains("hidden"));
  }

  const tagMatch = sel.match(/^([a-zA-Z0-9-]+)/);
  const classMatches = Array.from(sel.matchAll(/\.([a-zA-Z0-9_-]+)/g));
  const idMatch = sel.match(/#([a-zA-Z0-9_-]+)/);
  const attrMatches = Array.from(sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g));

  if (tagMatch) {
    if (el.tagName !== tagMatch[1].toUpperCase()) return false;
  }
  for (const cm of classMatches) {
    if (!el.classList?.contains(cm[1])) return false;
  }
  if (idMatch) {
    if (el.id !== idMatch[1]) return false;
  }
  for (const am of attrMatches) {
    const rawAttr = am[1];
    const val = am[2];
    let actualVal;
    if (rawAttr.startsWith("data-")) {
      const camel = rawAttr.slice(5).replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
      actualVal = el.dataset ? el.dataset[camel] : undefined;
    } else {
      actualVal = el[rawAttr];
    }
    if (val === undefined) {
      if (actualVal === undefined || actualVal === null || actualVal === false) return false;
    } else {
      if (String(actualVal) !== val) return false;
    }
  }
  return true;
}

export function createBrowserHarness({
  hardwareSampleRate = 44100,
  rejectSampleRateOption = false,
  viewport = { width: 1200, height: 800 },
  rootDir = ROOT,
  htmlPath = path.join(ROOT, "index.html"),
  strictIds = true,
} = {}) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const elementsById = new Map();
  const allElements = [];
  const scrolledElements = [];
  const rafQueue = [];
  const windowListeners = {};
  let resolveBoot = null;
  const bootDone = new Promise((resolve) => {
    resolveBoot = resolve;
  });

  class MockElement {
    constructor(tag = "div", id = "") {
      this.tagName = tag.toUpperCase();
      this._id = id;
      this.className = "";
      this.textContent = "";
      this._innerHTML = "";
      this.value = "";
      this.checked = false;
      this.style = {};
      this.dataset = {};
      this.children = [];
      this.parentElement = null;
      this._isConnected = true;
      this.listeners = {};
      this.width = 384;
      this.height = 272;

      this.classList = {
        _set: new Set(),
        add: (...c) => {
          for (const x of c) {
            this.classList._set.add(x);
          }
          this.className = Array.from(this.classList._set).join(" ");
        },
        remove: (...c) => {
          for (const x of c) {
            this.classList._set.delete(x);
          }
          this.className = Array.from(this.classList._set).join(" ");
        },
        toggle: (c, force) => {
          const should = force === undefined ? !this.classList._set.has(c) : Boolean(force);
          if (should) this.classList._set.add(c);
          else this.classList._set.delete(c);
          this.className = Array.from(this.classList._set).join(" ");
          return should;
        },
        contains: (c) => this.classList._set.has(c),
      };

      if (id) {
        elementsById.set(id, this);
      }
      allElements.push(this);
    }

    get id() {
      return this._id;
    }

    set id(newId) {
      if (this._id && elementsById.get(this._id) === this) {
        elementsById.delete(this._id);
      }
      this._id = newId;
      if (newId) {
        elementsById.set(newId, this);
      }
    }

    set innerHTML(v) {
      this._innerHTML = v;
      if (v === "") {
        for (const child of this.children) {
          child.parentElement = null;
          child._isConnected = false;
        }
        this.children = [];
      }
    }

    get innerHTML() {
      return this._innerHTML;
    }

    get isConnected() {
      if (this._isConnected !== undefined) return this._isConnected;
      return true;
    }

    appendChild(child) {
      if (child.tagName === "FRAGMENT") {
        for (const sub of child.children) {
          sub.parentElement = this;
          this.children.push(sub);
          if (sub.id) elementsById.set(sub.id, sub);
          if (!allElements.includes(sub)) allElements.push(sub);
        }
        child.children = [];
        return child;
      }
      child.parentElement = this;
      this.children.push(child);
      if (child.id) elementsById.set(child.id, child);
      if (!allElements.includes(child)) allElements.push(child);
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

    scrollIntoView() {
      scrolledElements.push(this.id);
    }

    getBoundingClientRect() {
      const width = this.width || 0;
      const height = this.height || 0;
      return { left: 0, top: 0, width, height, right: width, bottom: height };
    }

    animate(keyframes) {
      this.animations = this.animations || [];
      this.animations.push(keyframes);
      return {
        finished: Promise.resolve(),
        cancel() {},
      };
    }

    closest(sel) {
      let cur = this;
      while (cur) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      const fallback = new MockElement("div");
      if (sel?.startsWith(".")) {
        fallback.classList.add(sel.slice(1));
      }
      return fallback;
    }

    getContext(type = "2d") {
      if (type === "2d") {
        if (!this._ctx2d) {
          this._ctx2d = {
            canvas: this,
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
        return this._ctx2d;
      }
      return null;
    }
  }

  // Parse authentic markup tags and register known elements
  for (const m of html.matchAll(/<([a-zA-Z0-9-]+)([^>]*)>/g)) {
    const tag = m[1];
    const attrs = m[2];
    if (tag.startsWith("!--") || tag.startsWith("/")) continue;

    const idMatch = attrs.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : "";
    const el = new MockElement(tag, id);

    const classMatch = attrs.match(/\bclass="([^"]+)"/);
    if (classMatch) {
      el.className = classMatch[1];
      for (const c of classMatch[1].split(/\s+/).filter(Boolean)) {
        el.classList.add(c);
      }
    }

    for (const dataMatch of attrs.matchAll(/\bdata-([a-zA-Z0-9-]+)="([^"]*)"/g)) {
      const camel = dataMatch[1].replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
      el.dataset[camel] = dataMatch[2];
    }

    if (/\bchecked\b/.test(attrs)) {
      el.checked = true;
    }
    if (/(?:^|\s)hidden(?:\s|=|$)/.test(attrs)) {
      el.hidden = true;
    }

    const valMatch = attrs.match(/\bvalue="([^"]*)"/);
    if (valMatch) {
      el.value = valMatch[1];
    }

    if (id) {
      if (id === "slider-digi-boost" && !el.value) el.value = "1.3";
    }
  }

  const audioState = {
    ctx: null,
    audioSession: { type: "ambient" },
  };

  class StrictAudioContext {
    constructor(opts) {
      if (opts?.sampleRate && rejectSampleRateOption) {
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
  }

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  const activeIntervals = new Set();
  const activeTimeouts = new Set();

  globalThis.setInterval = (fn, ms, ...args) => {
    const id = prevGlobals.setInterval(fn, ms, ...args);
    if (typeof id?.unref === "function") id.unref();
    activeIntervals.add(id);
    return id;
  };

  globalThis.clearInterval = (id) => {
    activeIntervals.delete(id);
    return prevGlobals.clearInterval(id);
  };

  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = prevGlobals.setTimeout(
      (...cbArgs) => {
        activeTimeouts.delete(id);
        fn(...cbArgs);
      },
      ms,
      ...args,
    );
    activeTimeouts.add(id);
    return id;
  };

  globalThis.clearTimeout = (id) => {
    activeTimeouts.delete(id);
    return prevGlobals.clearTimeout(id);
  };

  const docListeners = {};

  globalThis.window = {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    AudioContext: StrictAudioContext,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => globalThis.cancelAnimationFrame(id),
    addEventListener: (t, fn) => {
      if (!windowListeners[t]) windowListeners[t] = [];
      windowListeners[t].push(fn);
    },
    removeEventListener: (t, fn) => {
      if (windowListeners[t]) {
        windowListeners[t] = windowListeners[t].filter((f) => f !== fn);
      }
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

  const pageBody = new MockElement("body");
  const bodyTag = html.match(/<body([^>]*)>/);
  if (bodyTag) {
    for (const dataMatch of bodyTag[1].matchAll(/\bdata-([a-zA-Z0-9-]+)="([^"]*)"/g)) {
      const camel = dataMatch[1].replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
      pageBody.dataset[camel] = dataMatch[2];
    }
  }

  globalThis.document = {
    hidden: false,
    body: pageBody,
    activeElement: { tagName: "BODY" },
    getElementById: (id) => {
      const el = elementsById.get(id);
      if (!el) {
        if (strictIds) {
          throw new Error(`Element with id "${id}" not found in document`);
        }
        return null;
      }
      return el;
    },
    createElement: (tag) => new MockElement(tag),
    createDocumentFragment: () => new MockElement("fragment"),
    querySelector: (sel) => allElements.find((el) => matchesSelector(el, sel)) || null,
    querySelectorAll: (sel) => allElements.filter((el) => matchesSelector(el, sel)),
    addEventListener: (t, fn) => {
      if (!docListeners[t]) docListeners[t] = [];
      docListeners[t].push(fn);
    },
    removeEventListener: (t, fn) => {
      if (docListeners[t]) {
        docListeners[t] = docListeners[t].filter((f) => f !== fn);
      }
    },
    dispatchEvent: (type, extra = {}) => {
      const evt = {
        type,
        target: globalThis.document,
        currentTarget: globalThis.document,
        preventDefault() {},
        ...extra,
      };
      for (const fn of docListeners[type] || []) {
        fn(evt);
      }
    },
    contains: (node) => {
      if (!node) return false;
      if (node.isConnected === false) return false;
      return true;
    },
  };

  let rafSeq = 1;
  const rafCallbacks = new Map();

  globalThis.requestAnimationFrame = (cb) => {
    const id = rafSeq++;
    rafCallbacks.set(id, cb);
    if (rafQueue.length < 32) {
      rafQueue.push(id);
    }
    if (resolveBoot) {
      resolveBoot();
      resolveBoot = null;
    }
    return id;
  };

  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
    const idx = rafQueue.indexOf(id);
    if (idx !== -1) {
      rafQueue.splice(idx, 1);
    }
  };

  globalThis.fetch = async (relUrl) => {
    const clean = relUrl.replace(/^\.\//, "");
    const full = path.join(rootDir, clean);
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
    allElements,
    audioState,
    scrolledElements,
    bootDone,
    stepAnimationFrame(timestamp) {
      while (rafQueue.length > 0) {
        const item = rafQueue.shift();
        if (typeof item === "function") {
          item(timestamp);
          return true;
        }
        const cb = rafCallbacks.get(item);
        if (cb) {
          rafCallbacks.delete(item);
          cb(timestamp);
          return true;
        }
      }
      return false;
    },
    runAllAnimationFrames(timestamp) {
      let ran = 0;
      while (rafQueue.length > 0) {
        const item = rafQueue.shift();
        if (typeof item === "function") {
          item(timestamp);
          ran++;
        } else {
          const cb = rafCallbacks.get(item);
          if (cb) {
            rafCallbacks.delete(item);
            cb(timestamp);
            ran++;
          }
        }
      }
      return ran;
    },
    async waitForBoot({ timeoutMs = 4000 } = {}) {
      await Promise.race([
        bootDone,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout waiting for boot")), timeoutMs),
        ),
      ]);
      const readyDeadline = Date.now() + timeoutMs;
      const led = elementsById.get("status-led");
      while (led && !led.classList.contains("ready") && Date.now() < readyDeadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    restoreGlobals() {
      for (const id of activeIntervals) {
        prevGlobals.clearInterval(id);
      }
      activeIntervals.clear();
      for (const id of activeTimeouts) {
        prevGlobals.clearTimeout(id);
      }
      activeTimeouts.clear();

      globalThis.setInterval = prevGlobals.setInterval;
      globalThis.clearInterval = prevGlobals.clearInterval;
      globalThis.setTimeout = prevGlobals.setTimeout;
      globalThis.clearTimeout = prevGlobals.clearTimeout;

      globalThis.window = prevGlobals.window;
      globalThis.document = prevGlobals.document;
      if (prevGlobals.navigator) {
        Object.defineProperty(globalThis, "navigator", prevGlobals.navigator);
      } else {
        delete globalThis.navigator;
      }
      globalThis.fetch = prevGlobals.fetch;
      globalThis.requestAnimationFrame = prevGlobals.requestAnimationFrame;
      globalThis.cancelAnimationFrame = prevGlobals.cancelAnimationFrame;
    },
  };
}

export function createFakePlayer(options = {}) {
  let activeGame = options.initialGame || GAME_FILES[0];
  let activeTrack = options.initialTrack || activeGame.tracks[0];
  const isPlaying = options.isPlaying || false;
  let currentSession = buildSessionDescriptor(activeGame, activeTrack);
  const sources = { ...options.sources };
  const assembled = new Map(Object.entries(options.assembled || {}));

  function getOrAssemble(file) {
    if (assembled.has(file)) return assembled.get(file);
    const fullPath = path.resolve(ROOT, file);
    if (fs.existsSync(fullPath)) {
      const src = fs.readFileSync(fullPath, "utf8");
      sources[file] = src;
      const asm = assembleOceanSource(src, { fileName: file });
      assembled.set(file, asm);
      return asm;
    }
    return null;
  }

  getOrAssemble(activeGame.id);

  const ram = new Uint8Array(65536);
  // Default sequence pointers in zero page so PC readouts format valid addresses
  // For Wizball: PC0 at 4, PC1 at 6, PC2 at 8
  ram[4] = 0x00;
  ram[5] = 0x10;
  ram[6] = 0x04;
  ram[7] = 0x10;
  ram[8] = 0x0a;
  ram[9] = 0x10;

  // For Arkanoid: PC0 at 16, PC1 at 18, PC2 at 20
  ram[16] = 0x03;
  ram[17] = 0x08;
  ram[18] = 0x07;
  ram[19] = 0x08;
  ram[20] = 0x0a;
  ram[21] = 0x08;

  // For Arkadrum seqPC: at 80 ($50)
  ram[80] = 0x00;
  ram[81] = 0x40;

  const sidRegs = new Uint8Array(25);
  const scopeData = new Float32Array(4 * 512);
  const scanlineBorder = new Uint8Array(312);

  const telemetry = {
    frameCount: 1,
    cpuPc: 0x1000,
    d418: 0,
    sidRegs,
    scopeData,
    voices: [
      { freq: 0x1168, pw: 0x800, ctrl: 0x21, env: 0xa0 },
      { freq: 0x0dd4, pw: 0x800, ctrl: 0x41, env: 0x80 },
      { freq: 0x08b4, pw: 0x800, ctrl: 0x11, env: 0x60 },
    ],
    filter: { fc: 0x400, res: 8, rout: 7, mode: 0x10, vol: 15 },
    scanlineBorder,
    ram,
    morseIndex: -1,
    ...options.telemetry,
  };

  const state = {
    isPlaying,
    isFastForward: false,
    sidModel8580: false,
    videoNtsc: false,
    digiBoost: 1.3,
    latencyHint: "playback",
    telemetryHz: 62.5,
    muteMask: 0,
    soloVoice: -1,
  };

  return {
    play() {
      state.isPlaying = true;
    },
    pause() {
      state.isPlaying = false;
    },
    getState() {
      return { ...state };
    },
    selectTrack(gameId, trackId, { autoPlay = true } = {}) {
      const g = GAME_FILES.find((x) => x.id === gameId) || activeGame;
      const t = g.tracks.find((x) => x.id === trackId) || g.tracks[0];
      activeGame = g;
      activeTrack = t;
      currentSession = buildSessionDescriptor(g, t);
      getOrAssemble(g.id);
      if (currentSession.drum.available) {
        getOrAssemble(currentSession.drum.sourceFile);
      }
      if (autoPlay) state.isPlaying = true;
      return currentSession;
    },
    getSession() {
      return currentSession;
    },
    getTelemetry() {
      return telemetry;
    },
    getAssembled(file) {
      return getOrAssemble(file);
    },
    getRawSource(file) {
      if (!sources[file]) {
        const fullPath = path.resolve(ROOT, file);
        if (fs.existsSync(fullPath)) {
          sources[file] = fs.readFileSync(fullPath, "utf8");
        }
      }
      return sources[file] || "";
    },
    updateSource(file, text) {
      if (options.updateSource) {
        return options.updateSource(file, text);
      }
      const asm = assembleOceanSource(text, { fileName: file });
      sources[file] = text;
      assembled.set(file, asm);
      return asm;
    },
    setHardwareOptions(opts) {
      Object.assign(state, opts);
    },
    setLatencyMode(mode) {
      state.latencyHint = mode === "interactive" ? "interactive" : "playback";
      options.onLatencyMode?.(state.latencyHint);
      return Promise.resolve(state.latencyHint);
    },
    setTelemetryHz(hz) {
      state.telemetryHz = resolveTelemetryHz(hz);
      options.onTelemetryHz?.(state.telemetryHz);
      return state.telemetryHz;
    },
    injectKey(code) {
      options.onInjectKey?.(code);
    },
  };
}
