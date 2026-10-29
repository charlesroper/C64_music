// ============================================================================
// Martin Galway // Ocean 6502-SID Workbench Main Application
// ============================================================================

import { assembleOceanSource } from "./ocean_assembler.js";
import { GAME_FILES } from "./tracks_catalog.js";
import { C64_CHAR_ROM, VIC_PALETTE, VIC_PALETTE_RGBA } from "./c64_charset.js";

const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];

const state = {
  wasm: null,
  audioCtx: null,
  scriptNode: null,
  isPlaying: false,
  isFastForward: false,

  rawSources: {},
  assembledCache: {},
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

  // Load WASM + all 6 .asm files + ocean_assembler_directives.txt in parallel
  const fileNames = [
    "wizball.asm",
    "arkanoid.asm",
    "arkadrum.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
  ];

  const [wasmResp, directivesResp, ...asmResps] = await Promise.all([
    fetch("./wasm/c64_engine.wasm"),
    fetch("./ocean_assembler_directives.txt"),
    ...fileNames.map((f) => fetch(`./${f}`)),
  ]);

  const wasmBytes = await wasmResp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  state.wasm = instance.exports;
  state.wasm.wasm_init(48000);

  state.directivesText = await directivesResp.text();
  document.getElementById("directives-pre").textContent = state.directivesText;

  for (let i = 0; i < fileNames.length; i++) {
    const buf = await asmResps[i].arrayBuffer();
    // Decode as Latin-1 so all byte values are preserved
    const bytes = new Uint8Array(buf);
    let text = "";
    for (let j = 0; j < bytes.length; j++) {
      text += String.fromCharCode(bytes[j]);
    }
    state.rawSources[fileNames[i]] = text;
    state.assembledCache[fileNames[i]] = assembleOceanSource(text);
  }

  document.getElementById("status-led").classList.add("ready");
  renderGameList();
  selectGameAndTrack("wizball.asm", "wiz-title", false);
  requestAnimationFrame(renderFrameLoop);
}

// ============================================================================
// Web Audio API Streaming Engine
// ============================================================================

