// ============================================================================
// Deep Audio & C64 Emulation Module (createWorkbenchPlayer)
// Shared between the browser SPA (src/app.js) and automated test suites.
// ============================================================================

import { assembleOceanSource } from "./ocean_assembler.js";
import { GAME_FILES } from "./tracks_catalog.js";

export function createWorkbenchPlayer({
  wasm,
  rawSources,
  createAudioContext,
  navigatorObj,
}) {
  const sources = { ...rawSources };
  const assembledCache = {};

  for (const [name, text] of Object.entries(sources)) {
    assembledCache[name] = assembleOceanSource(text);
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

  function getRamView() {
    return new Uint8Array(wasm.memory.buffer, wasm.wasm_get_ram_ptr(), 65536);
  }

  function updateEffectiveMuteMask() {
    const activeTrack = getActiveTrack();
    if (activeTrack && activeTrack.drumsSolo && state.soloVoice < 0 && state.muteMask === 0) {
      wasm.wasm_set_voice_mute_mask(0x07);
      return;
    }
    if (activeTrack && activeTrack.mode === "morse_solo" && state.soloVoice < 0 && state.muteMask === 0) {
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
      ram[0xD800 + i] = 15;
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

  function loadTrackIntoEmulator(gameId, track) {
    wasm.wasm_init(state.sampleRate);
    applyHardwareSettings();

    const ram = getRamView();

    if (gameId === "wizball.asm") {
      const asm = assembledCache["wizball.asm"];
      ram.set(asm.mem);
      const s = asm.symbols;
      wasm.wasm_set_custom_keyscan(s.KeyScan);
      wasm.wasm_jsr(s.InitScreen, 0, 0, 0, 200000);
      wasm.wasm_jsr(s.InitKeyScan, 0, 0, 0, 10000);
      wasm.wasm_jsr(s.INITSOUND, 0, 0, 0, 50000);

      const keyChar = track.key ? track.key.charCodeAt(0) : 65;
      const tuneIdx = keyChar - 65;
      let tuneAddr = s.FilthRaid;
      if (s.DVTABL && tuneIdx >= 0 && tuneIdx < 26) {
        const lo = ram[s.DVTABL + tuneIdx * 2];
        const hi = ram[s.DVTABL + tuneIdx * 2 + 1];
        const resolved = lo | (hi << 8);
        if (resolved) tuneAddr = resolved;
      }
      wasm.wasm_jsr(tuneAddr, 0, 0, 0, 50000);

      ram[s.RF] = 7;
      if (s.D1 !== undefined && s.FMC !== undefined) {
        ram[s.D1 + s.FMC] = 0;
        ram[s.D1 + s.PMC] = 0;
      }
      const refsp = track.refsp || 0x0040;
      ram[s.Refsp] = refsp & 0xFF;
      ram[s.Refsp + 1] = (refsp >> 8) & 0xFF;
      wasm.wasm_inject_key(keyChar);
      wasm.wasm_set_cpu_state(s.DLoop, 0, 0, 0, 0xFD, 0x24);
      updateEffectiveMuteMask();
      return;
    }

    if (gameId === "arkadrum.asm" || gameId === "arkanoid.asm") {
      const asmArk = assembledCache["arkanoid.asm"];
      const asmDrm = assembledCache["arkadrum.asm"];
      ram.set(asmArk.mem);
      for (let i = 0x4000; i < 0x6000; i++) {
        if (asmDrm.mem[i] !== 0) ram[i] = asmDrm.mem[i];
      }
      const sA = asmArk.symbols;
      const sD = asmDrm.symbols;

      if (track.withDrums) {
        wasm.wasm_jsr(sA.InitScreen, 0, 0, 0, 200000);
        ram[sA.RF] = 7;
        wasm.wasm_jsr(sD.INITRASTERS, 0, 0, 0, 50000);
        wasm.wasm_jsr(sD.INITSOUND, 0, 0, 0, 50000);
        const riffAddr = track.riff === "eNTERDATA" ? sD.eNTERDATA : sD.TITLEDATA;
        const riffClk = track.riffClk || 2;
        wasm.wasm_jsr(
          sD.RIFF,
          riffClk,
          riffAddr & 0xFF,
          (riffAddr >> 8) & 0xFF,
          10000
        );
        wasm.wasm_jsr(sD.TUNE, 0, 0, track.tuneY, 50000);
        wasm.wasm_set_cpu_state(sD.MAIN, 0, 0, 0, 0xFD, 0x20);
      } else {
        wasm.wasm_jsr(sA.InitScreen, 0, 0, 0, 200000);
        wasm.wasm_jsr(sA.INITSOUND, 0, 0, 0, 50000);
        wasm.wasm_write_bus(0xD418, 0x0F);
        if (sA.D418 !== undefined) ram[sA.D418] = 0x0F;
        ram[sA.RF] = 7;
        const refsp = track.refsp || 0x0080;
        ram[sA.Refsp] = refsp & 0xFF;
        ram[sA.Refsp + 1] = (refsp >> 8) & 0xFF;
        wasm.wasm_inject_key(track.key.charCodeAt(0));
        wasm.wasm_set_cpu_state(sA.DLoop, 0, 0, 0, 0xFD, 0x24);
      }
      updateEffectiveMuteMask();
      return;
    }

    if (gameId === "gameover.asm") {
      const asm = assembledCache["gameover.asm"];
      ram.set(asm.mem);
      const s = asm.symbols;

      if (track.withDrums) {
        wasm.wasm_set_cpu_state(s.Start, 0, 0, 0, 0xFD, 0x24);
        if (track.skipFrames && track.skipFrames > 0) {
          wasm.wasm_fast_forward_frames(track.skipFrames);
        }
      } else {
        wasm.wasm_jsr(s.InitScreen, 0, 0, 0, 200000);
        wasm.wasm_jsr(s.INITSOUND, 0, 0, 0, 50000);
        wasm.wasm_write_bus(0xD418, 0x0F);
        ram[s.RF] = 7;
        const refsp = track.refsp || 0x0040;
        ram[s.Refsp] = refsp & 0xFF;
        ram[s.Refsp + 1] = (refsp >> 8) & 0xFF;
        wasm.wasm_inject_key(track.key.charCodeAt(0));
        wasm.wasm_set_cpu_state(s.DLoop, 0, 0, 0, 0xFD, 0x24);
      }
      updateEffectiveMuteMask();
      return;
    }

    if (gameId === "greenberet.asm") {
      const asm = assembledCache["greenberet.asm"];
      ram.set(asm.mem);
      const s = asm.symbols;
      wasm.wasm_jsr(s.setscreen, 0, 0, 0, 200000);
      wasm.wasm_jsr(s.FULLRESET, 0, 0, 0, 50000);
      wasm.wasm_set_cpu_state(s.START, 0, 0, 0, 0xFD, 0x24);
      wasm.wasm_inject_key(track.key.charCodeAt(0));
      updateEffectiveMuteMask();
      return;
    }

    if (gameId === "rambload.asm") {
      const asm = assembledCache["rambload.asm"];
      ram.set(asm.mem);
      const s = asm.symbols;
      initRamboMonitorScreen(ram);
      ram[s.START + 6] = 0x4C;
      ram[s.START + 7] = (s.L - 3) & 0xFF;
      ram[s.START + 8] = ((s.L - 3) >> 8) & 0xFF;
      wasm.wasm_set_cpu_state(s.START, 0, 0, 0, 0xFD, 0x24);

      if (track.skipFrames && track.skipFrames > 0) {
        wasm.wasm_fast_forward_frames(track.skipFrames);
      }
      updateEffectiveMuteMask();
      return;
    }
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
    const wasmL = new Float32Array(
      wasm.memory.buffer,
      wasm.wasm_get_audio_l_ptr(),
      n
    );
    const wasmR = new Float32Array(
      wasm.memory.buffer,
      wasm.wasm_get_audio_r_ptr(),
      n
    );
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
    wasm.wasm_inject_key(charCode & 0xFF);
  }

  function setHardwareOptions(opts = {}) {
    if (opts.sidModel8580 !== undefined) state.sidModel8580 = Boolean(opts.sidModel8580);
    if (opts.videoNtsc !== undefined) state.videoNtsc = Boolean(opts.videoNtsc);
    if (opts.digiBoost !== undefined) state.digiBoost = Number(opts.digiBoost);
    if (opts.muteMask !== undefined) state.muteMask = opts.muteMask & 0x0F;
    if (opts.soloVoice !== undefined) state.soloVoice = opts.soloVoice;
    if (opts.isFastForward !== undefined) state.isFastForward = Boolean(opts.isFastForward);
    if (opts.sampleRate !== undefined) state.sampleRate = Number(opts.sampleRate);
    applyHardwareSettings();
  }

  function updateSource(gameId, newAsmText) {
    sources[gameId] = newAsmText;
    assembledCache[gameId] = assembleOceanSource(newAsmText);
    return assembledCache[gameId];
  }

  return {
    wasm,
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
    getAssembled: (gameId) => assembledCache[gameId],
    getState: () => ({ ...state }),
  };
}
