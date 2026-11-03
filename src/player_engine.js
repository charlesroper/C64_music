// ============================================================================
// Deep Audio & C64 Emulation Module (createWorkbenchPlayer)
// Shared between the browser SPA (src/app.js) and automated test suites.
// ============================================================================

import { assembleOceanSource } from "./ocean_assembler.js";
import { GAME_FILES } from "./tracks_catalog.js";

export function jsr(wasm, pc, a = 0, x = 0, y = 0, maxCycles = 50000) {
  wasm.wasm_jsr(pc, a, x, y, maxCycles);
}

export function writeWord(ram, addr, val) {
  ram[addr] = val & 0xff;
  ram[addr + 1] = (val >> 8) & 0xff;
}

export function readWord(ram, addr) {
  return ram[addr] | (ram[addr + 1] << 8);
}

export function setCpuState(wasm, pc, a = 0, x = 0, y = 0, sp = 0xfd, status = 0x24) {
  wasm.wasm_set_cpu_state(pc, a, x, y, sp, status);
}

export function loadWizball({ wasm, ram, track, asm }) {
  ram.set(asm.mem);
  const s = asm.symbols;
  wasm.wasm_set_custom_keyscan(s.KeyScan);
  jsr(wasm, s.InitScreen, 0, 0, 0, 200000);
  jsr(wasm, s.InitKeyScan, 0, 0, 0, 10000);
  jsr(wasm, s.INITSOUND, 0, 0, 0, 50000);

  const keyChar = track.key ? track.key.charCodeAt(0) : 65;
  const tuneIdx = keyChar - 65;
  let tuneAddr = s.FilthRaid;
  if (s.DVTABL && tuneIdx >= 0 && tuneIdx < 26) {
    const resolved = readWord(ram, s.DVTABL + tuneIdx * 2);
    if (resolved) tuneAddr = resolved;
  }
  jsr(wasm, tuneAddr, 0, 0, 0, 50000);

  ram[s.RF] = 7;
  if (s.D1 !== undefined) {
    if (s.FMC !== undefined) ram[s.D1 + s.FMC] = 0;
    if (s.PMC !== undefined) ram[s.D1 + s.PMC] = 0;
  }
  const refsp = track.refsp || 0x0040;
  writeWord(ram, s.Refsp, refsp);
  wasm.wasm_inject_key(keyChar);
  setCpuState(wasm, s.DLoop, 0, 0, 0, 0xfd, 0x24);
}

export function loadArkanoid({ wasm, ram, track, asm }) {
  ram.set(asm.mem);
  const sA = asm.symbols;
  jsr(wasm, sA.InitScreen, 0, 0, 0, 200000);
  jsr(wasm, sA.INITSOUND, 0, 0, 0, 50000);
  wasm.wasm_write_bus(0xd418, 0x0f);
  if (sA.D418 !== undefined) ram[sA.D418] = 0x0f;
  ram[sA.RF] = 7;
  const refsp = track.refsp || 0x0080;
  writeWord(ram, sA.Refsp, refsp);
  if (track.key) wasm.wasm_inject_key(track.key.charCodeAt(0));
  setCpuState(wasm, sA.DLoop, 0, 0, 0, 0xfd, 0x24);
}

export function loadArkadrum({ wasm, ram, track, asm, getAssembled }) {
  const asmArk = getAssembled ? getAssembled("arkanoid.asm") : null;
  const asmDrm = asm;
  if (asmArk) {
    ram.set(asmArk.mem);
  }
  for (let i = 0x4000; i < 0x6000; i++) {
    if (asmDrm.mem[i] !== 0) ram[i] = asmDrm.mem[i];
  }
  const sA = asmArk ? asmArk.symbols : {};
  const sD = asmDrm.symbols;

  if (track.withDrums) {
    jsr(wasm, sA.InitScreen, 0, 0, 0, 200000);
    ram[sA.RF] = 7;
    jsr(wasm, sD.INITRASTERS, 0, 0, 0, 50000);
    jsr(wasm, sD.INITSOUND, 0, 0, 0, 50000);
    const riffAddr = track.riff === "eNTERDATA" ? sD.eNTERDATA : sD.TITLEDATA;
    const riffClk = track.riffClk || 2;
    jsr(wasm, sD.RIFF, riffClk, riffAddr & 0xff, (riffAddr >> 8) & 0xff, 10000);
    jsr(wasm, sD.TUNE, 0, 0, track.tuneY, 50000);
    setCpuState(wasm, sD.MAIN, 0, 0, 0, 0xfd, 0x20);
  } else if (asmArk) {
    loadArkanoid({ wasm, ram, track, asm: asmArk });
  }
}