function ensureAudioContext() {
  if (!state.audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioCtx({ sampleRate: 48000 });
    const actualRate = state.audioCtx.sampleRate;
    state.wasm.wasm_set_sample_rate(actualRate);

    const bufferSize = 2048;
    state.scriptNode = state.audioCtx.createScriptProcessor(bufferSize, 0, 2);
    state.scriptNode.onaudioprocess = (e) => {
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const n = outL.length;

      if (!state.isPlaying || !state.wasm) {
        outL.fill(0);
        outR.fill(0);
        return;
      }

      if (state.isFastForward) {
        // Advance 3 extra frames per audio callback for 4x speed
        state.wasm.wasm_fast_forward_frames(3);
      }

      state.wasm.wasm_render_audio(n);
      const wasmL = new Float32Array(
        state.wasm.memory.buffer,
        state.wasm.wasm_get_audio_l_ptr(),
        n
      );
      const wasmR = new Float32Array(
        state.wasm.memory.buffer,
        state.wasm.wasm_get_audio_r_ptr(),
        n
      );
      outL.set(wasmL);
      outR.set(wasmR);
    };
    state.scriptNode.connect(state.audioCtx.destination);
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
}

function setPlayingState(playing) {
  if (playing) ensureAudioContext();
  state.isPlaying = playing;

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

// ============================================================================
// C64 Memory & Track Loader
// ============================================================================

function getRamView() {
  return new Uint8Array(
    state.wasm.memory.buffer,
    state.wasm.wasm_get_ram_ptr(),
    65536
  );
}

function applyHardwareSettingsToWasm() {
  if (!state.wasm) return;
  state.wasm.wasm_set_sid_model(state.sidModel8580 ? 1 : 0);
  state.wasm.wasm_set_video_standard(state.videoNtsc ? 1 : 0);
  state.wasm.wasm_set_digi_boost(state.digiBoost);
  updateEffectiveMuteMask();
}

function updateEffectiveMuteMask() {
  if (!state.wasm) return;
  let mask = state.muteMask;
  if (state.soloVoice >= 0) {
    mask = 0x07 & ~(1 << state.soloVoice);
  }
  state.wasm.wasm_set_voice_mute_mask(mask);
}

function loadTrackIntoEmulator(gameId, track) {
  const sampleRate = state.audioCtx ? state.audioCtx.sampleRate : 48000;
  state.wasm.wasm_init(sampleRate);
  applyHardwareSettingsToWasm();

  const ram = getRamView();

  if (gameId === "wizball.asm") {
    const asm = state.assembledCache["wizball.asm"];
    ram.set(asm.mem);
    const s = asm.symbols;
    state.wasm.wasm_set_custom_keyscan(s.KeyScan);
    state.wasm.wasm_jsr(s.InitScreen, 0, 0, 0, 200000);
    state.wasm.wasm_jsr(s.InitKeyScan, 0, 0, 0, 10000);
    state.wasm.wasm_jsr(s.INITSOUND, 0, 0, 0, 50000);
    // Run FilthRaid once to set $D418 = $1F (master vol 15 + LP filter)
    state.wasm.wasm_jsr(s.FilthRaid, 0, 0, 0, 50000);
    ram[s.RF] = 7;
    // Clear D1 FMC/PMC (since D0/D2 are in Zero Page while D1 is at $4680)
    if (s.D1 !== undefined && s.FMC !== undefined) {
      ram[s.D1 + s.FMC] = 0;
      ram[s.D1 + s.PMC] = 0;
    }
    const refsp = track.refsp || 0x0040;
    ram[s.Refsp] = refsp & 0xFF;
    ram[s.Refsp + 1] = (refsp >> 8) & 0xFF;
    state.wasm.wasm_inject_key(track.key.charCodeAt(0));
    state.wasm.wasm_set_cpu_state(s.DLoop, 0, 0, 0, 0xFD, 0x24);
    return;
  }

  if (gameId === "arkadrum.asm" || gameId === "arkanoid.asm") {
    const asmArk = state.assembledCache["arkanoid.asm"];
    const asmDrm = state.assembledCache["arkadrum.asm"];
    ram.set(asmArk.mem);
    for (let i = 0x4000; i < 0x6000; i++) {
      if (asmDrm.mem[i] !== 0) ram[i] = asmDrm.mem[i];
    }
    const sA = asmArk.symbols;
    const sD = asmDrm.symbols;

    if (track.withDrums) {
      state.wasm.wasm_jsr(sA.InitScreen, 0, 0, 0, 200000);
      ram[sA.RF] = 7;
      state.wasm.wasm_jsr(sD.INITRASTERS, 0, 0, 0, 50000);
      state.wasm.wasm_jsr(sD.INITSOUND, 0, 0, 0, 50000);
      const riffAddr = track.riff === "eNTERDATA" ? sD.eNTERDATA : sD.TITLEDATA;
      const riffClk = track.riffClk || 2;
      state.wasm.wasm_jsr(
        sD.RIFF,
        riffClk,
        riffAddr & 0xFF,
        (riffAddr >> 8) & 0xFF,
        10000
      );
      state.wasm.wasm_jsr(sD.TUNE, 0, 0, track.tuneY, 50000);
      state.wasm.wasm_set_cpu_state(sD.MAIN, 0, 0, 0, 0xFD, 0x20); // CLI enabled
      if (track.drumsSolo) {
        state.wasm.wasm_set_voice_mute_mask(0x07); // Mute SID voices 1-3, keep $D418 drums
      }
    } else {
      state.wasm.wasm_jsr(sA.InitScreen, 0, 0, 0, 200000);
      state.wasm.wasm_jsr(sA.INITSOUND, 0, 0, 0, 50000);
      state.wasm.wasm_write_bus(0xD418, 0x0F);
      if (sA.D418 !== undefined) ram[sA.D418] = 0x0F;
      ram[sA.RF] = 7;
      const refsp = track.refsp || 0x0080;
      ram[sA.Refsp] = refsp & 0xFF;
      ram[sA.Refsp + 1] = (refsp >> 8) & 0xFF;
      state.wasm.wasm_inject_key(track.key.charCodeAt(0));
      state.wasm.wasm_set_cpu_state(sA.DLoop, 0, 0, 0, 0xFD, 0x24);
    }
    return;
  }

  if (gameId === "gameover.asm") {
    const asm = state.assembledCache["gameover.asm"];
    ram.set(asm.mem);
    const s = asm.symbols;

    if (track.withDrums) {
      state.wasm.wasm_set_cpu_state(s.Start, 0, 0, 0, 0xFD, 0x24);
      if (track.skipFrames && track.skipFrames > 0) {
        state.wasm.wasm_fast_forward_frames(track.skipFrames);
      }
    } else {
      state.wasm.wasm_jsr(s.InitScreen, 0, 0, 0, 200000);
      state.wasm.wasm_jsr(s.INITSOUND, 0, 0, 0, 50000);
      // Set volume 15 ($D418) via bus write so standalone SFX are audible immediately
      state.wasm.wasm_write_bus(0xD418, 0x0F);
      ram[s.RF] = 7;
      const refsp = track.refsp || 0x0040;
      ram[s.Refsp] = refsp & 0xFF;
      ram[s.Refsp + 1] = (refsp >> 8) & 0xFF;
      state.wasm.wasm_inject_key(track.key.charCodeAt(0));
      state.wasm.wasm_set_cpu_state(s.DLoop, 0, 0, 0, 0xFD, 0x24);
    }
    return;
  }

  if (gameId === "greenberet.asm") {
    const asm = state.assembledCache["greenberet.asm"];
    ram.set(asm.mem);
    const s = asm.symbols;
    state.wasm.wasm_jsr(s.setscreen, 0, 0, 0, 200000);
    state.wasm.wasm_jsr(s.FULLRESET, 0, 0, 0, 50000);
    state.wasm.wasm_set_cpu_state(s.START, 0, 0, 0, 0xFD, 0x24);
    state.wasm.wasm_inject_key(track.key.charCodeAt(0));
    return;
  }

  if (gameId === "rambload.asm") {
    const asm = state.assembledCache["rambload.asm"];
    ram.set(asm.mem);
    const s = asm.symbols;
    initRamboMonitorScreen(ram);
    // Patch START + 6 ($1006, right after SEI : LDX #15 : STX $D418) to JMP $100E (JSR MUS+3)
    // so the dummy BILLOADER delay loop is bypassed.
    ram[s.START + 6] = 0x4C;
    ram[s.START + 7] = (s.L - 3) & 0xFF;
    ram[s.START + 8] = ((s.L - 3) >> 8) & 0xFF;
    state.wasm.wasm_set_cpu_state(s.START, 0, 0, 0, 0xFD, 0x24);

    if (track.skipFrames && track.skipFrames > 0) {
      state.wasm.wasm_fast_forward_frames(track.skipFrames);
    }
    if (track.mode === "morse_solo") {
      state.wasm.wasm_set_voice_mute_mask(0x06); // Isolate Voice 1 Morse transmitter
    }
    return;
  }
}

// Populate $0400 Screen RAM and $D800 Color RAM when rambload.asm is active
function initRamboMonitorScreen(ram) {
  for (let i = 0; i < 1000; i++) {
    ram[0x0400 + i] = 0x20;
    ram[0xD800 + i] = 15; // Light grey
  }
  const writeStr = (row, col, text, color = 1) => {
    const base = row * 40 + col;
    for (let i = 0; i < text.length && col + i < 40; i++) {
      ram[0x0400 + base + i] = text.charCodeAt(i);
      ram[0xD800 + base + i] = color;
    }
  };
  writeStr(1, 2, "R.A.M.B.O. FIRST BLOOD PART II (1985)", 7);
  writeStr(2, 2, "OCEAN LOADER + SECRET MORSE TRANSMIT", 3);
  writeStr(4, 2, "Z0-ZF ZERO PAGE ($0010-$001F):", 14);
  writeStr(7, 2, "MORSE SECRET MESSAGE (STARTMC):", 13);
  writeStr(8, 2, "BILL BARNA / DAVID COLLIER", 1);
  writeStr(9, 2, "MARTIN GALWAY / TONY POMFRET", 1);
  writeStr(10, 2, "STEVE WAHID", 1);
  writeStr(12, 2, "SB0-SB2 SOUNDBLOCKS ($137D-$13F1):", 14);
  writeStr(22, 2, "RASTER SYNC: LINE 99 ($D012) @ 50HZ", 7);
}

function updateRamboMonitorScreen(ram, asm) {
  const s = asm.symbols;
  // Copy Zero Page $10..$1F to Row 5
  for (let i = 0; i < 16; i++) {
    ram[0x0400 + 5 * 40 + 2 + i] = ram[0x10 + i];
    ram[0xD800 + 5 * 40 + 2 + i] = 3;
  }
  // Copy SB0, SB1, SB2 to Rows 14, 16, 18
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
  const prevGameId = state.activeGameId;
  state.activeGameId = gameId;

  const game = GAME_FILES.find((g) => g.id === gameId) || GAME_FILES[0];
  const track =
    game.tracks.find((t) => t.id === trackId) || game.tracks[0];
  state.activeTrackId = track.id;

  // Render UI lists
  renderGameList();
  renderTrackList();
  renderGameMetaCard(game);

  if (prevGameId !== gameId || document.getElementById("source-viewer").children.length === 0) {
    renderSourceViewer(gameId);
  }

  // Toggle Rambo II Morse code banner
  const morseBanner = document.getElementById("morse-banner");
  if (gameId === "rambload.asm") {
    morseBanner.classList.remove("hidden");
    renderMorseStream(0);
  } else {
    morseBanner.classList.add("hidden");
  }

  loadTrackIntoEmulator(gameId, track);

  document.getElementById("now-playing-pill").textContent =
    `${game.title}: ${track.name}`;

  if (autoPlay) {
    setPlayingState(true);
  } else {
    // Run 2 frames so the C64 screen RAM is populated even while paused
    state.wasm.wasm_render_audio(2048);
  }
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
      if (!state.wasm) return;
      ensureAudioContext();
      if (!state.isPlaying) setPlayingState(true);
      const code = k === "RET" ? 13 : k.charCodeAt(0);
      state.wasm.wasm_inject_key(code);
    });
    container.appendChild(btn);
  }
}

