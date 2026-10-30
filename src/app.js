// ============================================================================
// Galway 64 // Ocean 6502-SID Workbench Main Application
// ============================================================================

import { GAME_FILES } from "./tracks_catalog.js";
import { C64_CHAR_ROM, VIC_PALETTE_RGBA } from "./c64_charset.js";
import { createWorkbenchPlayer } from "./player_engine.js";
import { renderMarkdownToHtml } from "./markdown.js";

const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

const state = {
  player: null,
  preUnlockedAudioCtx: null,
  pendingPlayOnBoot: false,
  directivesText: "",

  activeGameId: "wizball.asm",
  activeTrackId: "wiz-title",
  activeFilter: "all",

  sidModel8580: false,
  videoNtsc: false,
  digiBoost: 1.3,

  muteMask: 0, // bit 0=V1, bit 1=V2, bit 2=V3, bit 3=Digi
  soloVoice: -1,

  followPc: false,
  followVoice: 0,
  isEditingSource: false,
  prevHighlightedLines: [],
};

// ============================================================================
// Initialization & Asset Loading
// ============================================================================

async function initWorkbench() {
  setupUIHandlers();
  renderKeypadButtons();
  renderSidHexStripSkeleton();
  renderHudGuideOverlay();
  updateDrmChipState();

  if (typeof window !== "undefined" && window.innerWidth && window.innerWidth <= 640) {
    const chkHud = document.getElementById("chk-hud-overlay");
    const hudOverlay = document.getElementById("hud-guide-overlay");
    if (chkHud && hudOverlay) {
      chkHud.checked = false;
      hudOverlay.classList.add("hidden");
    }
  }

  const fileNames = [
    "wizball.asm",
    "arkanoid.asm",
    "arkadrum.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
  ];

  const [wasmResp, directivesResp, narrativeResp, ...asmResps] = await Promise.all([
    fetch("./wasm/c64_engine.wasm"),
    fetch("./ocean_assembler_directives.txt"),
    fetch("./NARRATIVE.md"),
    ...fileNames.map((f) => fetch(`./${f}`)),
  ]);

  const wasmBytes = await wasmResp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});

  state.directivesText = await directivesResp.text();
  document.getElementById("directives-pre").textContent = state.directivesText;

  const narrativeText = await narrativeResp.text();
  const narrativeBody = document.getElementById("narrative-modal-body");
  if (narrativeBody) {
    narrativeBody.innerHTML = renderMarkdownToHtml(narrativeText);
  }

  const rawSources = {};
  for (let i = 0; i < fileNames.length; i++) {
    const buf = await asmResps[i].arrayBuffer();
    const bytes = new Uint8Array(buf);
    let text = "";
    for (let j = 0; j < bytes.length; j++) {
      text += String.fromCharCode(bytes[j]);
    }
    rawSources[fileNames[i]] = text;
  }

  state.player = createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: (opts) => {
      if (state.preUnlockedAudioCtx) {
        const ctx = state.preUnlockedAudioCtx;
        state.preUnlockedAudioCtx = null;
        return ctx;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      return opts ? new AudioCtx(opts) : new AudioCtx();
    },
    navigatorObj: typeof navigator !== "undefined" ? navigator : null,
  });

  document.getElementById("status-led").classList.add("ready");
  renderGameList();
  selectGameAndTrack("wizball.asm", "wiz-title", state.pendingPlayOnBoot);
  state.pendingPlayOnBoot = false;
  requestAnimationFrame(renderFrameLoop);
}

function setPlayingState(playing) {
  if (!state.player) return;
  if (playing) state.player.play();
  else state.player.pause();

  const btnPlay = document.getElementById("btn-play");
  const playIcon = document.getElementById("play-icon");
  const playLabel = document.getElementById("play-label");
  const led = document.getElementById("status-led");

  if (playing) {
    btnPlay.classList.add("playing");
    playIcon.innerHTML = "&#10074;&#10074;";
    playLabel.textContent = "PAUSE";
    led.classList.remove("ready");
    led.classList.add("playing");
  } else {
    btnPlay.classList.remove("playing");
    playIcon.innerHTML = "&#9654;";
    playLabel.textContent = "PLAY";
    led.classList.remove("playing");
    led.classList.add("ready");
  }
}

function updateRamboMonitorScreen(ram, asm) {
  const s = asm.symbols;
  for (let i = 0; i < 16; i++) {
    ram[0x0400 + 5 * 40 + 2 + i] = ram[0x10 + i];
    ram[0xD800 + 5 * 40 + 2 + i] = 3;
  }
  if (s.SB0 && s.SB1 && s.SB2) {
    for (let i = 0; i < 38; i++) {
      ram[0x0400 + 14 * 40 + 1 + i] = ram[s.SB0 + i];
      ram[0xD800 + 14 * 40 + 1 + i] = 3;
      ram[0x0400 + 16 * 40 + 1 + i] = ram[s.SB1 + i];
      ram[0xD800 + 16 * 40 + 1 + i] = 4;
      ram[0x0400 + 18 * 40 + 1 + i] = ram[s.SB2 + i];
      ram[0xD800 + 18 * 40 + 1 + i] = 7;
    }
  }
}

