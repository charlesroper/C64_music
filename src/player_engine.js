// ============================================================================
// Player Engine (createWorkbenchPlayer)
// Main-thread module: assembles 6502 sources, holds playback and hardware
// state, and drives the Engine Core through an in-thread transport adapter.
// ============================================================================

import { createEngineCore } from "./engine_core.js";
import { assembleOceanSource } from "./ocean_assembler.js";
import { GAME_FILES } from "./tracks_catalog.js";

export {
  GAME_LOADERS,
  jsr,
  loadArkadrum,
  loadArkanoid,
  loadGameover,
  loadGreenberet,
  loadRambload,
  loadWizball,
  readWord,
  setCpuState,
  writeWord,
} from "./engine_core.js";

function createInThreadTransport({ wasm }) {
  let latestTelemetry = null;
  const core = createEngineCore({
    wasm,
    postMessage(message) {
      if (message.type === "telemetry") latestTelemetry = message.snapshot;
    },
  });

  return {
    send(message) {
      core.onmessage({ data: message });
    },
    renderAudio(outL, outR) {
      core.renderAudio(outL, outR);
    },
    requestTelemetry() {
      core.onmessage({ data: { type: "requestTelemetry" } });
      return latestTelemetry;
    },
  };
}

export function buildSessionDescriptor(game, track) {
  const pcSyms = game?.architecture?.pcSymbols || [];
  const hasDrums = Boolean(
    pcSyms.includes("seqPC") && track && (track.withDrums || track.drumsSolo || track.drumMode),
  );
  return {
    game,
    track,
    sourceFile: game.id === "arkadrum.asm" ? "arkanoid.asm" : game.id,
    drum: {
      available: hasDrums,
      symbol: hasDrums ? "seqPC" : null,
      sourceFile: game.id === "arkadrum.asm" ? "arkadrum.asm" : game.id,
    },
    pcSymbols: pcSyms,
    morse: {
      available: game.id === "rambload.asm" || Boolean(track && track.mode === "morse_solo"),
    },
  };
}

export function getSessionSourceFile(session, voice) {
  if (voice === "seq" && session && session.drum && session.drum.available) {
    return session.drum.sourceFile;
  }
  return session ? session.sourceFile : "wizball.asm";
}

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
    currentSession: null,
  };

  const transport = createInThreadTransport({ wasm });

  getAssembled(state.activeGameId);

  function getTelemetry() {
    return transport.requestTelemetry();
  }

  function getRamView() {
    const snapshot = transport.requestTelemetry();
    return snapshot ? snapshot.ram : null;
  }

  function ensureAudio() {
    if (navigatorObj?.audioSession) {
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
      transport.send({ type: "init", sampleRate: state.sampleRate });

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

  function getActiveGame() {
    return GAME_FILES.find((g) => g.id === state.activeGameId) || GAME_FILES[0];
  }

  function getActiveTrack() {
    const game = getActiveGame();
    return game.tracks.find((t) => t.id === state.activeTrackId) || game.tracks[0];
  }

  function selectTrack(gameId, trackId, { autoPlay = false } = {}) {
    const game = GAME_FILES.find((g) => g.id === gameId) || GAME_FILES[0];
    const track = game.tracks.find((t) => t.id === trackId) || game.tracks[0];
    state.activeGameId = game.id;
    state.activeTrackId = track.id;

    const asm = getAssembled(game.id);
    let arkanoidMem;
    let arkanoidSymbols;
    if (game.id === "arkadrum.asm" && track.withDrums) {
      const arkanoid = getAssembled("arkanoid.asm");
      arkanoidMem = arkanoid.mem;
      arkanoidSymbols = arkanoid.symbols;
    }

    transport.send({
      type: "loadTrack",
      gameId: game.id,
      track,
      mem: asm.mem,
      symbols: asm.symbols,
      arkanoidMem,
      arkanoidSymbols,
      autoPlay,
    });

    state.isPlaying = Boolean(autoPlay);
    if (autoPlay) ensureAudio();

    const session = buildSessionDescriptor(game, track);
    state.currentSession = session;
    return session;
  }

  function play() {
    ensureAudio();
    transport.send({ type: "play" });
    state.isPlaying = true;
  }

  function pause() {
    transport.send({ type: "pause" });
    state.isPlaying = false;
  }

  function togglePlay() {
    if (state.isPlaying) pause();
    else play();
    return state.isPlaying;
  }

  function injectKey(charCode) {
    transport.send({ type: "injectKey", charCode });
  }

  function setHardwareOptions(opts = {}) {
    if (opts.sidModel8580 !== undefined) state.sidModel8580 = Boolean(opts.sidModel8580);
    if (opts.videoNtsc !== undefined) state.videoNtsc = Boolean(opts.videoNtsc);
    if (opts.digiBoost !== undefined) state.digiBoost = Number(opts.digiBoost);
    if (opts.muteMask !== undefined) state.muteMask = opts.muteMask & 0x0f;
    if (opts.soloVoice !== undefined) state.soloVoice = opts.soloVoice;
    if (opts.isFastForward !== undefined) state.isFastForward = Boolean(opts.isFastForward);
    if (opts.sampleRate !== undefined) state.sampleRate = Number(opts.sampleRate);
    transport.send({ type: "setHardwareOptions", options: opts });
  }

  function updateSource(gameId, newAsmText) {
    const assembled = assembleOceanSource(newAsmText);
    sources[gameId] = newAsmText;
    assembledCache[gameId] = assembled;
    return assembled;
  }

  function pullAudioBlock(outL, outR) {
    if (!state.isPlaying) {
      outL.fill(0);
      outR.fill(0);
      return;
    }
    transport.renderAudio(outL, outR);
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
    getSession: () =>
      state.currentSession || buildSessionDescriptor(getActiveGame(), getActiveTrack()),
    getState: () => ({ ...state }),
  };
}
