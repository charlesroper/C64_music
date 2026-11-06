// ============================================================================
// Engine Core (createEngineCore)
// Owns the WebAssembly emulator, Loader Adapters, audio rendering and the
// Telemetry Snapshot. Runs in-thread for tests and on the audio thread later.
// ============================================================================

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

function initRamboloadMonitorScreen(ram) {
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

export function loadArkadrum({ wasm, ram, track, asm, getAssembled, arkanoidAsm }) {
  const asmArk = arkanoidAsm || (getAssembled ? getAssembled("arkanoid.asm") : null);
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

export function loadRambload({
  wasm,
  ram,
  track,
  asm,
  initMonitorScreen = initRamboloadMonitorScreen,
}) {
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

function updateRamboMonitorScreen(ram, symbols) {
  for (let i = 0; i < 16; i++) {
    ram[0x0400 + 5 * 40 + 2 + i] = ram[0x10 + i];
    ram[0xd800 + 5 * 40 + 2 + i] = 3;
  }
  if (symbols.SB0 && symbols.SB1 && symbols.SB2) {
    for (let i = 0; i < 38; i++) {
      ram[0x0400 + 14 * 40 + 1 + i] = ram[symbols.SB0 + i];
      ram[0xd800 + 14 * 40 + 1 + i] = 3;
      ram[0x0400 + 16 * 40 + 1 + i] = ram[symbols.SB1 + i];
      ram[0xd800 + 16 * 40 + 1 + i] = 4;
      ram[0x0400 + 18 * 40 + 1 + i] = ram[symbols.SB2 + i];
      ram[0xd800 + 18 * 40 + 1 + i] = 7;
    }
  }
}

export function createEngineCore({
  wasm,
  postMessage = () => {},
  sampleRate = 48000,
  telemetryInterval = 1,
}) {
  const telemetryEvery = Math.max(1, Math.floor(telemetryInterval));
  let renderCount = 0;
  let fastForwardSamples = 0;
  const state = {
    isPlaying: false,
    isLoading: false,
    isFastForward: false,
    activeGameId: null,
    activeTrackId: null,
    activeTrack: null,
    activeSymbols: null,
    sidModel8580: false,
    videoNtsc: false,
    digiBoost: 1.3,
    muteMask: 0,
    soloVoice: -1,
    sampleRate,
  };

  wasm.wasm_init(state.sampleRate);

  const pendingMessages = [];

  let cachedBuffer = null;
  let cachedRam = null;
  let cachedBorder = null;
  let cachedSidRegs = null;
  let cachedScope = null;

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

  function getTelemetry() {
    refreshViews();

    if (state.activeGameId === "rambload.asm" && state.activeSymbols) {
      updateRamboMonitorScreen(cachedRam, state.activeSymbols);
      if (state.activeSymbols.MWK !== undefined) {
        telemetry.morseIndex = cachedRam[state.activeSymbols.MWK] >> 1;
      } else {
        telemetry.morseIndex = -1;
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

  function emitTelemetry() {
    const snapshot = getTelemetry();
    postMessage({ type: "telemetry", snapshot });
    return snapshot;
  }

  function updateEffectiveMuteMask() {
    const activeTrack = state.activeTrack;
    if (activeTrack?.drumsSolo && state.soloVoice < 0 && state.muteMask === 0) {
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

  function loadTrack(message) {
    const { gameId, track, mem, symbols, arkanoidMem, arkanoidSymbols, autoPlay } = message;
    state.activeGameId = gameId;
    state.activeTrackId = track ? track.id : null;
    state.activeTrack = track || null;
    state.activeSymbols = symbols || null;
    state.isLoading = true;
    state.isPlaying = false;

    try {
      wasm.wasm_init(state.sampleRate);
      applyHardwareSettings();

      const loader = GAME_LOADERS[gameId];
      if (loader) {
        const arkanoidAsm =
          arkanoidMem && arkanoidSymbols ? { mem: arkanoidMem, symbols: arkanoidSymbols } : null;
        loader({
          wasm,
          ram: getRamView(),
          track: track || {},
          asm: { mem, symbols },
          arkanoidAsm,
          initMonitorScreen: initRamboloadMonitorScreen,
        });
      }
      updateEffectiveMuteMask();
    } finally {
      state.isLoading = false;
    }

    state.isPlaying = Boolean(autoPlay);
    emitTelemetry();
    drainPendingMessages();
  }

  function setHardwareOptions(options = {}) {
    if (options.sidModel8580 !== undefined) state.sidModel8580 = Boolean(options.sidModel8580);
    if (options.videoNtsc !== undefined) state.videoNtsc = Boolean(options.videoNtsc);
    if (options.digiBoost !== undefined) state.digiBoost = Number(options.digiBoost);
    if (options.muteMask !== undefined) state.muteMask = options.muteMask & 0x0f;
    if (options.soloVoice !== undefined) state.soloVoice = options.soloVoice;
    if (options.isFastForward !== undefined) {
      state.isFastForward = Boolean(options.isFastForward);
    }
    if (options.sampleRate !== undefined) state.sampleRate = Number(options.sampleRate);
    applyHardwareSettings();
  }

  function renderInto(outL, outR) {
    const n = outL.length;
    if (state.isLoading || !state.isPlaying) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return;
    }

    if (state.isFastForward) {
      fastForwardSamples += n;
      while (fastForwardSamples >= 2048) {
        wasm.wasm_fast_forward_frames(3);
        fastForwardSamples -= 2048;
      }
    } else {
      fastForwardSamples = 0;
    }

    wasm.wasm_render_audio(n);
    refreshViews();
    const wasmL = new Float32Array(wasm.memory.buffer, wasm.wasm_get_audio_l_ptr(), n);
    const wasmR = new Float32Array(wasm.memory.buffer, wasm.wasm_get_audio_r_ptr(), n);
    outL.set(wasmL);
    if (outR) outR.set(wasmR);

    renderCount++;
    if (renderCount % telemetryEvery === 0) emitTelemetry();
  }

  function renderAudio(outLOrLength, outR) {
    if (typeof outLOrLength === "number") {
      const left = new Float32Array(outLOrLength);
      const right = new Float32Array(outLOrLength);
      renderInto(left, right);
      return { left, right };
    }
    renderInto(outLOrLength, outR);
    return { left: outLOrLength, right: outR };
  }

  function drainPendingMessages() {
    while (pendingMessages.length > 0) {
      dispatchMessage(pendingMessages.shift());
    }
  }

  function dispatchMessage(message) {
    switch (message.type) {
      case "init":
        state.sampleRate = Number(message.sampleRate) || state.sampleRate;
        wasm.wasm_set_sample_rate(state.sampleRate);
        break;
      case "loadTrack":
        loadTrack(message);
        break;
      case "play":
        state.isPlaying = true;
        break;
      case "pause":
        state.isPlaying = false;
        break;
      case "setHardwareOptions":
        setHardwareOptions(message.options);
        break;
      case "injectKey":
        wasm.wasm_inject_key(message.charCode & 0xff);
        break;
      case "requestTelemetry":
        emitTelemetry();
        break;
      default:
        break;
    }
  }

  function onmessage(event) {
    const message = event && event.data !== undefined ? event.data : event;
    if (!message?.type) return;
    if (state.isLoading) {
      pendingMessages.push(message);
      return;
    }
    dispatchMessage(message);
  }

  return {
    onmessage,
    renderAudio,
  };
}