// ============================================================================
// UI Rendering: Games, Tracks, Source Viewer, Keypad
// ============================================================================

function selectGameAndTrack(gameId, trackId, autoPlay = true) {
  if (!state.player) return;
  const prevGameId = state.activeGameId;
  const { game, track } = state.player.selectTrack(gameId, trackId, { autoPlay });
  state.activeGameId = game.id;
  state.activeTrackId = track.id;

  renderGameList();
  renderTrackList();
  renderGameMetaCard(game);

  if (
    prevGameId !== game.id ||
    document.getElementById("source-viewer").children.length === 0
  ) {
    renderSourceViewer(game.id);
  }

  const morseBanner = document.getElementById("morse-banner");
  if (game.id === "rambload.asm") {
    morseBanner.classList.remove("hidden");
    renderMorseStream(0);
  } else {
    morseBanner.classList.add("hidden");
  }

  document.getElementById("now-playing-pill").textContent =
    `${game.title}: ${track.name}`;

  updateDrmChipState();

  setPlayingState(autoPlay);
}

function renderGameList() {
  const container = document.getElementById("game-list");
  container.innerHTML = "";

  for (const game of GAME_FILES) {
    const div = document.createElement("div");
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
  const container = document.getElementById("track-list");
  container.innerHTML = "";

  const game = GAME_FILES.find((g) => g.id === state.activeGameId);
  if (!game) return;

  const filtered = game.tracks.filter((t) => {
    if (state.activeFilter === "all") return true;
    return t.category === state.activeFilter;
  });

  for (const track of filtered) {
    const div = document.createElement("div");
    div.className = `track-item${track.id === state.activeTrackId ? " active" : ""}`;

    const hzClass =
      track.hz === 200 ? "hz-200" : track.hz === 100 ? "hz-100" : "hz-50";
    const hzText = track.withDrums ? `${track.hz}Hz + DIGI` : `${track.hz}Hz`;
    const keyBadge = track.key
      ? `<span class="t-badge key-tag">KEY [${track.key}]</span>`
      : "";
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

function renderGameMetaCard(game) {
  const card = document.getElementById("game-meta-card");
  card.innerHTML = `
    <div><strong>File:</strong> ${game.id} (${game.date})</div>
    <div><strong>Memory Map:</strong> ${game.architecture.org}</div>
    <div><strong>Zero Page:</strong> ${game.architecture.zeroPage}</div>
    <div style="margin-top:4px;">${game.summary}</div>
  `;
}

function renderKeypadButtons() {
  const container = document.getElementById("c64-keypad-buttons");
  const keys = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    "+",
    "-",
    "@",
    "*",
    "RET",
  ];
  container.innerHTML = "";
  for (const k of keys) {
    const btn = document.createElement("button");
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
      if (!state.player.getState().isPlaying) setPlayingState(true);
      const code = k === "RET" ? 13 : k.charCodeAt(0);
      state.player.injectKey(code);
    });
    container.appendChild(btn);
  }
}

