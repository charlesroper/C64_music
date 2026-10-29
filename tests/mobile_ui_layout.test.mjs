import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Parse CSS into ordered rules with optional @media condition so we can compute
// active cascaded declarations for any viewport (e.g. 375x812 iPhone vs 1440x900 desktop).
function parseStylesheet(cssText) {
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];

  function parseBlocks(src, mediaQuery = null) {
    let i = 0;
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;

      const openBrace = src.indexOf("{", i);
      if (openBrace === -1) break;
      const header = src.slice(i, openBrace).trim();

      let depth = 1;
      let j = openBrace + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(openBrace + 1, j - 1);

      if (header.startsWith("@media")) {
        const cond = header.replace(/^@media\s+/, "").trim();
        parseBlocks(body, cond);
      } else if (!header.startsWith("@")) {
        const decls = {};
        for (const stmt of body.split(";")) {
          const colon = stmt.indexOf(":");
          if (colon === -1) continue;
          const prop = stmt.slice(0, colon).trim().toLowerCase();
          const val = stmt
            .slice(colon + 1)
            .replace(/!important/gi, "")
            .trim();
          if (prop) decls[prop] = val;
        }
        for (const rawSel of header.split(",")) {
          const sel = rawSel.trim();
          if (sel) rules.push({ selector: sel, mediaQuery, decls });
        }
      }
      i = j;
    }
  }

  parseBlocks(clean, null);
  return rules;
}

function matchesMedia(mediaQuery, { width, height }) {
  if (!mediaQuery) return true;
  const maxW = mediaQuery.match(/\(max-width:\s*(\d+)px\)/);
  if (maxW && !(width <= Number(maxW[1]))) return false;
  const minW = mediaQuery.match(/\(min-width:\s*(\d+)px\)/);
  if (minW && !(width >= Number(minW[1]))) return false;
  const maxH = mediaQuery.match(/\(max-height:\s*(\d+)px\)/);
  if (maxH && !(height <= Number(maxH[1]))) return false;
  const minH = mediaQuery.match(/\(min-height:\s*(\d+)px\)/);
  if (minH && !(height >= Number(minH[1]))) return false;
  return true;
}

function computeStyleForSelector(rules, targetSelectors, viewport) {
  const selectorSet = new Set(
    Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]
  );
  const computed = {};
  for (const rule of rules) {
    if (!matchesMedia(rule.mediaQuery, viewport)) continue;
    if (selectorSet.has(rule.selector)) {
      for (const [k, v] of Object.entries(rule.decls)) {
        if (k === "overflow") {
          computed["overflow"] = v;
          computed["overflow-x"] = v;
          computed["overflow-y"] = v;
        } else {
          computed[k] = v;
        }
      }
    }
  }
  return computed;
}