export function loadGameover({ wasm, ram, track, asm }) {
  ram.set(asm.mem);
  const s = asm.symbols;

  if (track.withDrums) {
    setCpuState(wasm, s.Start, 0, 0, 0, 0xfd, 0x24);
    if (track.skipFrames && track.skipFrames > 0) {
      wasm.wasm_fast_forward_frames(track.skipFrames);
    }
  } else {
    jsr(wasm, s.InitScreen, 0, 0, 0, 200000);
    jsr(wasm, s.INITSOUND, 0, 0, 0, 50000);
    wasm.wasm_write_bus(0xd418, 0x0f);
    ram[s.RF] = 7;
    const refsp = track.refsp || 0x0040;
    writeWord(ram, s.Refsp, refsp);
    if (track.key) wasm.wasm_inject_key(track.key.charCodeAt(0));
    setCpuState(wasm, s.DLoop, 0, 0, 0, 0xfd, 0x24);
  }
}

export function loadGreenberet({ wasm, ram, track, asm }) {
  ram.set(asm.mem);
  const s = asm.symbols;
  jsr(wasm, s.setscreen, 0, 0, 0, 200000);
  jsr(wasm, s.FULLRESET, 0, 0, 0, 50000);
  setCpuState(wasm, s.START, 0, 0, 0, 0xfd, 0x24);
  if (track.key) wasm.wasm_inject_key(track.key.charCodeAt(0));
}

export function loadRambload({ wasm, ram, track, asm, initMonitorScreen }) {
  ram.set(asm.mem);
  const s = asm.symbols;
  if (initMonitorScreen) {
    initMonitorScreen(ram);
  }
  ram[s.START + 6] = 0x4c;
  writeWord(ram, s.START + 7, s.L - 3);
  setCpuState(wasm, s.START, 0, 0, 0, 0xfd, 0x24);

  if (track.skipFrames && track.skipFrames > 0) {
    wasm.wasm_fast_forward_frames(track.skipFrames);
  }
}

export const GAME_LOADERS = {
  "wizball.asm": loadWizball,
  "arkanoid.asm": loadArkanoid,
  "arkadrum.asm": loadArkadrum,
  "gameover.asm": loadGameover,
  "greenberet.asm": loadGreenberet,
  "rambload.asm": loadRambload,
};