function renderSidHexStripSkeleton() {
  const container = document.getElementById("sid-hex-cells");
  if (!container) return;
  container.innerHTML = "";

  const groups = [
    { id: "v0", label: "V1", start: 0, count: 7, cls: "v0" },
    { id: "v1", label: "V2", start: 7, count: 7, cls: "v1" },
    { id: "v2", label: "V3", start: 14, count: 7, cls: "v2" },
    { id: "flt", label: "FLT", start: 21, count: 4, cls: "flt" },
  ];

  const regNames = [
    "V1 Freq Lo", "V1 Freq Hi", "V1 PW Lo", "V1 PW Hi", "V1 Ctrl", "V1 Att/Dec", "V1 Sus/Rel",
    "V2 Freq Lo", "V2 Freq Hi", "V2 PW Lo", "V2 PW Hi", "V2 Ctrl", "V2 Att/Dec", "V2 Sus/Rel",
    "V3 Freq Lo", "V3 Freq Hi", "V3 PW Lo", "V3 PW Hi", "V3 Ctrl", "V3 Att/Dec", "V3 Sus/Rel",
    "Flt Cut Lo", "Flt Cut Hi", "Flt Res/Route", "Mode / Vol",
  ];

  for (const g of groups) {
    const grpEl = document.createElement("div");
    grpEl.className = `sid-hex-group ${g.cls}`;
    grpEl.id = `sid-group-${g.id}`;

    const tag = document.createElement("span");
    tag.className = "sid-group-tag";
    tag.textContent = g.label;
    grpEl.appendChild(tag);

    const cellsWrap = document.createElement("div");
    cellsWrap.className = "sid-group-cells";

    for (let i = g.start; i < g.start + g.count; i++) {
      const span = document.createElement("span");
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
}

function setFollowVoice(voice) {
  state.followVoice = voice;
  const chips = document.querySelectorAll(".legend-chip");
  chips.forEach((chip) => {
    chip.classList.toggle("active-followed", chip.dataset.voice === String(voice));
  });

  const chkFollow = document.getElementById("chk-follow-pc");
  if (chkFollow && !chkFollow.checked) {
    chkFollow.checked = true;
    state.followPc = true;
  }

  if (state.player && state.player.getState().isPlaying && state.prevHighlightedLines) {
    const targetCls = voice === "seq" ? "pc-seq" : `pc-v${voice}`;
    const targetLine = state.prevHighlightedLines.find((al) => al.cls === targetCls);
    if (targetLine) {
      scrollToSourceLine(targetLine.lineNo);
    }
  }
}

function updateDrmChipState() {
  const drmChip = document.querySelector('.legend-chip[data-voice="seq"]');
  if (!drmChip) return;
  const game = GAME_FILES.find((g) => g.id === state.activeGameId);
  const pcSyms = game && game.architecture ? game.architecture.pcSymbols : [];
  const hasDrums =
    pcSyms.includes("seqPC") ||
    state.activeGameId === "arkadrum.asm" ||
    state.activeGameId === "gameover.asm";

  drmChip.classList.toggle("disabled", !hasDrums);
  drmChip.title = hasDrums
    ? "Follow Drum Sequencer (seqPC)"
    : "No drum sequencer in this song";

  if (!hasDrums && state.followVoice === "seq") {
    setFollowVoice(0);
  }
}

function renderHudGuideOverlay() {
  const overlay = document.getElementById("hud-guide-overlay");
  if (!overlay) return;
  const chkHud = document.getElementById("chk-hud-overlay");
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
    const tag = document.createElement("div");
    tag.className = `hud-tag${r.right ? " right" : ""}`;
    const topPct = ((36 + r.row * 8) / 272) * 100;
    tag.style.top = `${topPct.toFixed(2)}%`;
    tag.textContent = r.text;
    overlay.appendChild(tag);
  }
}

function renderMorseStream(activeIndex) {
  const game = GAME_FILES.find((g) => g.id === "rambload.asm");
  if (!game || !game.morseSecret) return;
  const secret = game.morseSecret;
  const container = document.getElementById("morse-stream");
  const readout = document.getElementById("morse-state-readout");

  let html = "";
  for (let i = 0; i < secret.length; i++) {
    const cls =
      i < activeIndex ? "morse-char done" : i === activeIndex ? "morse-char current" : "morse-char";
    html += `<span class="${cls}">${secret[i]}</span>`;
  }
  container.innerHTML = html;
  if (activeIndex < secret.length) {
    readout.textContent = `CHAR ${activeIndex + 1}/${secret.length}: '${secret[activeIndex]}'`;
  } else {
    readout.textContent = `TRANSMISSION COMPLETE (LEAD MELODY ACTIVE)`;
  }
}

// ============================================================================
// Source Code Viewer & In-Browser Assembler
// ============================================================================

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatAsmLineHtml(rawLine) {
  const semi = rawLine.indexOf(";");
  const codePart = semi >= 0 ? rawLine.slice(0, semi) : rawLine;
  const commentPart = semi >= 0 ? rawLine.slice(semi) : "";

  let formattedCode = escapeHtml(codePart);
  if (codePart.length > 0 && !/\s/.test(codePart[0])) {
    formattedCode = formattedCode.replace(
      /^(\S+)/,
      '<span class="asm-label">$1</span>'
    );
  }
  formattedCode = formattedCode.replace(
    /\b(ORG|EQU|DFB|DFW|DFL|DFH|DFS|DFM|ENT|INC)\b/g,
    '<span class="asm-directive">$1</span>'
  );

  const formattedComment = commentPart
    ? `<span class="asm-comment">${escapeHtml(commentPart)}</span>`
    : "";

  return formattedCode + formattedComment;
}

function renderSourceViewer(gameId) {
  if (!state.player) return;
  const asm = state.player.getAssembled(gameId);
  if (!asm) return;

  document.getElementById("source-file-title").textContent =
    `5. OCEAN 1987 SOURCE: ${gameId.toUpperCase()}`;
  document.getElementById("source-stats").textContent =
    `${asm.rawLines.length} lines | ${Object.keys(asm.symbols).length} symbols`;

  const symSelect = document.getElementById("select-symbol-jump");
  symSelect.innerHTML = `<option value="">Jump to Symbol / Label (${Object.keys(asm.symbols).length})...</option>`;

  const sortedSyms = Object.entries(asm.symbols)
    .filter(([k]) => !/^N\d\d$/.test(k))
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [name, val] of sortedSyms) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} ($${(val & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")})`;
    symSelect.appendChild(opt);
  }

  const viewer = document.getElementById("source-viewer");
  const frag = document.createDocumentFragment();

  for (let i = 0; i < asm.rawLines.length; i++) {
    const lineNo = i + 1;
    const addr = asm.lineAddresses[lineNo];
    const addrHex =
      addr !== undefined
        ? `$${addr.toString(16).toUpperCase().padStart(4, "0")}`
        : "";

    const row = document.createElement("div");
    row.className = "asm-line";
    row.id = `asm-L${lineNo}`;
    row.innerHTML = `<span class="ln-num">${lineNo}</span><span class="ln-addr">${addrHex}</span><span class="ln-code">${formatAsmLineHtml(asm.rawLines[i])}</span>`;
    frag.appendChild(row);
  }

  viewer.innerHTML = "";
  viewer.appendChild(frag);

  document.getElementById("source-editor").value = state.player.getRawSource(gameId);
  state.prevHighlightedLines = [];
}

function setMobileView(view) {
  const grid = document.getElementById("workbench-grid");
  if (grid) {
    grid.dataset.mobileView = view;
  }
  document.querySelectorAll("[data-mobile-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mobileTab === view);
  });
}