test("mobile 375x812 CSS cascade enables vertical scrolling, single-column layout, bounded code/track heights, and anti-zoom inputs while preserving 3-column desktop", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const rules = parseStylesheet(css);

  assert.match(
    html,
    /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*"/i,
    "index.html must include responsive viewport meta tag"
  );

  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 375, height: 812 };

  // 1. Desktop keeps studio 3-column viewport lock; mobile unlocks vertical page scroll
  const deskBody = computeStyleForSelector(rules, ["html", "body"], desktop);
  assert.equal(deskBody["overflow-y"], "hidden");

  const mobBody = computeStyleForSelector(rules, ["html", "body"], mobile);
  assert.equal(
    mobBody["overflow-y"],
    "auto",
    "Mobile html/body must allow vertical scrolling (overflow-y: auto)"
  );
  assert.equal(
    mobBody["overflow-x"],
    "hidden",
    "Mobile html/body must prevent horizontal page overflow (overflow-x: hidden)"
  );

  const mobShell = computeStyleForSelector(rules, [".app-shell"], mobile);
  assert.equal(mobShell["height"], "auto", "Mobile .app-shell must allow vertical growth");
  assert.equal(mobShell["width"], "100%", "Mobile .app-shell must use 100% width instead of 100vw");

  // 2. Workbench grid collapses from 3 columns on desktop to 1 column on 375px phone
  const deskGrid = computeStyleForSelector(rules, [".workbench-grid"], desktop);
  assert.match(deskGrid["grid-template-columns"], /320px/);

  const mobGrid = computeStyleForSelector(rules, [".workbench-grid"], mobile);
  assert.ok(
    mobGrid["grid-template-columns"] === "1fr" ||
      mobGrid["grid-template-columns"] === "minmax(0, 1fr)",
    `Mobile .workbench-grid must collapse to a single column, got: ${mobGrid["grid-template-columns"]}`
  );

  // 3. Top bar, transport bar, panel headers, and source toolbar wrap cleanly on 375px phone
  for (const sel of [".top-bar", ".transport-bar", ".panel-header", ".source-toolbar"]) {
    const style = computeStyleForSelector(rules, [sel], mobile);
    assert.equal(
      style["flex-wrap"],
      "wrap",
      `Mobile ${sel} must wrap (flex-wrap: wrap) to prevent off-screen clipping`
    );
  }

  // 4. Scopes grid and modal columns collapse to 1 column on narrow 375px phones
  const mobScopes = computeStyleForSelector(rules, [".scopes-grid"], mobile);
  assert.equal(
    mobScopes["grid-template-columns"],
    "1fr",
    "Narrow mobile .scopes-grid must stack 1fr so voice headers and waveforms fit"
  );

  const mobModalCols = computeStyleForSelector(rules, [".modal-cols"], mobile);
  assert.equal(
    mobModalCols["grid-template-columns"],
    "1fr",
    "Mobile .modal-cols must stack 1fr so assembler docs are readable"
  );

  // 5. Track list and .ASM source viewer have bounded mobile heights (preventing 40,000px scroll)
  const mobTrackList = computeStyleForSelector(rules, [".track-list"], mobile);
  assert.ok(
    mobTrackList["max-height"] && mobTrackList["max-height"] !== "none",
    "Mobile .track-list must set a bounded max-height"
  );

  const mobSourceViewer = computeStyleForSelector(rules, [".source-viewer"], mobile);
  assert.ok(
    mobSourceViewer["height"] || mobSourceViewer["max-height"],
    "Mobile .source-viewer must constrain height so 2,300 .asm lines do not stretch the page"
  );

  // 6. Touch targets (>= 34px) and iOS Safari 16px anti-zoom on inputs/selects
  const mobTransportBtn = computeStyleForSelector(
    rules,
    ["button", ".transport-bar button"],
    mobile
  );
  assert.ok(
    parseInt(mobTransportBtn["min-height"] || "0", 10) >= 36,
    `Mobile transport buttons must be >= 36px tall, got ${mobTransportBtn["min-height"]}`
  );

  const mobKeyBtn = computeStyleForSelector(rules, ["button", ".key-btn"], mobile);
  assert.ok(
    parseInt(mobKeyBtn["min-height"] || "0", 10) >= 34,
    `Mobile C64 keypad buttons must be >= 34px tall, got ${mobKeyBtn["min-height"]}`
  );

  for (const inputSel of [".hw-select", ".symbol-select", ".source-search", ".source-editor"]) {
    const st = computeStyleForSelector(rules, [inputSel], mobile);
    assert.equal(
      st["font-size"],
      "16px",
      `Mobile ${inputSel} should use 16px font-size to prevent iOS Safari auto-zoom on focus`
    );
  }

  // 7. Mobile hardware controls: slider spans full width, docs & story buttons form a 2-up row
  const mobSliderGroup = computeStyleForSelector(rules, ["#hw-group-digi"], mobile);
  assert.equal(
    mobSliderGroup["grid-column"],
    "1 / -1",
    "Mobile #hw-group-digi must span all columns (1 / -1) so the slider fills the entire width"
  );

  const mobDocsBtn = computeStyleForSelector(rules, ["#btn-directives-modal"], mobile);
  const mobStoryBtn = computeStyleForSelector(rules, ["#btn-narrative-modal"], mobile);
  assert.equal(mobDocsBtn["width"], "100%", "Mobile docs button must be width: 100%");
  assert.equal(mobStoryBtn["width"], "100%", "Mobile story button must be width: 100%");
  assert.ok(
    parseInt(mobDocsBtn["min-height"] || "0", 10) >= 36,
    "Mobile docs button must be >= 36px tall"
  );
  assert.ok(
    parseInt(mobStoryBtn["min-height"] || "0", 10) >= 36,
    "Mobile story button must be >= 36px tall"
  );
});

