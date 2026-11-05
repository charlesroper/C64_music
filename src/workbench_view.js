// ============================================================================
// Galway 2664 // Ocean 6502-SID Workbench View Module
// Presentation, Telemetry Visualization, Source Rendering & UI Wiring
// ============================================================================

import { C64_CHAR_ROM, VIC_PALETTE_RGBA } from "./c64_charset.js";
import { renderMarkdownToHtml } from "./markdown.js";
import { getSessionSourceFile } from "./player_engine.js";
import { GAME_FILES } from "./tracks_catalog.js";

const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

const VIC_PALETTE_U32 = new Uint32Array(16);
for (let i = 0; i < 16; i++) {
  const [r, g, b, a] = VIC_PALETTE_RGBA[i];
  VIC_PALETTE_U32[i] = (a << 24) | (b << 16) | (g << 8) | r;
}

export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatAsmLineHtml(rawLine) {
  const semi = rawLine.indexOf(";");
  const codePart = semi >= 0 ? rawLine.slice(0, semi) : rawLine;
  const commentPart = semi >= 0 ? rawLine.slice(semi) : "";

  let formattedCode = escapeHtml(codePart);
  if (codePart.length > 0 && !/\s/.test(codePart[0])) {
    formattedCode = formattedCode.replace(/^(\S+)/, '<span class="asm-label">$1</span>');
  }
  formattedCode = formattedCode.replace(
    /\b(ORG|EQU|DFB|DFW|DFL|DFH|DFS|DFM|ENT|INC)\b/g,
    '<span class="asm-directive">$1</span>',
  );

  const formattedComment = commentPart
    ? `<span class="asm-comment">${escapeHtml(commentPart)}</span>`
    : "";

  return formattedCode + formattedComment;
}

let viewerScrollRaf = null;

export function cancelViewerSmoothScroll() {
  if (viewerScrollRaf) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(viewerScrollRaf);
    } else {
      clearTimeout(viewerScrollRaf);
    }
    viewerScrollRaf = null;
  }
}

export function smoothScrollSourceViewer(viewer, targetTop, { instant = false } = {}) {
  cancelViewerSmoothScroll();

  if (instant) {
    viewer.scrollTop = targetTop;
    return;
  }

  const startTop = viewer.scrollTop || 0;
  const distance = targetTop - startTop;
  const absDist = Math.abs(distance);
  if (absDist < 2) return;

  // Adaptive duration:
  // - Small note steps (<= 120px, 1 to 6 lines): 90ms easeOutCubic (keeps pace with 16th notes).
  // - Medium routine leaps (121px to 500px): 130ms.
  // - Long jumps (> 500px, cross-routine or loop returns):
  //   Pre-position within 40px of target and ease the final 40px in 70ms so the viewer
  //   never lags or spends half a second scrolling past hundreds of lines.
  let start = startTop;
  let dist = distance;
  let duration = 90;

  if (absDist > 500) {
    start = targetTop - Math.sign(distance) * 40;
    dist = targetTop - start;
    duration = 70;
    viewer.scrollTop = start;
  } else if (absDist > 120) {
    duration = 130;
  }

  const getNow = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const startTime = getNow();

  const reqRaf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(getNow()), 16);

  function step(now) {
    const currentNow = typeof now === "number" && now > 0 ? now : getNow();
    const elapsed = currentNow - startTime;
    const progress = Math.min(1, Math.max(0, elapsed / duration));
    const ease = 1 - (1 - progress) ** 3;
    viewer.scrollTop = Math.round(start + dist * ease);

    if (progress < 1) {
      viewerScrollRaf = reqRaf(step);
    } else {
      viewerScrollRaf = null;
    }
  }

  viewerScrollRaf = reqRaf(step);
}

export function scrollToSourceLine(
  lineNo,
  { revealMobilePanel = false, instant = false, doc = null, getEl = null } = {},
) {
  const documentObj = doc || (typeof document !== "undefined" ? document : null);
  const findEl = getEl || ((id) => documentObj?.getElementById(id));
  if (revealMobilePanel) {
    const grid = findEl("workbench-grid");
    const currentView = grid?.dataset ? grid.dataset.mobileView : "all";
    if (currentView && currentView !== "all" && currentView !== "asm") {
      if (grid) grid.dataset.mobileView = "asm";
      documentObj?.querySelectorAll?.("[data-mobile-tab]")?.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mobileTab === "asm");
      });
    }
  }
  const el = findEl(`asm-L${lineNo}`);
  const viewer = findEl("source-viewer");
  if (el && viewer && viewer.clientHeight > 0) {
    let top = typeof el.offsetTop === "number" ? el.offsetTop : 0;
    let curr = el.offsetParent;
    while (curr && curr !== viewer && curr !== documentObj?.body && curr != null) {
      top += curr.offsetTop;
      curr = curr.offsetParent;
    }
    const targetTop = Math.max(
      0,
      Math.round(top - viewer.clientHeight / 2 + (el.clientHeight || 18) / 2),
    );
    smoothScrollSourceViewer(viewer, targetTop, { instant });
  } else if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function createDomRegistry(doc, customElements) {
  const cache = new Map();
  return {
    get(id) {
      if (customElements && typeof customElements.get === "function") {
        const customEl = customElements.get(id);
        if (customEl) return customEl;
      }
      let el = cache.get(id);
      if (!el && doc) {
        el = doc.getElementById(id);
        if (el) cache.set(id, el);
      }
      return el;
    },
    has(id) {
      return Boolean(this.get(id));
    },
    clear() {
      cache.clear();
    },
  };
}