function scrollToSourceLine(lineNo, { revealMobilePanel = false } = {}) {
  if (revealMobilePanel) {
    const grid = document.getElementById("workbench-grid");
    const currentView = grid && grid.dataset ? grid.dataset.mobileView : "all";
    if (currentView && currentView !== "all" && currentView !== "asm") {
      setMobileView("asm");
    }
  }
  const el = document.getElementById(`asm-L${lineNo}`);
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// ============================================================================
// Real-Time 60fps Visualization Loop (C64 CRT Canvas, Scopes, Registers, PC)
// ============================================================================

const c64Canvas = document.getElementById("c64-monitor-canvas");
const c64Ctx = c64Canvas.getContext("2d");
const c64ImgData = c64Ctx.createImageData(384, 272);
const c64Pixels = new Uint8Array(c64ImgData.data.buffer);

function renderC64Monitor(ram, wasm) {
  const borderPtr = wasm.wasm_get_border_ptr();
  const scanlineBorder = new Uint8Array(wasm.memory.buffer, borderPtr, 312);

  for (let y = 0; y < 272; y++) {
    const vicLine = y + 20;
    const bdrColorIdx = scanlineBorder[vicLine] & 0x0F;
    const bdrRgba = VIC_PALETTE_RGBA[bdrColorIdx];
    const inScreenY = y >= 36 && y < 236;
    const screenY = y - 36;
    const textRow = screenY >> 3;
    const charRow = screenY & 7;

    let dstIdx = y * 384 * 4;

    if (!inScreenY) {
      for (let x = 0; x < 384; x++) {
        c64Pixels[dstIdx]     = bdrRgba[0];
        c64Pixels[dstIdx + 1] = bdrRgba[1];
        c64Pixels[dstIdx + 2] = bdrRgba[2];
        c64Pixels[dstIdx + 3] = 255;
        dstIdx += 4;
      }
      continue;
    }

    for (let x = 0; x < 32; x++) {
      c64Pixels[dstIdx]     = bdrRgba[0];
      c64Pixels[dstIdx + 1] = bdrRgba[1];
      c64Pixels[dstIdx + 2] = bdrRgba[2];
      c64Pixels[dstIdx + 3] = 255;
      dstIdx += 4;
    }

    const rowBase = textRow * 40;
    for (let col = 0; col < 40; col++) {
      const charCode = ram[0x0400 + rowBase + col];
      const fgColorIdx = ram[0xD800 + rowBase + col] & 0x0F;
      const fgRgba = VIC_PALETTE_RGBA[fgColorIdx];
      const glyphByte = C64_CHAR_ROM[charCode * 8 + charRow];

      for (let bit = 7; bit >= 0; bit--) {
        const isFg = (glyphByte >> bit) & 1;
        if (isFg) {
          c64Pixels[dstIdx]     = fgRgba[0];
          c64Pixels[dstIdx + 1] = fgRgba[1];
          c64Pixels[dstIdx + 2] = fgRgba[2];
          c64Pixels[dstIdx + 3] = 255;
        } else {
          c64Pixels[dstIdx]     = 0;
          c64Pixels[dstIdx + 1] = 0;
          c64Pixels[dstIdx + 2] = 0;
          c64Pixels[dstIdx + 3] = 255;
        }
        dstIdx += 4;
      }
    }

    for (let x = 0; x < 32; x++) {
      c64Pixels[dstIdx]     = bdrRgba[0];
      c64Pixels[dstIdx + 1] = bdrRgba[1];
      c64Pixels[dstIdx + 2] = bdrRgba[2];
      c64Pixels[dstIdx + 3] = 255;
      dstIdx += 4;
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
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
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
  const canvas = document.getElementById("scope-master");
  const ctx = canvas.getContext("2d");
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

function renderFrameLoop() {
  if (state.player) {
    const wasm = state.player.wasm;
    const ram = state.player.getRamView();
    const asm = state.player.getAssembled(state.activeGameId);

    if (state.activeGameId === "rambload.asm" && asm) {
      updateRamboMonitorScreen(ram, asm);
      if (asm.symbols.MWK !== undefined) {
        const morseIdx = ram[asm.symbols.MWK] >> 1;
        renderMorseStream(morseIdx);
      }
    }

    renderC64Monitor(ram, wasm);

    document.getElementById("tel-frame").textContent =
      wasm.wasm_get_frame_count();
    document.getElementById("tel-pc").textContent =
      "$" + wasm.wasm_get_cpu_pc().toString(16).toUpperCase().padStart(4, "0");
    document.getElementById("tel-d418").textContent =
      wasm.wasm_get_d418_activity();

    const sidRegs = new Uint8Array(
      wasm.memory.buffer,
      wasm.wasm_get_sid_regs_ptr(),
      32
    );
    for (let i = 0; i <= 0x18; i++) {
      const cell = document.getElementById(`sid-reg-${i}`);
      if (cell) {
        cell.textContent = sidRegs[i].toString(16).toUpperCase().padStart(2, "0");
      }
    }

    const scopeData = new Float32Array(
      wasm.memory.buffer,
      wasm.wasm_get_scope_ptr(),
      4 * 512
    );

    const colors = ["#38e2ff", "#ff56b1", "#ffd24c"];
    const game = GAME_FILES.find((g) => g.id === state.activeGameId);
    const pcSyms = game ? game.architecture.pcSymbols : ["PC0", "PC1", "PC2"];

    const activeLines = [];

    for (let v = 0; v < 3; v++) {
      const freq = wasm.wasm_get_voice_freq(v);
      const pw = wasm.wasm_get_voice_pw(v);
      const ctrl = wasm.wasm_get_voice_control(v);
      const env = wasm.wasm_get_voice_env(v);
      const ad = sidRegs[v * 7 + 5];
      const sr = sidRegs[v * 7 + 6];

      document.getElementById(`v${v}-note`).textContent = sidFreqToNoteString(freq);
      document.getElementById(`v${v}-wf`).textContent = decodeControlWaveforms(ctrl);
      document.getElementById(`v${v}-pw`).textContent =
        "$" + pw.toString(16).toUpperCase().padStart(3, "0");
      document.getElementById(`v${v}-adsr`).textContent =
        `${ad.toString(16).toUpperCase().padStart(2, "0")}/${sr.toString(16).toUpperCase().padStart(2, "0")}`;
      document.getElementById(`v${v}-env`).textContent =
        env.toString(16).toUpperCase().padStart(2, "0");

      drawVoiceScope(`scope-v${v}`, scopeData, v, colors[v]);

      const isVoiceActive = env > 0 || (ctrl & 0x01) !== 0;
      const grp = document.getElementById(`sid-group-v${v}`);
      if (grp) {
        grp.classList.toggle("active", isVoiceActive);
      }

      if (asm && pcSyms[v] && asm.symbols[pcSyms[v]] !== undefined) {
        const zpAddr = asm.symbols[pcSyms[v]];
        const seqPtr = ram[zpAddr] | (ram[zpAddr + 1] << 8);
        const pcEl = document.getElementById(`v${v}-pc`);
        pcEl.textContent = `PC${v}: $${seqPtr.toString(16).toUpperCase().padStart(4, "0")}`;
        const lineNo = findNearestSourceLine(asm, seqPtr);
        if (lineNo) {
          pcEl.dataset.line = lineNo;
          activeLines.push({ lineNo, cls: `pc-v${v}` });
        }
      }
    }

    const fc = wasm.wasm_get_filter_fc();
    const res = wasm.wasm_get_filter_res();
    const rout = wasm.wasm_get_filter_routing();
    const mode = wasm.wasm_get_filter_mode();
    const vol = wasm.wasm_get_master_vol();

    const modeTags = [];
    if (mode & 0x10) modeTags.push("LP");
    if (mode & 0x20) modeTags.push("BP");
    if (mode & 0x40) modeTags.push("HP");
    if (mode & 0x80) modeTags.push("3OFF");
    document.getElementById("filter-mode-tag").textContent =
      modeTags.length ? modeTags.join("+") : "BYPASS";

    const cutoffHz = Math.round(30 + (fc / 2047) * 10000);
    document.getElementById("flt-fc").textContent =
      `$${fc.toString(16).toUpperCase().padStart(3, "0")} (${cutoffHz}Hz)`;
    document.getElementById("flt-res").textContent = res;

    const routStr = [
      rout & 1 ? "V1" : "",
      rout & 2 ? "V2" : "",
      rout & 4 ? "V3" : "",
    ]
      .filter(Boolean)
      .join("+");
    document.getElementById("flt-rout").textContent = routStr || "NONE";
    document.getElementById("flt-vol").textContent = vol;

    const isFltActive = vol > 0 && rout > 0;
    const fltGrp = document.getElementById("sid-group-flt");
    if (fltGrp) {
      fltGrp.classList.toggle("active", isFltActive);
    }

    drawMasterAndFilterScope(scopeData, fc, res, mode);

    const seqPcEl = document.getElementById("seq-pc");
    if (
      state.activeGameId === "arkadrum.asm" ||
      state.activeGameId === "gameover.asm"
    ) {
      const seqPtr = ram[0x50] | (ram[0x51] << 8);
      seqPcEl.textContent = `DRUM: $${seqPtr.toString(16).toUpperCase().padStart(4, "0")}`;
      if (asm) {
        const lineNo = findNearestSourceLine(asm, seqPtr);
        if (lineNo) {
          seqPcEl.dataset.line = lineNo;
          activeLines.push({ lineNo, cls: "pc-seq" });
        }
      }
    } else {
      seqPcEl.textContent = "DRUM: ----";
    }

    updateLiveSourceHighlights(activeLines);
  }

  requestAnimationFrame(renderFrameLoop);
}

function findNearestSourceLine(asm, addr) {
  if (!addr || addr < 0x0800) return 0;
  for (let delta = 0; delta < 16; delta++) {
    const ln = asm.addrToLine[(addr - delta) & 0xFFFF];
    if (ln > 0) return ln;
  }
  return 0;
}

function updateLiveSourceHighlights(activeLines) {
  for (const prev of state.prevHighlightedLines) {
    const el = document.getElementById(`asm-L${prev.lineNo}`);
    if (el) el.classList.remove(prev.cls);
  }
  for (const curr of activeLines) {
    const el = document.getElementById(`asm-L${curr.lineNo}`);
    if (el) el.classList.add(curr.cls);
  }
  state.prevHighlightedLines = activeLines;

  if (
    state.followPc &&
    activeLines.length > 0 &&
    state.player &&
    state.player.getState().isPlaying
  ) {
    const targetCls = state.followVoice === "seq" ? "pc-seq" : `pc-v${state.followVoice}`;
    const targetLine = activeLines.find((al) => al.cls === targetCls);
    if (targetLine) {
      scrollToSourceLine(targetLine.lineNo);
    }
  }
}

// ============================================================================
// Event Listeners & Controls
// ============================================================================

function setupUIHandlers() {
  document.getElementById("btn-play").addEventListener("click", () => {
    if (!state.player) {
      if (typeof navigator !== "undefined" && navigator.audioSession) {
        try {
          navigator.audioSession.type = "playback";
        } catch (_) {}
      }
      if (!state.preUnlockedAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          try {
            state.preUnlockedAudioCtx = new AudioCtx({ sampleRate: 48000 });
          } catch (_) {
            state.preUnlockedAudioCtx = new AudioCtx();
          }
          if (state.preUnlockedAudioCtx.state !== "running") {
            state.preUnlockedAudioCtx.resume();
          }
        }
      }
      state.pendingPlayOnBoot = !state.pendingPlayOnBoot;
      document.getElementById("play-label").textContent =
        state.pendingPlayOnBoot ? "LOADING..." : "PLAY";
      return;
    }
    setPlayingState(!state.player.getState().isPlaying);
  });

  document.getElementById("btn-restart").addEventListener("click", () => {
    selectGameAndTrack(state.activeGameId, state.activeTrackId, true);
  });

  document.getElementById("btn-prev").addEventListener("click", () => {
    stepTrack(-1);
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    stepTrack(1);
  });

  const btnFfwd = document.getElementById("btn-ffwd");
  const startFfwd = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!state.player) return;
    state.player.setHardwareOptions({ isFastForward: true });
    btnFfwd.classList.add("active");
  };
  const stopFfwd = () => {
    if (!state.player || !state.player.getState().isFastForward) return;
    state.player.setHardwareOptions({ isFastForward: false });
    btnFfwd.classList.remove("active");
  };
  btnFfwd.addEventListener("pointerdown", startFfwd);
  btnFfwd.addEventListener("mousedown", startFfwd);
  btnFfwd.addEventListener("touchstart", startFfwd);
  window.addEventListener("pointerup", stopFfwd);
  window.addEventListener("mouseup", stopFfwd);
  window.addEventListener("touchend", stopFfwd);

  document.getElementById("select-sid-model").addEventListener("change", (e) => {
    state.sidModel8580 = e.target.value === "8580";
    if (state.player) state.player.setHardwareOptions({ sidModel8580: state.sidModel8580 });
  });

  document.getElementById("select-video-std").addEventListener("change", (e) => {
    state.videoNtsc = e.target.value === "ntsc";
    if (state.player) state.player.setHardwareOptions({ videoNtsc: state.videoNtsc });
  });

  document.getElementById("slider-digi-boost").addEventListener("input", (e) => {
    state.digiBoost = parseFloat(e.target.value);
    document.getElementById("digi-boost-val").textContent =
      `${state.digiBoost.toFixed(1)}x`;
    if (state.player) state.player.setHardwareOptions({ digiBoost: state.digiBoost });
  });

  document.querySelectorAll(".filter-pills .pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-pills .pill")
        .forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      state.activeFilter = pill.dataset.filter;
      renderTrackList();
    });
  });

  document.getElementById("chk-hud-overlay").addEventListener("change", (e) => {
    document
      .getElementById("hud-guide-overlay")
      .classList.toggle("hidden", !e.target.checked);
  });
  document.getElementById("chk-crt-scanlines").addEventListener("change", (e) => {
    document
      .getElementById("crt-overlay")
      .classList.toggle("hidden", !e.target.checked);
  });

  document.querySelectorAll("[data-mute]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ch = parseInt(btn.dataset.mute, 10);
      state.muteMask ^= 1 << ch;
      btn.classList.toggle("active-mute", Boolean(state.muteMask & (1 << ch)));
      const card = btn.closest(".voice-card");
      if (card && ch < 3) {
        card.classList.toggle("muted", Boolean(state.muteMask & (1 << ch)));
      }
      if (state.player) state.player.setHardwareOptions({ muteMask: state.muteMask });
    });
  });

  document.querySelectorAll("[data-solo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ch = parseInt(btn.dataset.solo, 10);
      state.soloVoice = state.soloVoice === ch ? -1 : ch;
      document.querySelectorAll("[data-solo]").forEach((b) => {
        b.classList.toggle(
          "active-solo",
          parseInt(b.dataset.solo, 10) === state.soloVoice
        );
      });
      if (state.player) state.player.setHardwareOptions({ soloVoice: state.soloVoice });
    });
  });

  document.querySelectorAll("[data-mobile-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mobileTab) {
        setMobileView(btn.dataset.mobileTab);
      }
    });
  });

  ["v0-pc", "v1-pc", "v2-pc", "seq-pc"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      const ln = parseInt(e.currentTarget.dataset.line || "0", 10);
      if (ln > 0) scrollToSourceLine(ln, { revealMobilePanel: true });
    });
  });

  document.querySelectorAll(".legend-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.classList.contains("disabled")) return;
      const voiceAttr = chip.dataset.voice;
      const voice = voiceAttr === "seq" ? "seq" : parseInt(voiceAttr, 10);
      setFollowVoice(voice);
    });
  });

  document.getElementById("chk-follow-pc").addEventListener("change", (e) => {
    state.followPc = e.target.checked;
    if (
      state.followPc &&
      state.player &&
      state.player.getState().isPlaying &&
      state.prevHighlightedLines
    ) {
      const targetCls = state.followVoice === "seq" ? "pc-seq" : `pc-v${state.followVoice}`;
      const targetLine = state.prevHighlightedLines.find((al) => al.cls === targetCls);
      if (targetLine) {
        scrollToSourceLine(targetLine.lineNo);
      }
    }
  });

  // Synchronize initial state of checkboxes & sliders with DOM (handles browser form autofill/restores)
  const syncUiControls = () => {
    const chkFollow = document.getElementById("chk-follow-pc");
    if (chkFollow) {
      state.followPc = chkFollow.checked;
    }

    const chkHud = document.getElementById("chk-hud-overlay");
    const hudOverlay = document.getElementById("hud-guide-overlay");
    if (chkHud && hudOverlay) {
      hudOverlay.classList.toggle("hidden", !chkHud.checked);
    }

    const chkCrt = document.getElementById("chk-crt-scanlines");
    const crtOverlay = document.getElementById("crt-overlay");
    if (chkCrt && crtOverlay) {
      crtOverlay.classList.toggle("hidden", !chkCrt.checked);
    }

    const sliderDigi = document.getElementById("slider-digi-boost");
    if (sliderDigi) {
      state.digiBoost = parseFloat(sliderDigi.value) || 1.3;
      const digiVal = document.getElementById("digi-boost-val");
      if (digiVal) digiVal.textContent = `${state.digiBoost.toFixed(1)}x`;
    }
  };
  syncUiControls();

  document.getElementById("select-symbol-jump").addEventListener("change", (e) => {
    const symName = e.target.value;
    if (!symName || !state.player) return;
    const asm = state.player.getAssembled(state.activeGameId);
    if (!asm) return;
    const idx = asm.rawLines.findIndex((line) =>
      new RegExp(`^${symName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)
    );
    if (idx >= 0) scrollToSourceLine(idx + 1);
  });

  document.getElementById("input-source-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!state.player) return;
    const asm = state.player.getAssembled(state.activeGameId);
    if (!asm) return;
    document
      .querySelectorAll(".asm-line.search-match")
      .forEach((el) => el.classList.remove("search-match"));
    if (!q) return;

    let firstMatch = 0;
    for (let i = 0; i < asm.rawLines.length; i++) {
      if (asm.rawLines[i].toLowerCase().includes(q)) {
        const lineNo = i + 1;
        if (!firstMatch) firstMatch = lineNo;
        const el = document.getElementById(`asm-L${lineNo}`);
        if (el) el.classList.add("search-match");
      }
    }
    if (firstMatch) scrollToSourceLine(firstMatch);
  });

  const btnToggleEdit = document.getElementById("btn-toggle-edit");
  const btnReassemble = document.getElementById("btn-reassemble");
  const viewerEl = document.getElementById("source-viewer");
  const editorEl = document.getElementById("source-editor");

  btnToggleEdit.addEventListener("click", () => {
    state.isEditingSource = !state.isEditingSource;
    viewerEl.classList.toggle("hidden", state.isEditingSource);
    editorEl.classList.toggle("hidden", !state.isEditingSource);
    btnReassemble.classList.toggle("hidden", !state.isEditingSource);
    btnToggleEdit.textContent = state.isEditingSource
      ? "VIEW LIVE ASM"
      : "EDIT .ASM";
  });

  btnReassemble.addEventListener("click", () => {
    if (!state.player) return;
    const editedText = editorEl.value;
    state.player.updateSource(state.activeGameId, editedText);

    const badge = document.getElementById("asm-compile-badge");
    badge.textContent = "HOT-RELOADED OK";

    state.isEditingSource = false;
    viewerEl.classList.remove("hidden");
    editorEl.classList.add("hidden");
    btnReassemble.classList.add("hidden");
    btnToggleEdit.textContent = "EDIT .ASM";

    renderSourceViewer(state.activeGameId);
    selectGameAndTrack(state.activeGameId, state.activeTrackId, true);
  });

  const modal = document.getElementById("directives-modal");
  document
    .getElementById("btn-directives-modal")
    .addEventListener("click", () => modal.classList.remove("hidden"));
  document
    .getElementById("btn-close-modal")
    .addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  const narrativeModal = document.getElementById("narrative-modal");
  const btnNarrative = document.getElementById("btn-narrative-modal");
  const btnCloseNarrative = document.getElementById("btn-close-narrative-modal");
  if (btnNarrative && narrativeModal) {
    btnNarrative.addEventListener("click", () => narrativeModal.classList.remove("hidden"));
  }
  if (btnCloseNarrative && narrativeModal) {
    btnCloseNarrative.addEventListener("click", () => narrativeModal.classList.add("hidden"));
  }
  if (narrativeModal) {
    narrativeModal.addEventListener("click", (e) => {
      if (e.target === narrativeModal) narrativeModal.classList.add("hidden");
    });
  }

  // Galway 64 C64 logo sparkle reflection animation & easter egg
  const brandLogo = document.querySelector(".brand-logo");
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

    brandLogo.addEventListener("click", triggerSparkle);
    brandLogo.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        triggerSparkle();
      }
    });

    // Run periodically every 10 seconds and once on startup
    setInterval(triggerSparkle, 10000);
    setTimeout(triggerSparkle, 1200);
  }

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.code === "Space") {
      e.preventDefault();
      if (state.player) setPlayingState(!state.player.getState().isPlaying);
    } else if (e.key === "[") {
      stepTrack(-1);
    } else if (e.key === "]") {
      stepTrack(1);
    } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
      const ch = parseInt(e.key, 10) - 1;
      const btn = document.querySelector(`[data-mute="${ch}"]`);
      if (btn) btn.click();
    } else if (/^[a-zA-Z+\-@*]$/.test(e.key)) {
      if (state.player) {
        if (!state.player.getState().isPlaying) setPlayingState(true);
        state.player.injectKey(e.key.toUpperCase().charCodeAt(0));
      }
    }
  });
}

function stepTrack(delta) {
  const game = GAME_FILES.find((g) => g.id === state.activeGameId);
  if (!game) return;
  const idx = game.tracks.findIndex((t) => t.id === state.activeTrackId);
  const nextIdx = (idx + delta + game.tracks.length) % game.tracks.length;
  selectGameAndTrack(game.id, game.tracks[nextIdx].id, true);
}

initWorkbench();