function renderSidHexStripSkeleton() {
  const container = document.getElementById("sid-hex-cells");
  container.innerHTML = "";
  for (let i = 0; i <= 0x18; i++) {
    const span = document.createElement("span");
    const cls =
      i < 7 ? "v0" : i < 14 ? "v1" : i < 21 ? "v2" : "flt";
    span.className = `sid-cell ${cls}`;
    span.id = `sid-reg-${i}`;
    span.title = `$D4${i.toString(16).toUpperCase().padStart(2, "0")}`;
    span.textContent = "00";
    container.appendChild(span);
  }
}

function renderHudGuideOverlay() {
  const overlay = document.getElementById("hud-guide-overlay");
  // Positions correspond to the 25 C64 text rows inside the 384x272 monitor canvas
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
    // Top border is 36/272 (~13.2%), active 200px height is 73.5% of 272px
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
  // Highlight label in column 0
  if (codePart.length > 0 && !/\s/.test(codePart[0])) {
    formattedCode = formattedCode.replace(
      /^(\S+)/,
      '<span class="asm-label">$1</span>'
    );
  }
  // Highlight Ocean directives
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
  const asm = state.assembledCache[gameId];
  if (!asm) return;

  document.getElementById("source-file-title").textContent =
    `5. OCEAN 1987 SOURCE: ${gameId.toUpperCase()}`;
  document.getElementById("source-stats").textContent =
    `${asm.rawLines.length} lines | ${Object.keys(asm.symbols).length} symbols`;

  // Populate symbol jump dropdown
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

  // Render lines
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

  // Sync editor textarea
  document.getElementById("source-editor").value = state.rawSources[gameId];
  state.prevHighlightedLines = [];
}