export function createWorkbenchView({
  document: doc = typeof document !== "undefined" ? document : null,
  root = null,
  player = null,
  assets = null,
  elements = null,
  onFirstInteraction = null,
} = {}) {
  const win = doc?.defaultView || (typeof window !== "undefined" ? window : globalThis);
  const registry = createDomRegistry(doc, elements);
  const getEl = (id) => registry.get(id);

  const state = {
    player: player || null,
    pendingPlayOnBoot: false,
    directivesText: assets?.directivesText || "",
    narrativeText: assets?.narrativeText || "",

    activeGameId: "wizball.asm",
    activeTrackId: "wiz-title",
    currentSession: null,
    currentSourceFile: "wizball.asm",
    activeFilter: "all",

    sidModel8580: false,
    videoNtsc: false,
    digiBoost: 1.3,

    muteMask: 0,
    soloVoice: -1,

    followPc: false,
    followVoice: 0,
    lastFollowedLine: 0,
    lastFollowedVoiceCls: null,
    isEditingSource: false,
    isEditorDirty: false,
    prevHighlightedLines: [],
    sourceHtmlCache: new Map(),
    sourceRowCache: new Map(),
  };

  if (typeof window !== "undefined") {
    window.__workbenchState = state;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.__workbenchState = state;
  }

  let c64Canvas = null;
  let c64Ctx = null;
  let c64ImgData = null;
  let c64Pixels32 = null;

  function ensureC64ScreenCanvas() {
    if (c64Pixels32) return true;
    c64Canvas = getEl("c64-monitor-canvas");
    if (!c64Canvas || typeof c64Canvas.getContext !== "function") return false;
    c64Ctx = c64Canvas.getContext("2d");
    if (!c64Ctx) return false;
    c64ImgData = c64Ctx.createImageData(384, 272);
    c64Pixels32 = new Uint32Array(c64ImgData.data.buffer);
    return true;
  }

  const domCache = {
    telFrame: null,
    telPc: null,
    telD418: null,
    sidCells: null,
    voices: null,
    fltMode: null,
    fltFc: null,
    fltRes: null,
    fltRout: null,
    fltVol: null,
    fltGrp: null,
    seqPc: null,
    grid: null,
    viewer: null,
  };

  function isNodeConnected(node) {
    if (!node) return false;
    if (typeof node.isConnected === "boolean") return node.isConnected;
    if (doc && typeof doc.contains === "function") return doc.contains(node);
    return true;
  }

  function getDom() {
    if (!domCache.telFrame || !isNodeConnected(domCache.telFrame)) {
      domCache.telFrame = getEl("tel-frame");
      domCache.telPc = getEl("tel-pc");
      domCache.telD418 = getEl("tel-d418");
      domCache.sidCells = null;
      lastSidRegs.fill(-1);
      domCache.voices = [0, 1, 2].map((v) => ({
        note: getEl(`v${v}-note`),
        wf: getEl(`v${v}-wf`),
        pw: getEl(`v${v}-pw`),
        adsr: getEl(`v${v}-adsr`),
        env: getEl(`v${v}-env`),
        pc: getEl(`v${v}-pc`),
        grp: getEl(`sid-group-v${v}`),
      }));
      domCache.fltMode = getEl("filter-mode-tag");
      domCache.fltFc = getEl("flt-fc");
      domCache.fltRes = getEl("flt-res");
      domCache.fltRout = getEl("flt-rout");
      domCache.fltVol = getEl("flt-vol");
      domCache.fltGrp = getEl("sid-group-flt");
      domCache.seqPc = getEl("seq-pc");
      domCache.grid = getEl("workbench-grid");
      domCache.viewer = getEl("source-viewer");
    }
    if (!domCache.sidCells) {
      domCache.sidCells = Array.from({ length: 25 }, (_, i) => getEl(`sid-reg-${i}`));
    }
    return domCache;
  }

  const scopeCache = {};
  function getScopeCanvas(id) {
    if (!scopeCache[id]) {
      const c = getEl(id);
      if (c && typeof c.getContext === "function") {
        scopeCache[id] = { canvas: c, ctx: c.getContext("2d") };
      }
    }
    return scopeCache[id];
  }

  const lastSidRegs = new Int16Array(25).fill(-1);
  const lastTelemetryText = {
    frame: null,
    pc: null,
    d418: null,
    seqPc: null,
  };
  const lastFilterText = {
    mode: null,
    fc: null,
    res: null,
    rout: null,
    vol: null,
  };
  const lastVoiceText = [
    { note: null, wf: null, pw: null, adsr: null, env: null, pc: null },
    { note: null, wf: null, pw: null, adsr: null, env: null, pc: null },
    { note: null, wf: null, pw: null, adsr: null, env: null, pc: null },
  ];
  const lastVoiceActive = [null, null, null];
  let lastFilterActive = null;

  let lastRenderedFrame = -1;
  let lastRenderedSessionId = null;
  let lastWasPlaying = false;

  function resetTelemetryCaches() {
    lastSidRegs.fill(-1);
    lastTelemetryText.frame = null;
    lastTelemetryText.pc = null;
    lastTelemetryText.d418 = null;
    lastTelemetryText.seqPc = null;
    lastFilterText.mode = null;
    lastFilterText.fc = null;
    lastFilterText.res = null;
    lastFilterText.rout = null;
    lastFilterText.vol = null;
    for (let v = 0; v < 3; v++) {
      lastVoiceText[v].note = null;
      lastVoiceText[v].wf = null;
      lastVoiceText[v].pw = null;
      lastVoiceText[v].adsr = null;
      lastVoiceText[v].env = null;
      lastVoiceText[v].pc = null;
      lastVoiceActive[v] = null;
    }
    lastFilterActive = null;
    lastMorseActiveIndex = -1;
    lastRenderedFrame = -1;
  }

  function renderC64Monitor(ram, scanlineBorder) {
    if (!ensureC64ScreenCanvas() || !scanlineBorder || !ram) return;

    for (let y = 0; y < 272; y++) {
      const vicLine = y + 20;
      const bdrColorIdx = scanlineBorder[vicLine] & 0x0f;
      const bdrPixel = VIC_PALETTE_U32[bdrColorIdx];
      const inScreenY = y >= 36 && y < 236;
      const screenY = y - 36;
      const textRow = screenY >> 3;
      const charRow = screenY & 7;

      const dstIdx = y * 384;

      if (!inScreenY) {
        for (let x = 0; x < 384; x++) {
          c64Pixels32[dstIdx + x] = bdrPixel;
        }
        continue;
      }

      for (let x = 0; x < 32; x++) {
        c64Pixels32[dstIdx + x] = bdrPixel;
      }

      const rowBase = textRow * 40;
      let pixelOffset = dstIdx + 32;
      for (let col = 0; col < 40; col++) {
        const charCode = ram[0x0400 + rowBase + col];
        const fgColorIdx = ram[0xd800 + rowBase + col] & 0x0f;
        const fgPixel = VIC_PALETTE_U32[fgColorIdx];
        const glyphByte = C64_CHAR_ROM[charCode * 8 + charRow];

        for (let bit = 7; bit >= 0; bit--) {
          c64Pixels32[pixelOffset++] = (glyphByte >> bit) & 1 ? fgPixel : 0xff000000;
        }
      }

      for (let x = 0; x < 32; x++) {
        c64Pixels32[pixelOffset + x] = bdrPixel;
      }
    }

    c64Ctx.putImageData(c64ImgData, 0, 0);
  }

  function sidFreqToNoteString(freqReg) {
    if (freqReg < 100) return "---";
    const clock = state.videoNtsc ? 1022727 : 985248;
    const hz = (freqReg * clock) / 16777216;
    if (hz < 16) return "---";
    const midi = Math.round(12 * Math.log2(hz / 440) + 69);
    if (midi < 12 || midi > 119) return `${Math.round(hz)}Hz`;
    const note = NOTE_NAMES[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${note}${oct} (${Math.round(hz)}Hz)`;
  }

  function decodeControlWaveforms(ctrl) {
    const tags = [];
    if (ctrl & 0x10) tags.push("TRI");
    if (ctrl & 0x20) tags.push("SAW");
    if (ctrl & 0x40) tags.push("PUL");
    if (ctrl & 0x80) tags.push("NOI");
    if (ctrl & 0x04) tags.push("RNG");
    if (ctrl & 0x02) tags.push("SYN");
    if (tags.length === 0) return "OFF";
    return tags.join("+");
  }

  function drawVoiceScope(canvasId, scopeData, chOffset, colorHex) {
    const cached = getScopeCanvas(canvasId);
    if (!cached) return;
    const { canvas, ctx } = cached;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#080b11";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#161f30";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const base = chOffset * 512;
    let trigger = 0;
    for (let i = 1; i < 200; i++) {
      if (scopeData[base + i - 1] < 0 && scopeData[base + i] >= 0) {
        trigger = i;
        break;
      }
    }

    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const samplesToDraw = 256;
    for (let i = 0; i < samplesToDraw; i++) {
      const sample = scopeData[base + ((trigger + i) & 511)];
      const x = (i / (samplesToDraw - 1)) * w;
      const y = h / 2 - sample * (h * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawMasterAndFilterScope(scopeData, fcReg, resReg, modeBits) {
    const cached = getScopeCanvas("scope-master");
    if (!cached) return;
    const { canvas, ctx } = cached;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#080b11";
    ctx.fillRect(0, 0, w, h);

    const normCutoff = Math.min(1, Math.max(0.05, fcReg / 2047));
    const resPeak = (resReg / 15) * 0.38;

    ctx.fillStyle = "rgba(69, 240, 139, 0.10)";
    ctx.strokeStyle = "rgba(69, 240, 139, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, h);

    for (let x = 0; x <= w; x += 3) {
      const f = x / w;
      let gain = 0.2;
      const dist = f - normCutoff;
      const bell = Math.exp(-(dist * dist) / 0.008) * resPeak;

      if (modeBits === 0) {
        gain = 0.5;
      } else {
        let resp = 0;
        if (modeBits & 0x10) {
          resp = Math.max(resp, f <= normCutoff ? 0.55 : 0.55 * Math.exp(-((f - normCutoff) * 9)));
        }
        if (modeBits & 0x20) {
          resp = Math.max(resp, 0.55 * Math.exp(-(dist * dist) / 0.025));
        }
        if (modeBits & 0x40) {
          resp = Math.max(resp, f >= normCutoff ? 0.55 : 0.55 * Math.exp(-((normCutoff - f) * 9)));
        }
        gain = Math.min(0.92, resp + bell);
      }

      const y = h - gain * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const base = 3 * 512;
    ctx.strokeStyle = "#45f08b";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const sample = scopeData[base + i];
      const x = (i / 255) * w;
      const y = h / 2 - sample * (h * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function renderGameMetaCard(game) {
    const card = getEl("game-meta-card");
    if (!card) return;
    card.innerHTML = `
      <div><strong>File:</strong> ${game.id} (${game.date})</div>
      <div><strong>Memory Map:</strong> ${game.architecture.org}</div>
      <div><strong>Zero Page:</strong> ${game.architecture.zeroPage}</div>
      <div style="margin-top:4px;">${game.summary}</div>
    `;
  }

  function renderGameList() {
    const container = getEl("game-list");
    if (!container) return;
    container.innerHTML = "";

    for (const game of GAME_FILES) {
      const div = doc.createElement("div");
      div.className = `game-item${game.id === state.activeGameId ? " active" : ""}`;
      div.innerHTML = `
        <div class="game-item-left">
          <span class="game-item-title">${game.title} (${game.year})</span>
          <span class="game-item-file">${game.id}</span>
        </div>
        <span class="game-item-badge">${game.badge}</span>
      `;
      div.addEventListener("click", () => {
        selectGameAndTrack(game.id, game.tracks[0].id, true);
      });
      container.appendChild(div);
    }
  }

  function renderTrackList() {
    const container = getEl("track-list");
    if (!container) return;
    container.innerHTML = "";

    const game = GAME_FILES.find((g) => g.id === state.activeGameId);
    if (!game) return;

    const filtered = game.tracks.filter((t) => {
      if (state.activeFilter === "all") return true;
      return t.category === state.activeFilter;
    });

    for (const track of filtered) {
      const div = doc.createElement("div");
      div.className = `track-item${track.id === state.activeTrackId ? " active" : ""}`;

      const hzClass = track.hz === 200 ? "hz-200" : track.hz === 100 ? "hz-100" : "hz-50";
      const hzText = track.withDrums ? `${track.hz}Hz + DIGI` : `${track.hz}Hz`;
      const keyBadge = track.key ? `<span class="t-badge key-tag">KEY [${track.key}]</span>` : "";
      const durBadge = track.durationHint
        ? `<span class="t-badge">${track.durationHint}</span>`
        : "";

      div.innerHTML = `
        <div class="track-row-top">
          <span class="track-name">${track.name}</span>
          <div class="track-badges">
            ${keyBadge}
            <span class="t-badge ${hzClass}">${hzText}</span>
            ${durBadge}
          </div>
        </div>
        <div class="track-desc">${track.description}</div>
      `;

      div.addEventListener("click", () => {
        selectGameAndTrack(game.id, track.id, true);
      });
      container.appendChild(div);
    }
  }

  function renderKeypadButtons() {
    const container = getEl("c64-keypad-buttons");
    if (!container) return;
    const keys = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "+", "-", "@", "*", "RET"];
    container.innerHTML = "";
    for (const k of keys) {
      const btn = doc.createElement("button");
      btn.className = "key-btn";
      btn.textContent = k;
      btn.title =
        k === "RET"
          ? "Inject RETURN (13) to cycle channel mask RF"
          : k === "+" || k === "-"
            ? `Inject '${k}' to adjust Refsp refresh speed`
            : k === "@"
              ? "Inject '@' for 200Hz ($0100) speed"
              : k === "*"
                ? "Inject '*' for $0001 slow-motion inspection"
                : `Inject key '${k}' into C64 driver ($F13E / KeyScan)`;
      btn.addEventListener("click", () => {
        if (!state.player) return;
        if (!state.player.getState().isPlaying) setPlaying(true);
        const code = k === "RET" ? 13 : k.charCodeAt(0);
        state.player.injectKey(code);
      });
      container.appendChild(btn);
    }
  }

  function renderSidHexStripSkeleton() {
    const container = getEl("sid-hex-cells");
    if (!container) return;
    container.innerHTML = "";

    const groups = [
      { id: "v0", label: "V1", start: 0, count: 7, cls: "v0" },
      { id: "v1", label: "V2", start: 7, count: 7, cls: "v1" },
      { id: "v2", label: "V3", start: 14, count: 7, cls: "v2" },
      { id: "flt", label: "FLT", start: 21, count: 4, cls: "flt" },
    ];

    const regNames = [
      "V1 Freq Lo",
      "V1 Freq Hi",
      "V1 PW Lo",
      "V1 PW Hi",
      "V1 Ctrl",
      "V1 Att/Dec",
      "V1 Sus/Rel",
      "V2 Freq Lo",
      "V2 Freq Hi",
      "V2 PW Lo",
      "V2 PW Hi",
      "V2 Ctrl",
      "V2 Att/Dec",
      "V2 Sus/Rel",
      "V3 Freq Lo",
      "V3 Freq Hi",
      "V3 PW Lo",
      "V3 PW Hi",
      "V3 Ctrl",
      "V3 Att/Dec",
      "V3 Sus/Rel",
      "Flt Cut Lo",
      "Flt Cut Hi",
      "Flt Res/Route",
      "Mode / Vol",
    ];

    for (const g of groups) {
      const grpEl = doc.createElement("div");
      grpEl.className = `sid-hex-group ${g.cls}`;
      grpEl.id = `sid-group-${g.id}`;

      const tag = doc.createElement("span");
      tag.className = "sid-group-tag";
      tag.textContent = g.label;
      grpEl.appendChild(tag);

      const cellsWrap = doc.createElement("div");
      cellsWrap.className = "sid-group-cells";

      for (let i = g.start; i < g.start + g.count; i++) {
        const span = doc.createElement("span");
        span.className = `sid-cell ${g.cls}`;
        span.id = `sid-reg-${i}`;
        const hex = i.toString(16).toUpperCase().padStart(2, "0");
        span.title = `$D4${hex}: ${regNames[i]}`;
        span.textContent = "00";
        cellsWrap.appendChild(span);
      }

      grpEl.appendChild(cellsWrap);
      container.appendChild(grpEl);
    }
    domCache.sidCells = null;
    lastSidRegs.fill(-1);
  }

  function setFollowVoice(voice, forceFollow = false) {
    state.followVoice = voice;
    state.lastFollowedLine = 0;
    state.lastFollowedVoiceCls = null;
    const chips = doc.querySelectorAll ? doc.querySelectorAll(".legend-chip") : [];
    chips.forEach((chip) => {
      chip.classList.toggle("active-followed", chip.dataset.voice === String(voice));
    });

    if (forceFollow) {
      const chkFollow = getEl("chk-follow-pc");
      if (chkFollow) {
        chkFollow.checked = true;
      }
      state.followPc = true;
    }

    if (state.currentSession) {
      const targetFile = getSessionSourceFile(state.currentSession, voice);
      if (state.currentSourceFile !== targetFile) {
        renderSource(targetFile);
      }
    }

    if (state.prevHighlightedLines && state.prevHighlightedLines.length > 0) {
      updateLiveSourceHighlights(state.prevHighlightedLines);
    }

    if (state.player?.getState().isPlaying && state.prevHighlightedLines) {
      const targetCls = voice === "seq" ? "pc-seq" : `pc-v${voice}`;
      const targetLine = state.prevHighlightedLines.find((al) => al.cls === targetCls);
      if (targetLine) {
        state.lastFollowedLine = targetLine.lineNo;
        scrollToSourceLine(targetLine.lineNo, { doc, getEl });
      }
    }
  }

  function updateDrmChipState() {
    const drmChip = doc.querySelector ? doc.querySelector('.legend-chip[data-voice="seq"]') : null;
    if (!drmChip) return;
    const session = state.currentSession || state.player?.getSession();
    const hasDrums = Boolean(session?.drum.available);

    drmChip.classList.toggle("disabled", !hasDrums);
    drmChip.title = hasDrums ? "Follow Drum Sequencer (seqPC)" : "No drum sequencer in this song";

    if (!hasDrums && state.followVoice === "seq") {
      setFollowVoice(0);
    }
  }

  function renderHudGuideOverlay() {
    const overlay = getEl("hud-guide-overlay");
    if (!overlay) return;
    const chkHud = getEl("chk-hud-overlay");
    if (chkHud) {
      overlay.classList.toggle("hidden", !chkHud.checked);
    }
    const rows = [
      { row: 0, text: "ROW 0: ZER0 ($10-$2F) PC0..2, CLOCK0..2" },
      { row: 0, text: "SPEED (Refsp) & CH (YYY)", right: true },
      { row: 1, text: "ROW 1: TIMER (MM-SS-FF)" },
      { row: 3, text: "ROW 3: D0 (Voice 1 Datablock)" },
      { row: 6, text: "ROW 6: D1 (Voice 2 Datablock)" },
      { row: 9, text: "ROW 9: D2 (Voice 3 Datablock)" },
      { row: 12, text: "ROW 12: CUTST (Filter State)" },
      { row: 15, text: "ROW 15: S0 (Voice 1 Soundblock)" },
      { row: 17, text: "ROW 17: S1 (Voice 2 Soundblock)" },
      { row: 19, text: "ROW 19: S2 (Voice 3 Soundblock)" },
      { row: 21, text: "ROW 21: CUT (Filter Envelope)" },
      { row: 24, text: "ROW 24: IDRT & MFL0..2 Flags" },
    ];

    overlay.innerHTML = "";
    for (const r of rows) {
      const tag = doc.createElement("div");
      tag.className = `hud-tag${r.right ? " right" : ""}`;
      const topPct = ((36 + r.row * 8) / 272) * 100;
      tag.style.top = `${topPct.toFixed(2)}%`;
      tag.textContent = r.text;
      overlay.appendChild(tag);
    }
  }

  let lastMorseActiveIndex = -1;

  function renderMorseStream(activeIndex) {
    if (activeIndex === lastMorseActiveIndex) return;
    lastMorseActiveIndex = activeIndex;

    const game = GAME_FILES.find((g) => g.id === "rambload.asm");
    if (!game?.morseSecret) return;
    const secret = game.morseSecret;
    const container = getEl("morse-stream");
    const readout = getEl("morse-state-readout");
    if (!container || !readout) return;

    let html = "";
    for (let i = 0; i < secret.length; i++) {
      const cls =
        i < activeIndex
          ? "morse-char done"
          : i === activeIndex
            ? "morse-char current"
            : "morse-char";
      html += `<span class="${cls}">${secret[i]}</span>`;
    }
    container.innerHTML = html;
    if (activeIndex < secret.length) {
      readout.textContent = `CHAR ${activeIndex + 1}/${secret.length}: '${secret[activeIndex]}'`;
    } else {
      readout.textContent = "TRANSMISSION COMPLETE (LEAD MELODY ACTIVE)";
    }
  }

  function setMobileView(view) {
    const grid = getEl("workbench-grid");
    if (grid) {
      grid.dataset.mobileView = view;
    }
    const tabButtons = doc.querySelectorAll ? doc.querySelectorAll("[data-mobile-tab]") : [];
    tabButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mobileTab === view);
    });
  }

  function renderSource(gameId, _options = {}) {
    if (!state.player) return;
    const asm = state.player.getAssembled(gameId);
    if (!asm) return;

    state.currentSourceFile = gameId;

    const titleEl = getEl("source-file-title");
    if (titleEl) {
      titleEl.textContent = `5. OCEAN 1987 SOURCE: ${gameId.toUpperCase()}`;
    }
    const statsEl = getEl("source-stats");
    if (statsEl) {
      statsEl.textContent = `${asm.rawLines.length} lines | ${Object.keys(asm.symbols).length} symbols`;
    }

    const symSelect = getEl("select-symbol-jump");
    if (symSelect) {
      symSelect.innerHTML = `<option value="">Jump to Symbol / Label (${Object.keys(asm.symbols).length})...</option>`;
      const sortedSyms = Object.entries(asm.symbols)
        .filter(([k]) => !/^N\d\d$/.test(k))
        .sort((a, b) => a[0].localeCompare(b[0]));

      for (const [name, val] of sortedSyms) {
        const opt = doc.createElement("option");
        opt.value = name;
        opt.textContent = `${name} ($${(val & 0xffff).toString(16).toUpperCase().padStart(4, "0")})`;
        symSelect.appendChild(opt);
      }
    }

    const viewer = getEl("source-viewer");
    if (viewer) {
      let cached = state.sourceRowCache.get(gameId);
      if (!cached) {
        const rows = [];
        let html = "";
        for (let i = 0; i < asm.rawLines.length; i++) {
          const lineNo = i + 1;
          const addr = asm.lineAddresses[lineNo];
          const addrHex =
            addr !== undefined && addr >= 0
              ? `$${addr.toString(16).toUpperCase().padStart(4, "0")}`
              : "";

          const rowHtml = `<span class="ln-num">${lineNo}</span><span class="ln-addr">${addrHex}</span><span class="ln-code">${formatAsmLineHtml(asm.rawLines[i])}</span>`;
          html += `<div class="asm-line" id="asm-L${lineNo}">${rowHtml}</div>`;

          const row = doc.createElement("div");
          row.className = "asm-line";
          row.id = `asm-L${lineNo}`;
          row.innerHTML = rowHtml;
          rows.push(row);
        }
        cached = { rows, html };
        state.sourceRowCache.set(gameId, cached);
        state.sourceHtmlCache.set(gameId, html);
      }
      viewer.innerHTML = "";
      for (const r of cached.rows) {
        viewer.appendChild(r);
      }
    }

    const editor = getEl("source-editor");
    if (editor && !state.isEditingSource && !state.isEditorDirty) {
      editor.value = state.player.getRawSource(gameId);
    }
    state.prevHighlightedLines = [];
  }

  function renderTelemetry(tel) {
    if (!tel) return;
    const session = state.currentSession || state.player?.getSession();
    const ram = tel.ram;
    const currentFile = state.currentSourceFile || (session ? session.sourceFile : null);
    const currentAsm = state.player && currentFile ? state.player.getAssembled(currentFile) : null;
    const d = getDom();

    if (tel.morseIndex >= 0) {
      renderMorseStream(tel.morseIndex);
    }

    const isMonitorVisible =
      !d.grid?.dataset?.mobileView ||
      d.grid.dataset.mobileView === "all" ||
      d.grid.dataset.mobileView === "monitor";

    if (isMonitorVisible && ram) {
      renderC64Monitor(ram, tel.scanlineBorder);
    }

    if (d.telFrame && lastTelemetryText.frame !== tel.frameCount) {
      lastTelemetryText.frame = tel.frameCount;
      d.telFrame.textContent = tel.frameCount;
    }
    if (d.telPc && lastTelemetryText.pc !== tel.cpuPc) {
      lastTelemetryText.pc = tel.cpuPc;
      d.telPc.textContent = `$${tel.cpuPc.toString(16).toUpperCase().padStart(4, "0")}`;
    }
    if (d.telD418 && lastTelemetryText.d418 !== tel.d418) {
      lastTelemetryText.d418 = tel.d418;
      d.telD418.textContent = tel.d418;
    }

    const sidRegs = tel.sidRegs;
    if (sidRegs) {
      for (let i = 0; i <= 0x18; i++) {
        if (lastSidRegs[i] !== sidRegs[i]) {
          lastSidRegs[i] = sidRegs[i];
          const cell = d.sidCells[i];
          if (cell) {
            cell.textContent = sidRegs[i].toString(16).toUpperCase().padStart(2, "0");
          }
        }
      }
    }

    const scopeData = tel.scopeData;
    const colors = ["#38e2ff", "#ff56b1", "#ffaa00"];
    const game = GAME_FILES.find((g) => g.id === state.activeGameId);
    const pcSyms = game ? game.architecture.pcSymbols : ["PC0", "PC1", "PC2"];
    const activeLines = [];

    if (tel.voices) {
      for (let v = 0; v < 3; v++) {
        const voice = tel.voices[v];
        const freq = voice.freq;
        const pw = voice.pw;
        const ctrl = voice.ctrl;
        const env = voice.env;
        const ad = sidRegs ? sidRegs[v * 7 + 5] : 0;
        const sr = sidRegs ? sidRegs[v * 7 + 6] : 0;

        const vDom = d.voices[v];
        const noteStr = sidFreqToNoteString(freq);
        if (vDom.note && lastVoiceText[v].note !== noteStr) {
          lastVoiceText[v].note = noteStr;
          vDom.note.textContent = noteStr;
        }
        const wfStr = decodeControlWaveforms(ctrl);
        if (vDom.wf && lastVoiceText[v].wf !== wfStr) {
          lastVoiceText[v].wf = wfStr;
          vDom.wf.textContent = wfStr;
        }
        const pwStr = `$${pw.toString(16).toUpperCase().padStart(3, "0")}`;
        if (vDom.pw && lastVoiceText[v].pw !== pwStr) {
          lastVoiceText[v].pw = pwStr;
          vDom.pw.textContent = pwStr;
        }
        const adsrStr = `${ad.toString(16).toUpperCase().padStart(2, "0")}/${sr.toString(16).toUpperCase().padStart(2, "0")}`;
        if (vDom.adsr && lastVoiceText[v].adsr !== adsrStr) {
          lastVoiceText[v].adsr = adsrStr;
          vDom.adsr.textContent = adsrStr;
        }
        const envStr = env.toString(16).toUpperCase().padStart(2, "0");
        if (vDom.env && lastVoiceText[v].env !== envStr) {
          lastVoiceText[v].env = envStr;
          vDom.env.textContent = envStr;
        }

        if (isMonitorVisible && scopeData) {
          drawVoiceScope(`scope-v${v}`, scopeData, v, colors[v]);
        }

        const isVoiceActive = env > 0 || (ctrl & 0x01) !== 0;
        if (vDom.grp && lastVoiceActive[v] !== isVoiceActive) {
          lastVoiceActive[v] = isVoiceActive;
          vDom.grp.classList.toggle("active", isVoiceActive);
        }

        const symSource =
          (state.player && session && state.player.getAssembled(session.sourceFile)) || currentAsm;
        if (symSource && pcSyms[v] && symSource.symbols[pcSyms[v]] !== undefined && ram) {
          const zpAddr = symSource.symbols[pcSyms[v]];
          const seqPtr = ram[zpAddr] | (ram[zpAddr + 1] << 8);
          const pcText = `PC${v}: $${seqPtr.toString(16).toUpperCase().padStart(4, "0")}`;
          if (vDom.pc && lastVoiceText[v].pc !== pcText) {
            lastVoiceText[v].pc = pcText;
            vDom.pc.textContent = pcText;
          }
          if (currentAsm?.sourceIndex) {
            const lineNo = currentAsm.sourceIndex.lineForAddress(seqPtr);
            if (lineNo) {
              if (vDom.pc && vDom.pc.dataset.line !== String(lineNo)) {
                vDom.pc.dataset.line = lineNo;
              }
              activeLines.push({ lineNo, cls: `pc-v${v}` });
            }
          }
        }
      }
    }

    const flt = tel.filter;
    if (flt) {
      const fc = flt.fc;
      const res = flt.res;
      const rout = flt.rout;
      const mode = flt.mode;
      const vol = flt.vol;

      const modeTags = [];
      if (mode & 0x10) modeTags.push("LP");
      if (mode & 0x20) modeTags.push("BP");
      if (mode & 0x40) modeTags.push("HP");
      if (mode & 0x80) modeTags.push("3OFF");
      const modeStr = modeTags.length ? modeTags.join("+") : "BYPASS";
      if (d.fltMode && lastFilterText.mode !== modeStr) {
        lastFilterText.mode = modeStr;
        d.fltMode.textContent = modeStr;
      }

      const cutoffHz = Math.round(30 + (fc / 2047) * 10000);
      const fcStr = `$${fc.toString(16).toUpperCase().padStart(3, "0")} (${cutoffHz}Hz)`;
      if (d.fltFc && lastFilterText.fc !== fcStr) {
        lastFilterText.fc = fcStr;
        d.fltFc.textContent = fcStr;
      }
      if (d.fltRes && lastFilterText.res !== res) {
        lastFilterText.res = res;
        d.fltRes.textContent = res;
      }

      const routStr =
        [rout & 1 ? "V1" : "", rout & 2 ? "V2" : "", rout & 4 ? "V3" : ""]
          .filter(Boolean)
          .join("+") || "NONE";
      if (d.fltRout && lastFilterText.rout !== routStr) {
        lastFilterText.rout = routStr;
        d.fltRout.textContent = routStr;
      }
      if (d.fltVol && lastFilterText.vol !== vol) {
        lastFilterText.vol = vol;
        d.fltVol.textContent = vol;
      }

      const isFltActive = vol > 0 && rout > 0;
      if (d.fltGrp && lastFilterActive !== isFltActive) {
        lastFilterActive = isFltActive;
        d.fltGrp.classList.toggle("active", isFltActive);
      }

      if (isMonitorVisible && scopeData) {
        drawMasterAndFilterScope(scopeData, fc, res, mode);
      }
    }

    if (session?.drum.available && ram) {
      const drumAsm = state.player ? state.player.getAssembled(session.drum.sourceFile) : null;
      const drumSym = session.drum.symbol || "seqPC";
      const seqSymAddr =
        drumAsm && drumAsm.symbols && drumAsm.symbols[drumSym] !== undefined
          ? drumAsm.symbols[drumSym]
          : 0x50;
      const seqPtr = ram[seqSymAddr] | (ram[seqSymAddr + 1] << 8);
      const drumText = `DRUM: $${seqPtr.toString(16).toUpperCase().padStart(4, "0")}`;
      if (d.seqPc && lastTelemetryText.seqPc !== drumText) {
        lastTelemetryText.seqPc = drumText;
        d.seqPc.textContent = drumText;
      }
      if (currentAsm?.sourceIndex && currentFile === session.drum.sourceFile) {
        const lineNo = currentAsm.sourceIndex.lineForAddress(seqPtr);
        if (lineNo) {
          if (d.seqPc && d.seqPc.dataset.line !== String(lineNo)) {
            d.seqPc.dataset.line = lineNo;
          }
          activeLines.push({ lineNo, cls: "pc-seq" });
        }
      }
    } else if (d.seqPc && lastTelemetryText.seqPc !== "DRUM: ----") {
      lastTelemetryText.seqPc = "DRUM: ----";
      d.seqPc.textContent = "DRUM: ----";
    }

    updateLiveSourceHighlights(activeLines);
  }

  function updateLiveSourceHighlights(activeLines) {
    const followedCls =
      state.followPc && activeLines.length > 0
        ? state.followVoice === "seq"
          ? "pc-seq"
          : `pc-v${state.followVoice}`
        : null;

    const prevLines = state.prevHighlightedLines || [];
    const linesUnchanged =
      prevLines.length === activeLines.length &&
      state.lastFollowedVoiceCls === followedCls &&
      prevLines.every((p, idx) => {
        const c = activeLines[idx];
        return c && p.lineNo === c.lineNo && p.cls === c.cls;
      });

    if (!linesUnchanged) {
      for (const prev of prevLines) {
        const el = getEl(`asm-L${prev.lineNo}`);
        if (el) {
          el.classList.remove(prev.cls);
          el.classList.remove("pc-followed");
        }
      }
      for (const curr of activeLines) {
        const el = getEl(`asm-L${curr.lineNo}`);
        if (el) {
          el.classList.add(curr.cls);
          if (followedCls && curr.cls === followedCls) {
            el.classList.add("pc-followed");
          }
        }
      }
      state.prevHighlightedLines = activeLines;
      state.lastFollowedVoiceCls = followedCls;
    }

    if (state.followPc && activeLines.length > 0 && state.player?.getState().isPlaying) {
      const targetCls = state.followVoice === "seq" ? "pc-seq" : `pc-v${state.followVoice}`;
      const targetLine = activeLines.find((al) => al.cls === targetCls);
      if (targetLine && targetLine.lineNo !== state.lastFollowedLine) {
        state.lastFollowedLine = targetLine.lineNo;
        scrollToSourceLine(targetLine.lineNo, { doc, getEl });
      }
    }
  }

  function setPlaying(playing) {
    if (state.player) {
      if (playing) state.player.play();
      else state.player.pause();
    }

    const btnPlay = getEl("btn-play");
    const playIcon = getEl("play-icon");
    const playLabel = getEl("play-label");
    const led = getEl("status-led");

    if (playing) {
      if (btnPlay) btnPlay.classList.add("playing");
      if (playIcon) playIcon.innerHTML = "&#10074;&#10074;";
      if (playLabel) playLabel.textContent = "PAUSE";
      if (led) {
        led.classList.remove("ready");
        led.classList.add("playing");
      }
    } else {
      if (btnPlay) btnPlay.classList.remove("playing");
      if (playIcon) playIcon.innerHTML = "&#9654;";
      if (playLabel) playLabel.textContent = "PLAY";
      if (led) {
        led.classList.remove("playing");
        led.classList.add("ready");
      }
    }
  }

  function renderSession(session) {
    if (!session) return;
    resetTelemetryCaches();
    const prevGameId = state.activeGameId;
    state.currentSession = session;
    const { game, track } = session;
    state.activeGameId = game.id;
    state.activeTrackId = track.id;

    renderGameList();
    renderTrackList();
    renderGameMetaCard(game);

    const targetFile = getSessionSourceFile(session, state.followVoice);
    const viewer = getEl("source-viewer");
    const viewerEmpty = !viewer || (viewer.children && viewer.children.length === 0);

    if (prevGameId !== game.id || state.currentSourceFile !== targetFile || viewerEmpty) {
      renderSource(targetFile);
    }

    const morseBanner = getEl("morse-banner");
    if (morseBanner) {
      if (session.morse?.available) {
        morseBanner.classList.remove("hidden");
        renderMorseStream(0);
      } else {
        morseBanner.classList.add("hidden");
      }
    }

    const nowPlaying = getEl("now-playing-pill");
    if (nowPlaying) {
      nowPlaying.textContent = `${game.title}: ${track.name}`;
    }

    updateDrmChipState();
  }

  function selectGameAndTrack(gameId, trackId, autoPlay = true) {
    if (!state.player) return;
    const session = state.player.selectTrack(gameId, trackId, { autoPlay });
    renderSession(session);
    setPlaying(autoPlay);
  }

  function stepTrack(delta) {
    const game = GAME_FILES.find((g) => g.id === state.activeGameId);
    if (!game) return;
    const idx = game.tracks.findIndex((t) => t.id === state.activeTrackId);
    const nextIdx = (idx + delta + game.tracks.length) % game.tracks.length;
    selectGameAndTrack(game.id, game.tracks[nextIdx].id, true);
  }

  function setPlayer(newPlayer) {
    state.player = newPlayer;
    updateDrmChipState();
    renderGameList();
  }

  function setAssets(newAssets) {
    if (newAssets.directivesText) {
      state.directivesText = newAssets.directivesText;
      const dirPre = getEl("directives-pre");
      if (dirPre) dirPre.textContent = state.directivesText;
    }
    if (newAssets.narrativeText) {
      state.narrativeText = newAssets.narrativeText;
      const narrativeBody = getEl("narrative-modal-body");
      if (narrativeBody) {
        narrativeBody.innerHTML = renderMarkdownToHtml(state.narrativeText);
      }
    }
  }

  const attachedListeners = [];
  function addListener(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    attachedListeners.push({ target, type, fn, opts });
  }

  function setupUIHandlers() {
    const btnPlay = getEl("btn-play");
    if (btnPlay) {
      addListener(btnPlay, "click", () => {
        if (!state.player) {
          if (onFirstInteraction) {
            onFirstInteraction();
          }
          state.pendingPlayOnBoot = !state.pendingPlayOnBoot;
          const playLabel = getEl("play-label");
          if (playLabel) {
            playLabel.textContent = state.pendingPlayOnBoot ? "LOADING..." : "PLAY";
          }
          return;
        }
        setPlaying(!state.player.getState().isPlaying);
      });
    }

    const btnRestart = getEl("btn-restart");
    if (btnRestart) {
      addListener(btnRestart, "click", () => {
        selectGameAndTrack(state.activeGameId, state.activeTrackId, true);
      });
    }

    const btnPrev = getEl("btn-prev");
    if (btnPrev) {
      addListener(btnPrev, "click", () => {
        stepTrack(-1);
      });
    }

    const btnNext = getEl("btn-next");
    if (btnNext) {
      addListener(btnNext, "click", () => {
        stepTrack(1);
      });
    }

    const btnFfwd = getEl("btn-ffwd");
    if (btnFfwd) {
      const startFfwd = (e) => {
        if (e?.preventDefault) e.preventDefault();
        if (!state.player) return;
        state.player.setHardwareOptions({ isFastForward: true });
        btnFfwd.classList.add("active");
      };
      const stopFfwd = () => {
        if (!state.player?.getState().isFastForward) return;
        state.player.setHardwareOptions({ isFastForward: false });
        btnFfwd.classList.remove("active");
      };
      addListener(btnFfwd, "pointerdown", startFfwd);
      addListener(btnFfwd, "mousedown", startFfwd);
      addListener(btnFfwd, "touchstart", startFfwd);
      if (win) {
        addListener(win, "pointerup", stopFfwd);
        addListener(win, "mouseup", stopFfwd);
        addListener(win, "touchend", stopFfwd);
      }
    }

    const selectSid = getEl("select-sid-model");
    if (selectSid) {
      addListener(selectSid, "change", (e) => {
        state.sidModel8580 = e.target.value === "8580";
        if (state.player) state.player.setHardwareOptions({ sidModel8580: state.sidModel8580 });
      });
    }

    const selectVideo = getEl("select-video-std");
    if (selectVideo) {
      addListener(selectVideo, "change", (e) => {
        state.videoNtsc = e.target.value === "ntsc";
        if (state.player) state.player.setHardwareOptions({ videoNtsc: state.videoNtsc });
      });
    }

    const sliderDigi = getEl("slider-digi-boost");
    if (sliderDigi) {
      addListener(sliderDigi, "input", (e) => {
        state.digiBoost = parseFloat(e.target.value);
        const valEl = getEl("digi-boost-val");
        if (valEl) valEl.textContent = `${state.digiBoost.toFixed(1)}x`;
        if (state.player) state.player.setHardwareOptions({ digiBoost: state.digiBoost });
      });
    }

    const filterPills = doc.querySelectorAll ? doc.querySelectorAll(".filter-pills .pill") : [];
    filterPills.forEach((pill) => {
      addListener(pill, "click", () => {
        filterPills.forEach((p) => {
          p.classList.remove("active");
        });
        pill.classList.add("active");
        state.activeFilter = pill.dataset.filter;
        renderTrackList();
      });
    });

    const chkHud = getEl("chk-hud-overlay");
    if (chkHud) {
      addListener(chkHud, "change", (e) => {
        const hudOverlay = getEl("hud-guide-overlay");
        if (hudOverlay) hudOverlay.classList.toggle("hidden", !e.target.checked);
      });
    }

    const chkCrt = getEl("chk-crt-scanlines");
    if (chkCrt) {
      addListener(chkCrt, "change", (e) => {
        const crtOverlay = getEl("crt-overlay");
        if (crtOverlay) crtOverlay.classList.toggle("hidden", !e.target.checked);
      });
    }

    const muteButtons = doc.querySelectorAll ? doc.querySelectorAll("[data-mute]") : [];
    muteButtons.forEach((btn) => {
      addListener(btn, "click", () => {
        const ch = parseInt(btn.dataset.mute, 10);
        state.muteMask ^= 1 << ch;
        btn.classList.toggle("active-mute", Boolean(state.muteMask & (1 << ch)));
        const card = btn.closest ? btn.closest(".voice-card") : null;
        if (card && ch < 3) {
          card.classList.toggle("muted", Boolean(state.muteMask & (1 << ch)));
        }
        if (state.player) state.player.setHardwareOptions({ muteMask: state.muteMask });
      });
    });

    const soloButtons = doc.querySelectorAll ? doc.querySelectorAll("[data-solo]") : [];
    soloButtons.forEach((btn) => {
      addListener(btn, "click", () => {
        const ch = parseInt(btn.dataset.solo, 10);
        state.soloVoice = state.soloVoice === ch ? -1 : ch;
        soloButtons.forEach((b) => {
          b.classList.toggle("active-solo", parseInt(b.dataset.solo, 10) === state.soloVoice);
        });
        if (state.player) state.player.setHardwareOptions({ soloVoice: state.soloVoice });
      });
    });

    const mobileTabs = doc.querySelectorAll ? doc.querySelectorAll("[data-mobile-tab]") : [];
    mobileTabs.forEach((btn) => {
      addListener(btn, "click", () => {
        if (btn.dataset.mobileTab) {
          setMobileView(btn.dataset.mobileTab);
        }
      });
    });

    ["v0-pc", "v1-pc", "v2-pc", "seq-pc"].forEach((id) => {
      const pcEl = getEl(id);
      if (pcEl) {
        addListener(pcEl, "click", (e) => {
          if (state.currentSession) {
            const voice = id === "seq-pc" ? "seq" : parseInt(id.slice(1, 2), 10);
            const targetFile = getSessionSourceFile(state.currentSession, voice);
            if (state.currentSourceFile !== targetFile) {
              renderSource(targetFile);
            }
          }
          const ln = parseInt(e.currentTarget.dataset.line || "0", 10);
          if (ln > 0) scrollToSourceLine(ln, { revealMobilePanel: true, doc, getEl });
        });
      }
    });

    const chips = doc.querySelectorAll ? doc.querySelectorAll(".legend-chip") : [];
    chips.forEach((chip) => {
      addListener(chip, "click", (e) => {
        if (e?.preventDefault) e.preventDefault();
        if (e?.stopPropagation) e.stopPropagation();
        if (chip.classList.contains("disabled")) return;
        const voiceAttr = chip.dataset.voice;
        const voice = voiceAttr === "seq" ? "seq" : parseInt(voiceAttr, 10);
        setFollowVoice(voice, true);
      });
    });

    const chkFollow = getEl("chk-follow-pc");
    if (chkFollow) {
      addListener(chkFollow, "change", (e) => {
        state.followPc = e.target.checked;
        state.lastFollowedLine = 0;
        state.lastFollowedVoiceCls = null;
        if (state.prevHighlightedLines && state.prevHighlightedLines.length > 0) {
          updateLiveSourceHighlights(state.prevHighlightedLines);
        }
        if (state.followPc && state.player?.getState().isPlaying && state.prevHighlightedLines) {
          const targetCls = state.followVoice === "seq" ? "pc-seq" : `pc-v${state.followVoice}`;
          const targetLine = state.prevHighlightedLines.find((al) => al.cls === targetCls);
          if (targetLine) {
            state.lastFollowedLine = targetLine.lineNo;
            scrollToSourceLine(targetLine.lineNo, { doc, getEl });
          }
        }
      });
    }

    const syncUiControls = () => {
      const chkF = getEl("chk-follow-pc");
      if (chkF) state.followPc = chkF.checked;

      const chkH = getEl("chk-hud-overlay");
      const hudOverlay = getEl("hud-guide-overlay");
      if (chkH && hudOverlay) {
        hudOverlay.classList.toggle("hidden", !chkH.checked);
      }

      const chkC = getEl("chk-crt-scanlines");
      const crtOverlay = getEl("crt-overlay");
      if (chkC && crtOverlay) {
        crtOverlay.classList.toggle("hidden", !chkC.checked);
      }

      const sDigi = getEl("slider-digi-boost");
      if (sDigi) {
        state.digiBoost = parseFloat(sDigi.value) || 1.3;
        const digiVal = getEl("digi-boost-val");
        if (digiVal) digiVal.textContent = `${state.digiBoost.toFixed(1)}x`;
      }
    };
    syncUiControls();

    const symSelect = getEl("select-symbol-jump");
    if (symSelect) {
      addListener(symSelect, "change", (e) => {
        const symName = e.target.value;
        if (!symName || !state.player) return;
        const currentFile = state.currentSourceFile || state.activeGameId;
        const asm = state.player.getAssembled(currentFile);
        if (!asm?.sourceIndex) return;
        const lineNo = asm.sourceIndex.lineForSymbol(symName);
        if (lineNo > 0) scrollToSourceLine(lineNo, { doc, getEl });
      });
    }

    const searchInput = getEl("input-source-search");
    if (searchInput) {
      addListener(searchInput, "input", (e) => {
        const q = e.target.value;
        if (!state.player) return;
        const currentFile = state.currentSourceFile || state.activeGameId;
        const asm = state.player.getAssembled(currentFile);
        if (!asm?.sourceIndex) return;
        const searchMatches = doc.querySelectorAll
          ? doc.querySelectorAll(".asm-line.search-match")
          : [];
        searchMatches.forEach((el) => {
          el.classList.remove("search-match");
        });
        const matchedLines = asm.sourceIndex.findLines(q);
        for (const lineNo of matchedLines) {
          const el = getEl(`asm-L${lineNo}`);
          if (el) el.classList.add("search-match");
        }
        if (matchedLines.length > 0) {
          scrollToSourceLine(matchedLines[0], { doc, getEl });
        }
      });
    }

    const btnToggleEdit = getEl("btn-toggle-edit");
    const btnReassemble = getEl("btn-reassemble");
    const viewerEl = getEl("source-viewer");
    const editorEl = getEl("source-editor");

    if (viewerEl) {
      addListener(viewerEl, "pointerdown", cancelViewerSmoothScroll, { passive: true });
      addListener(viewerEl, "touchstart", cancelViewerSmoothScroll, { passive: true });
      addListener(viewerEl, "wheel", cancelViewerSmoothScroll, { passive: true });
    }

    if (editorEl) {
      addListener(editorEl, "input", () => {
        state.isEditorDirty = true;
      });
    }

    if (btnToggleEdit && viewerEl && editorEl && btnReassemble) {
      addListener(btnToggleEdit, "click", () => {
        state.isEditingSource = !state.isEditingSource;
        viewerEl.classList.toggle("hidden", state.isEditingSource);
        editorEl.classList.toggle("hidden", !state.isEditingSource);
        btnReassemble.classList.toggle("hidden", !state.isEditingSource);
        btnToggleEdit.textContent = state.isEditingSource ? "VIEW LIVE ASM" : "EDIT .ASM";
      });
    }

    if (btnReassemble && viewerEl && editorEl && btnToggleEdit) {
      addListener(btnReassemble, "click", () => {
        if (!state.player) return;
        const fileToUpdate = state.currentSourceFile || state.activeGameId;
        const editedText = editorEl.value;
        try {
          state.player.updateSource(fileToUpdate, editedText);
          state.sourceHtmlCache.delete(fileToUpdate);
          state.sourceRowCache.delete(fileToUpdate);
        } catch (err) {
          const badge = getEl("asm-compile-badge");
          if (badge) {
            badge.textContent = `ERROR: ${err.message || String(err)}`;
          }
          return;
        }

        state.isEditorDirty = false;
        const badge = getEl("asm-compile-badge");
        if (badge) {
          badge.textContent = "HOT-RELOADED OK";
        }

        state.isEditingSource = false;
        viewerEl.classList.remove("hidden");
        editorEl.classList.add("hidden");
        btnReassemble.classList.add("hidden");
        btnToggleEdit.textContent = "EDIT .ASM";

        renderSource(fileToUpdate);
        selectGameAndTrack(state.activeGameId, state.activeTrackId, true);
      });
    }

    const directivesModal = getEl("directives-modal");
    const btnDirectives = getEl("btn-directives-modal");
    const btnCloseDirectives = getEl("btn-close-modal");

    if (btnDirectives && directivesModal) {
      addListener(btnDirectives, "click", () => directivesModal.classList.remove("hidden"));
    }
    if (btnCloseDirectives && directivesModal) {
      addListener(btnCloseDirectives, "click", () => directivesModal.classList.add("hidden"));
    }
    if (directivesModal) {
      addListener(directivesModal, "click", (e) => {
        if (e.target === directivesModal) directivesModal.classList.add("hidden");
      });
    }

    const narrativeModal = getEl("narrative-modal");
    const btnNarrative = getEl("btn-narrative-modal");
    const btnCloseNarrative = getEl("btn-close-narrative-modal");
    if (btnNarrative && narrativeModal) {
      addListener(btnNarrative, "click", () => narrativeModal.classList.remove("hidden"));
    }
    if (btnCloseNarrative && narrativeModal) {
      addListener(btnCloseNarrative, "click", () => narrativeModal.classList.add("hidden"));
    }
    if (narrativeModal) {
      addListener(narrativeModal, "click", (e) => {
        if (e.target === narrativeModal) narrativeModal.classList.add("hidden");
      });
    }

    const brandLogo = doc.querySelector ? doc.querySelector(".brand-logo") : null;
    if (brandLogo) {
      let sparkleTimer = null;
      const triggerSparkle = () => {
        brandLogo.classList.remove("sparkle-active");
        void brandLogo.offsetWidth;
        brandLogo.classList.add("sparkle-active");
        if (sparkleTimer) clearTimeout(sparkleTimer);
        sparkleTimer = setTimeout(() => {
          brandLogo.classList.remove("sparkle-active");
        }, 1000);
      };

      addListener(brandLogo, "click", triggerSparkle);
      addListener(brandLogo, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerSparkle();
        }
      });

      const intervalId = setInterval(triggerSparkle, 10000);
      const timeoutId = setTimeout(triggerSparkle, 1200);
      cleanups.push(() => {
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        if (sparkleTimer) clearTimeout(sparkleTimer);
      });
    }

    if (win) {
      addListener(win, "keydown", (e) => {
        const active = doc.activeElement;
        const tag = active ? active.tagName : "";
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          tag === "BUTTON" ||
          tag === "A"
        ) {
          return;
        }

        const dirMod = getEl("directives-modal");
        const narMod = getEl("narrative-modal");
        const isModalOpen =
          (dirMod && !dirMod.classList.contains("hidden")) ||
          (narMod && !narMod.classList.contains("hidden")) ||
          Boolean(doc.querySelector?.(".modal-backdrop:not(.hidden)"));
        if (isModalOpen) return;

        if (e.code === "Space") {
          e.preventDefault();
          if (state.player) setPlaying(!state.player.getState().isPlaying);
        } else if (e.key === "[") {
          stepTrack(-1);
        } else if (e.key === "]") {
          stepTrack(1);
        } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
          const ch = parseInt(e.key, 10) - 1;
          const btn = doc.querySelector ? doc.querySelector(`[data-mute="${ch}"]`) : null;
          if (btn) btn.click();
        } else if (/^[a-zA-Z+\-@*]$/.test(e.key)) {
          if (state.player) {
            if (!state.player.getState().isPlaying) setPlaying(true);
            state.player.injectKey(e.key.toUpperCase().charCodeAt(0));
          }
        }
      });
    }
  }

  const cleanups = [];
  setupUIHandlers();
  renderKeypadButtons();
  renderSidHexStripSkeleton();
  renderHudGuideOverlay();
  updateDrmChipState();

  if (state.directivesText) {
    const dirPre = getEl("directives-pre");
    if (dirPre) dirPre.textContent = state.directivesText;
  }
  if (state.narrativeText) {
    const narrativeBody = getEl("narrative-modal-body");
    if (narrativeBody) {
      narrativeBody.innerHTML = renderMarkdownToHtml(state.narrativeText);
    }
  }

  if (win?.innerWidth && win.innerWidth <= 640) {
    const chkHud = getEl("chk-hud-overlay");
    const hudOverlay = getEl("hud-guide-overlay");
    if (chkHud && hudOverlay) {
      chkHud.checked = false;
      hudOverlay.classList.add("hidden");
    }
  }

  if (state.player) {
    renderGameList();
    selectGameAndTrack("wizball.asm", "wiz-title", false);
  }

  let rafId = null;
  let isDestroyed = false;
  let lastFrameTimestamp = 0;
  const MIN_FRAME_INTERVAL_MS = 1000 / 60 - 1; // 60fps throttle target

  function renderFrameLoop(timestamp) {
    if (isDestroyed) return;

    if (win && typeof win.requestAnimationFrame === "function") {
      rafId = win.requestAnimationFrame(renderFrameLoop);
    }

    if (doc?.hidden) {
      return;
    }

    if (typeof timestamp === "number") {
      if (lastFrameTimestamp && timestamp - lastFrameTimestamp < MIN_FRAME_INTERVAL_MS) {
        return;
      }
      lastFrameTimestamp = timestamp;
    }

    if (state.player) {
      const isPlaying = Boolean(state.player.getState().isPlaying);
      const tel = state.player.getTelemetry();
      const sessionId = state.currentSession ? state.currentSession.id : null;

      if (
        !isPlaying &&
        !lastWasPlaying &&
        tel &&
        lastRenderedFrame === tel.frameCount &&
        lastRenderedSessionId === sessionId
      ) {
        return;
      }

      lastWasPlaying = isPlaying;
      if (tel) {
        lastRenderedFrame = tel.frameCount;
        lastRenderedSessionId = sessionId;
        renderTelemetry(tel);
      }
    }
  }

  function handleVisibilityChange() {
    if (!doc.hidden) {
      resetTelemetryCaches();
      if (state.player) {
        const tel = state.player.getTelemetry();
        if (tel) {
          lastRenderedFrame = tel.frameCount;
          lastRenderedSessionId = state.currentSession ? state.currentSession.id : null;
          renderTelemetry(tel);
        }
      }
    }
  }

  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", handleVisibilityChange);
    attachedListeners.push({ target: doc, type: "visibilitychange", fn: handleVisibilityChange });
  }

  if (win && typeof win.requestAnimationFrame === "function") {
    rafId = win.requestAnimationFrame(renderFrameLoop);
  }

  function destroy() {
    isDestroyed = true;
    if (rafId && win && typeof win.cancelAnimationFrame === "function") {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
    cancelViewerSmoothScroll();
    for (const { target, type, fn, opts } of attachedListeners) {
      if (target && typeof target.removeEventListener === "function") {
        target.removeEventListener(type, fn, opts);
      }
    }
    attachedListeners.length = 0;
    for (const fn of cleanups) {
      fn();
    }
    cleanups.length = 0;
  }

  return {
    state,
    elements: registry,
    renderSession,
    renderTelemetry,
    renderSource,
    renderSidHexStripSkeleton,
    setPlaying,
    setPlayer,
    setAssets,
    selectGameAndTrack,
    stepTrack,
    isPendingPlayOnBoot() {
      return state.pendingPlayOnBoot;
    },
    destroy,
  };
}