test("booting SPA on a 375px mobile viewport auto-hides crowded HUD tags, exposes mobile view tabs, and switches to ASM tab on PC jump", async () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(
    html,
    /id="mobile-view-tabs"/,
    "index.html must render #mobile-view-tabs for quick mobile panel switching"
  );

  const elementsById = new Map();
  const tabButtons = [];
  const scrolledElements = [];

  class MockElement {
    constructor(tag = "div", id = "") {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.className = "";
      this.textContent = "";
      this._innerHTML = "";
      this.value = "";
      this.checked = id === "chk-hud-overlay" || id === "chk-crt-scanlines";
      this.style = {};
      this.dataset = {};
      this.children = [];
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
    }
    set innerHTML(v) {
      this._innerHTML = v;
      if (v === "") this.children = [];
    }
    get innerHTML() {
      return this._innerHTML;
    }
    appendChild(child) {
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
    scrollIntoView() {
      scrolledElements.push(this.id);
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

  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1];
    const el = new MockElement("div", id);
    if (id === "slider-digi-boost") el.value = "1.3";
    if (id === "select-sid-model") el.value = "6581";
    if (id === "select-video-std") el.value = "pal";
    elementsById.set(id, el);
  }

  for (const m of html.matchAll(/data-mobile-tab="([^"]+)"/g)) {
    const btn = new MockElement("button");
    btn.dataset.mobileTab = m[1];
    if (m[1] === "all") btn.classList.add("active");
    tabButtons.push(btn);
  }

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  let rafCb = null;
  let resolveBoot;
  const bootDone = new Promise((r) => {
    resolveBoot = r;
  });
  globalThis.window = {
    innerWidth: 375,
    innerHeight: 812,
    AudioContext: class {
      constructor() {
        this.sampleRate = 48000;
        this.state = "running";
        this.destination = {};
      }
      resume() {
        return Promise.resolve();
      }
      createBuffer(_c, len, sr) {
        return { length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        return { connect() {}, start() {} };
      }
      createScriptProcessor() {
        return { connect() {} };
      }
    },
    addEventListener: () => {},
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { audioSession: { type: "ambient" } },
    configurable: true,
    writable: true,
  });
  globalThis.document = {
    activeElement: { tagName: "BODY" },
    getElementById: (id) => {
      if (!elementsById.has(id)) elementsById.set(id, new MockElement("div", id));
      return elementsById.get(id);
    },
    createElement: (tag) => new MockElement(tag),
    createDocumentFragment: () => {
      const frag = new MockElement("fragment");
      const origAppend = MockElement.prototype.appendChild;
      frag.appendChild = function (c) {
        if (c.id) elementsById.set(c.id, c);
        this.children.push(c);
        return c;
      };
      void origAppend;
      return frag;
    },
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === "[data-mobile-tab]") return tabButtons;
      return [];
    },
  };
  globalThis.requestAnimationFrame = (cb) => {
    rafCb = cb;
    if (resolveBoot) {
      resolveBoot();
      resolveBoot = null;
    }
    return 1;
  };
  globalThis.fetch = async (url) => {
    const clean = url.replace(/^\.\//, "");
    const buf = fs.readFileSync(path.join(ROOT, clean));
    return {
      ok: true,
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      text: async () => buf.toString("utf8"),
    };
  };

  try {
    const appUrl = new URL(`../src/app.js?t=${Date.now()}-mobile`, import.meta.url);
    await import(appUrl.href);
    await bootDone;
    if (rafCb) rafCb();

    // 1. On 375px phones, HUD Row Guide defaults to hidden so C64 40x25 screen is legible
    assert.equal(elementsById.get("chk-hud-overlay").checked, false);
    assert.equal(elementsById.get("hud-guide-overlay").classList.contains("hidden"), true);

    // 2. Mobile view tabs switch workbench-grid[data-mobile-view]
    const grid = elementsById.get("workbench-grid");
    assert.ok(tabButtons.length >= 4, "Expected mobile tabs (all, monitor, tunes, asm)");

    const monitorTab = tabButtons.find((b) => b.dataset.mobileTab === "monitor");
    monitorTab.click();
    assert.equal(grid.dataset.mobileView, "monitor");

    // 3. Clicking Voice 1 PC tag while on "monitor" tab switches mobileView to "asm" and scrolls
    const v0Pc = elementsById.get("v0-pc");
    assert.ok(Number(v0Pc.dataset.line) > 0, "Expected v0-pc to carry active .asm line number");
    v0Pc.click();
    assert.equal(
      grid.dataset.mobileView,
      "asm",
      "Tapping PC0 tag on mobile monitor view must reveal the ASM panel"
    );
    assert.ok(scrolledElements.length > 0, "Expected scrollIntoView on target ASM line");
  } finally {
    globalThis.window = prevGlobals.window;
    globalThis.document = prevGlobals.document;
    if (prevGlobals.navigator) {
      Object.defineProperty(globalThis, "navigator", prevGlobals.navigator);
    }
    globalThis.fetch = prevGlobals.fetch;
    globalThis.requestAnimationFrame = prevGlobals.requestAnimationFrame;
  }
});