function scrollToSourceLine(lineNo) {
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

function renderC64Monitor(ram) {
  const borderPtr = state.wasm.wasm_get_border_ptr();
  const scanlineBorder = new Uint8Array(state.wasm.memory.buffer, borderPtr, 312);

  // Render 384x272 frame (32px side borders, 36px top/bottom borders around 320x200 screen)
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

    // Left 32px border
    for (let x = 0; x < 32; x++) {
      c64Pixels[dstIdx]     = bdrRgba[0];
      c64Pixels[dstIdx + 1] = bdrRgba[1];
      c64Pixels[dstIdx + 2] = bdrRgba[2];
      c64Pixels[dstIdx + 3] = 255;
      dstIdx += 4;
    }

    // 40 columns of 8px characters
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
          // Background black ($000000)
          c64Pixels[dstIdx]     = 0;
          c64Pixels[dstIdx + 1] = 0;
          c64Pixels[dstIdx + 2] = 0;
          c64Pixels[dstIdx + 3] = 255;
        }
        dstIdx += 4;
      }
    }

    // Right 32px border
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

  // Subtle center grid line
  ctx.strokeStyle = "#161f30";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Triggered zero-crossing search
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

  // 1. Draw Filter Frequency Response Curve in background
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
        // Low-pass
        resp = Math.max(resp, f <= normCutoff ? 0.55 : 0.55 * Math.exp(-((f - normCutoff) * 9)));
      }
      if (modeBits & 0x20) {
        // Band-pass
        resp = Math.max(resp, 0.55 * Math.exp(-(dist * dist) / 0.025));
      }
      if (modeBits & 0x40) {
        // High-pass
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

  // 2. Draw Master Audio + $D418 Digi Waveform on top
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
  if (state.wasm) {
    const ram = getRamView();
    const asm = state.assembledCache[state.activeGameId];

    if (state.activeGameId === "rambload.asm" && asm) {
      updateRamboMonitorScreen(ram, asm);
      if (asm.symbols.MWK !== undefined) {
        const morseIdx = ram[asm.symbols.MWK] >> 1;
        renderMorseStream(morseIdx);
      }
    }

    renderC64Monitor(ram);

    // Update telemetry header
    document.getElementById("tel-frame").textContent =
      state.wasm.wasm_get_frame_count();
    document.getElementById("tel-pc").textContent =
      "$" + state.wasm.wasm_get_cpu_pc().toString(16).toUpperCase().padStart(4, "0");
    document.getElementById("tel-d418").textContent =
      state.wasm.wasm_get_d418_activity();

    // Update SID Hex Strip ($D400-$D418)
    const sidRegs = new Uint8Array(
      state.wasm.memory.buffer,
      state.wasm.wasm_get_sid_regs_ptr(),
      32
    );
    for (let i = 0; i <= 0x18; i++) {
      const cell = document.getElementById(`sid-reg-${i}`);
      if (cell) {
        cell.textContent = sidRegs[i].toString(16).toUpperCase().padStart(2, "0");
      }
    }

    // Update 3 Voice Cards + Scopes
    const scopeData = new Float32Array(
      state.wasm.memory.buffer,
      state.wasm.wasm_get_scope_ptr(),
      4 * 512
    );

    const colors = ["#38e2ff", "#ff56b1", "#ffd24c"];
    const game = GAME_FILES.find((g) => g.id === state.activeGameId);
    const pcSyms = game ? game.architecture.pcSymbols : ["PC0", "PC1", "PC2"];

    const activeLines = [];

    for (let v = 0; v < 3; v++) {
      const freq = state.wasm.wasm_get_voice_freq(v);
      const pw = state.wasm.wasm_get_voice_pw(v);
      const ctrl = state.wasm.wasm_get_voice_control(v);
      const env = state.wasm.wasm_get_voice_env(v);
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

      // Sequence pointer PC0..PC2
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

    // Filter & Master Card
    const fc = state.wasm.wasm_get_filter_fc();
    const res = state.wasm.wasm_get_filter_res();
    const rout = state.wasm.wasm_get_filter_routing();
    const mode = state.wasm.wasm_get_filter_mode();
    const vol = state.wasm.wasm_get_master_vol();

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

    drawMasterAndFilterScope(scopeData, fc, res, mode);

    // Drum sequencer pointer (seqPC at $0050 in arkadrum.asm / gameover.asm)
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

    // Update live source line highlights
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

  if (state.followPc && activeLines.length > 0 && state.isPlaying) {
    scrollToSourceLine(activeLines[0].lineNo);
  }
}

// ============================================================================
// Event Listeners & Controls
// ============================================================================

function setupUIHandlers() {
  // Play / Pause
  document.getElementById("btn-play").addEventListener("click", () => {
    setPlayingState(!state.isPlaying);
  });

  // Restart
  document.getElementById("btn-restart").addEventListener("click", () => {
    selectGameAndTrack(state.activeGameId, state.activeTrackId, true);
  });

  // Prev / Next Track
  document.getElementById("btn-prev").addEventListener("click", () => {
    stepTrack(-1);
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    stepTrack(1);
  });

  // Fast-Forward 4x button (hold or toggle)
  const btnFfwd = document.getElementById("btn-ffwd");
  btnFfwd.addEventListener("mousedown", () => {
    state.isFastForward = true;
    btnFfwd.classList.add("active");
  });
  window.addEventListener("mouseup", () => {
    if (state.isFastForward) {
      state.isFastForward = false;
      btnFfwd.classList.remove("active");
    }
  });

  // Hardware switches
  document.getElementById("select-sid-model").addEventListener("change", (e) => {
    state.sidModel8580 = e.target.value === "8580";
    applyHardwareSettingsToWasm();
  });

  document.getElementById("select-video-std").addEventListener("change", (e) => {
    state.videoNtsc = e.target.value === "ntsc";
    applyHardwareSettingsToWasm();
  });

  document.getElementById("slider-digi-boost").addEventListener("input", (e) => {
    state.digiBoost = parseFloat(e.target.value);
    document.getElementById("digi-boost-val").textContent =
      `${state.digiBoost.toFixed(1)}x`;
    applyHardwareSettingsToWasm();
  });

  // Track category filter pills
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

  // HUD Overlay & CRT Scanlines checkboxes
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

  // Voice Mute & Solo buttons
  document.querySelectorAll("[data-mute]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ch = parseInt(btn.dataset.mute, 10);
      state.muteMask ^= 1 << ch;
      btn.classList.toggle("active-mute", Boolean(state.muteMask & (1 << ch)));
      const card = btn.closest(".voice-card");
      if (card && ch < 3) {
        card.classList.toggle("muted", Boolean(state.muteMask & (1 << ch)));
      }
      updateEffectiveMuteMask();
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
      updateEffectiveMuteMask();
    });
  });

  // Click PC0..PC2 / seqPC tags to jump to line in source viewer
  ["v0-pc", "v1-pc", "v2-pc", "seq-pc"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      const ln = parseInt(e.currentTarget.dataset.line || "0", 10);
      if (ln > 0) scrollToSourceLine(ln);
    });
  });

  // Source toolbar: Follow PC, Symbol Jump, Search, Edit & Re-Assemble
  document.getElementById("chk-follow-pc").addEventListener("change", (e) => {
    state.followPc = e.target.checked;
  });

  document.getElementById("select-symbol-jump").addEventListener("change", (e) => {
    const symName = e.target.value;
    if (!symName) return;
    const asm = state.assembledCache[state.activeGameId];
    if (!asm) return;
    // Find line where label is defined
    const idx = asm.rawLines.findIndex((line) =>
      new RegExp(`^${symName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)
    );
    if (idx >= 0) scrollToSourceLine(idx + 1);
  });

  document.getElementById("input-source-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const asm = state.assembledCache[state.activeGameId];
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

  // Toggle in-browser source editor
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
    const editedText = editorEl.value;
    state.rawSources[state.activeGameId] = editedText;
    state.assembledCache[state.activeGameId] = assembleOceanSource(editedText);

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

  // Directives Modal
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

  // Global keyboard shortcuts (when not typing in search or source editor)
  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.code === "Space") {
      e.preventDefault();
      setPlayingState(!state.isPlaying);
    } else if (e.key === "[") {
      stepTrack(-1);
    } else if (e.key === "]") {
      stepTrack(1);
    } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
      const ch = parseInt(e.key, 10) - 1;
      const btn = document.querySelector(`[data-mute="${ch}"]`);
      if (btn) btn.click();
    } else if (/^[a-zA-Z+\-@*]$/.test(e.key)) {
      if (state.wasm) {
        ensureAudioContext();
        if (!state.isPlaying) setPlayingState(true);
        state.wasm.wasm_inject_key(e.key.toUpperCase().charCodeAt(0));
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