export function createWorkbenchPlayer({ wasm, rawSources, createAudioContext, navigatorObj }) {
  const sources = { ...rawSources };
  const assembledCache = {};

  function getAssembled(gameId) {
    if (!assembledCache[gameId] && sources[gameId]) {
      assembledCache[gameId] = assembleOceanSource(sources[gameId]);
    }
    return assembledCache[gameId];
  }

  const state = {
    isPlaying: false,
    isFastForward: false,
    activeGameId: "wizball.asm",
    activeTrackId: "wiz-title",
    sidModel8580: false,
    videoNtsc: false,
    digiBoost: 1.3,
    muteMask: 0,
    soloVoice: -1,
    sampleRate: 48000,
    audioCtx: null,
    scriptNode: null,
    keepAliveSource: null,
  };

  wasm.wasm_init(state.sampleRate);
  getAssembled(state.activeGameId);

  let cachedBuffer = null;
  let cachedRam = null;
  let cachedBorder = null;
  let cachedSidRegs = null;
  let cachedScope = null;

  function refreshViews() {
    if (cachedBuffer !== wasm.memory.buffer) {
      cachedBuffer = wasm.memory.buffer;
      cachedRam = new Uint8Array(cachedBuffer, wasm.wasm_get_ram_ptr(), 65536);
      cachedBorder = new Uint8Array(cachedBuffer, wasm.wasm_get_border_ptr(), 312);
      cachedSidRegs = new Uint8Array(cachedBuffer, wasm.wasm_get_sid_regs_ptr(), 32);
      cachedScope = new Float32Array(cachedBuffer, wasm.wasm_get_scope_ptr(), 4 * 512);
    }
  }

  function getRamView() {
    refreshViews();
    return cachedRam;
  }

  const telemetry = {
    frameCount: 0,
    cpuPc: 0,
    d418: 0,
    sidRegs: null,
    scopeData: null,
    voices: [
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
    ],
    filter: {
      fc: 0,
      res: 0,
      rout: 0,
      mode: 0,
      vol: 0,
    },
    scanlineBorder: null,
    ram: null,
    morseIndex: -1,
  };

  function updateRamboMonitorScreen(ram, asm) {
    const s = asm.symbols;
    for (let i = 0; i < 16; i++) {
      ram[0x0400 + 5 * 40 + 2 + i] = ram[0x10 + i];
      ram[0xd800 + 5 * 40 + 2 + i] = 3;
    }
    if (s.SB0 && s.SB1 && s.SB2) {
      for (let i = 0; i < 38; i++) {
        ram[0x0400 + 14 * 40 + 1 + i] = ram[s.SB0 + i];
        ram[0xd800 + 14 * 40 + 1 + i] = 3;
        ram[0x0400 + 16 * 40 + 1 + i] = ram[s.SB1 + i];
        ram[0xd800 + 16 * 40 + 1 + i] = 4;
        ram[0x0400 + 18 * 40 + 1 + i] = ram[s.SB2 + i];
        ram[0xd800 + 18 * 40 + 1 + i] = 7;
      }
    }
  }

  function getTelemetry() {
    refreshViews();

    if (state.activeGameId === "rambload.asm") {
      const asm = getAssembled("rambload.asm");
      if (asm) {
        updateRamboMonitorScreen(cachedRam, asm);
        if (asm.symbols.MWK !== undefined) {
          telemetry.morseIndex = cachedRam[asm.symbols.MWK] >> 1;
        } else {
          telemetry.morseIndex = -1;
        }
      }
    } else {
      telemetry.morseIndex = -1;
    }

    telemetry.frameCount = wasm.wasm_get_frame_count();
    telemetry.cpuPc = wasm.wasm_get_cpu_pc();
    telemetry.d418 = wasm.wasm_get_d418_activity();
    telemetry.sidRegs = cachedSidRegs;
    telemetry.scopeData = cachedScope;
    telemetry.scanlineBorder = cachedBorder;
    telemetry.ram = cachedRam;

    for (let v = 0; v < 3; v++) {
      const voice = telemetry.voices[v];
      voice.freq = wasm.wasm_get_voice_freq(v);
      voice.pw = wasm.wasm_get_voice_pw(v);
      voice.ctrl = wasm.wasm_get_voice_control(v);
      voice.env = wasm.wasm_get_voice_env(v);
    }

    const flt = telemetry.filter;
    flt.fc = wasm.wasm_get_filter_fc();
    flt.res = wasm.wasm_get_filter_res();
    flt.rout = wasm.wasm_get_filter_routing();
    flt.mode = wasm.wasm_get_filter_mode();
    flt.vol = wasm.wasm_get_master_vol();

    return telemetry;
  }

  function updateEffectiveMuteMask() {
    const activeTrack = getActiveTrack();
    if (activeTrack && activeTrack.drumsSolo && state.soloVoice < 0 && state.muteMask === 0) {
      wasm.wasm_set_voice_mute_mask(0x07);
      return;
    }
    if (
      activeTrack &&
      activeTrack.mode === "morse_solo" &&
      state.soloVoice < 0 &&
      state.muteMask === 0
    ) {
      wasm.wasm_set_voice_mute_mask(0x06);
      return;
    }
    let mask = state.muteMask;
    if (state.soloVoice >= 0) {
      mask = 0x07 & ~(1 << state.soloVoice);
    }
    wasm.wasm_set_voice_mute_mask(mask);
  }

  function applyHardwareSettings() {
    wasm.wasm_set_sample_rate(state.sampleRate);
    wasm.wasm_set_sid_model(state.sidModel8580 ? 1 : 0);
    wasm.wasm_set_video_standard(state.videoNtsc ? 1 : 0);
    wasm.wasm_set_digi_boost(state.digiBoost);
    updateEffectiveMuteMask();
  }

  function getActiveGame() {
    return GAME_FILES.find((g) => g.id === state.activeGameId) || GAME_FILES[0];
  }

  function getActiveTrack() {
    const game = getActiveGame();
    return game.tracks.find((t) => t.id === state.activeTrackId) || game.tracks[0];
  }

  function initRamboMonitorScreen(ram) {
    for (let i = 0; i < 1000; i++) {
      ram[0x0400 + i] = 0x20;
      ram[0xd800 + i] = 15;
    }
    const writeStr = (row, col, text, color = 1) => {
      const base = row * 40 + col;
      for (let i = 0; i < text.length && col + i < 40; i++) {
        ram[0x0400 + base + i] = text.charCodeAt(i);
        ram[0xd800 + base + i] = color;
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

  function loadTrackIntoEmulator(gameId, track) {
    wasm.wasm_init(state.sampleRate);
    applyHardwareSettings();

    const loader = GAME_LOADERS[gameId];
    if (loader) {
      const ram = getRamView();
      const asm = getAssembled(gameId);
      loader({
        wasm,
        ram,
        track,
        asm,
        getAssembled,
        initMonitorScreen: initRamboMonitorScreen,
      });
    }
    updateEffectiveMuteMask();
  }

  function pullAudioBlock(outL, outR) {
    const n = outL.length;
    if (!state.isPlaying) {
      outL.fill(0);
      outR.fill(0);
      return;
    }

    if (state.isFastForward) {
      wasm.wasm_fast_forward_frames(3);
    }

    wasm.wasm_render_audio(n);
    const wasmL = new Float32Array(wasm.memory.buffer, wasm.wasm_get_audio_l_ptr(), n);
    const wasmR = new Float32Array(wasm.memory.buffer, wasm.wasm_get_audio_r_ptr(), n);
    outL.set(wasmL);
    outR.set(wasmR);
  }

  function ensureAudio() {
    if (navigatorObj && navigatorObj.audioSession) {
      try {
        navigatorObj.audioSession.type = "playback";
      } catch (_) {
        // Ignore on browsers where audioSession.type is read-only
      }
    }

    if (!state.audioCtx && createAudioContext) {
      let ctx;
      try {
        ctx = createAudioContext({ sampleRate: 48000 });
      } catch (_) {
        ctx = createAudioContext();
      }
      state.audioCtx = ctx;
      state.sampleRate = ctx.sampleRate || 48000;
      wasm.wasm_set_sample_rate(state.sampleRate);

      const bufferSize = 2048;
      // Use 1 input channel + started looping silent BufferSourceNode so WebKit/iOS Safari
      // reliably pulls through the ScriptProcessorNode without stalling or GCing it.
      const scriptNode = ctx.createScriptProcessor(bufferSize, 1, 2);
      scriptNode.onaudioprocess = (e) => {
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        pullAudioBlock(outL, outR);
      };

      const silentBuf = ctx.createBuffer(1, 128, state.sampleRate);
      const keepAlive = ctx.createBufferSource();
      keepAlive.buffer = silentBuf;
      keepAlive.loop = true;
      keepAlive.connect(scriptNode);
      scriptNode.connect(ctx.destination);
      keepAlive.start(0);

      state.scriptNode = scriptNode;
      state.keepAliveSource = keepAlive;
    }

    if (state.audioCtx && state.audioCtx.state !== "running") {
      state.audioCtx.resume();
    }
  }

  function selectTrack(gameId, trackId, { autoPlay = false } = {}) {
    const game = GAME_FILES.find((g) => g.id === gameId) || GAME_FILES[0];
    const track = game.tracks.find((t) => t.id === trackId) || game.tracks[0];
    state.activeGameId = game.id;
    state.activeTrackId = track.id;

    loadTrackIntoEmulator(game.id, track);

    if (autoPlay) {
      ensureAudio();
      state.isPlaying = true;
    } else {
      // Populate initial C64 screen RAM while paused
      wasm.wasm_render_audio(2048);
    }
    return { game, track };
  }

  function play() {
    ensureAudio();
    state.isPlaying = true;
  }

  function pause() {
    state.isPlaying = false;
  }

  function togglePlay() {
    if (state.isPlaying) pause();
    else play();
    return state.isPlaying;
  }

  function injectKey(charCode) {
    wasm.wasm_inject_key(charCode & 0xff);
  }

  function setHardwareOptions(opts = {}) {
    if (opts.sidModel8580 !== undefined) state.sidModel8580 = Boolean(opts.sidModel8580);
    if (opts.videoNtsc !== undefined) state.videoNtsc = Boolean(opts.videoNtsc);
    if (opts.digiBoost !== undefined) state.digiBoost = Number(opts.digiBoost);
    if (opts.muteMask !== undefined) state.muteMask = opts.muteMask & 0x0f;
    if (opts.soloVoice !== undefined) state.soloVoice = opts.soloVoice;
    if (opts.isFastForward !== undefined) state.isFastForward = Boolean(opts.isFastForward);
    if (opts.sampleRate !== undefined) state.sampleRate = Number(opts.sampleRate);
    applyHardwareSettings();
  }

  function updateSource(gameId, newAsmText) {
    const assembled = assembleOceanSource(newAsmText);
    sources[gameId] = newAsmText;
    assembledCache[gameId] = assembled;
    return assembled;
  }

  return {
    getTelemetry,
    selectTrack,
    play,
    pause,
    togglePlay,
    pullAudioBlock,
    injectKey,
    setHardwareOptions,
    updateSource,
    getRamView,
    getRawSource: (gameId) => sources[gameId],
    getAssembled,
    getAssembledCache: () => assembledCache,
    getState: () => ({ ...state }),
  };
}
