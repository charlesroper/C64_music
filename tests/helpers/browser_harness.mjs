import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
        this.children = [];
      }
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

    const valMatch = attrs.match(/\bvalue="([^"]*)"/);
    if (valMatch) {
      el.value = valMatch[1];
    }

    if (id) {
      if (id === "slider-digi-boost" && !el.value) el.value = "1.3";
      if (id === "select-sid-model" && !el.value) el.value = "6581";
      if (id === "select-video-std" && !el.value) el.value = "pal";
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

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
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

  globalThis.window = {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    AudioContext: StrictAudioContext,
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

  globalThis.document = {
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
  };

  globalThis.requestAnimationFrame = (cb) => {
    if (rafQueue.length < 16) {
      rafQueue.push(cb);
    }
    if (resolveBoot) {
      resolveBoot();
      resolveBoot = null;
    }
    return rafQueue.length;
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
    stepAnimationFrame() {
      const cb = rafQueue.shift();
      if (cb) cb();
      return Boolean(cb);
    },
    runAllAnimationFrames() {
      let ran = 0;
      while (rafQueue.length > 0) {
        const cb = rafQueue.shift();
        if (cb) {
          cb();
          ran++;
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
    },
  };
}
