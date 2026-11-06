// ============================================================================
// Player Engine (createWorkbenchPlayer)
// Main-thread module: assembles 6502 sources, holds playback and hardware
// state, and drives the Engine Core through an AudioWorklet MessagePort.
// An in-thread transport keeps Node tests and legacy browsers working.
// ============================================================================

import { createEngineCore } from "./engine_core.js";
import { assembleOceanSource } from "./ocean_assembler.js";
import { applyTelemetry, createTelemetrySnapshot } from "./telemetry_buffer.js";
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
    kind: "in-thread",
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

function createWorkletTransport({
  audioCtx,
  wasmModule,
  workletUrl,
  sampleRate,
  onReady,
  onTelemetry,
  onError,
}) {
  let node = null;
  const latestTelemetry = createTelemetrySnapshot();
  let latestTelemetryBuffer = null;
  let hasTelemetry = false;
  const pending = [];

  const fail = (error) => {
    if (onError) onError(error);
  };

  audioCtx.audioWorklet
    .addModule(workletUrl)
    .then(() => {
      node = new AudioWorkletNode(audioCtx, "c64-engine", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasmModule, sampleRate },
      });
      node.port.onmessage = (event) => {
        const message = event.data;
        if (!message) return;
        if (message.type === "telemetry") {
          const previousBuffer = latestTelemetryBuffer;
          latestTelemetryBuffer = message.buffer;
          applyTelemetry(latestTelemetry, message.header, message.buffer);
          hasTelemetry = true;
          if (previousBuffer) {
            node.port.postMessage({ type: "telemetry-recycle", buffer: previousBuffer }, [
              previousBuffer,
            ]);
          }
          if (onTelemetry) onTelemetry(latestTelemetry);
          return;
        }
        if (message.type === "ready") {
          if (onReady) onReady();
          return;
        }
        if (message.type === "error") {
          fail(new Error(message.message || "Audio worklet error"));
        }
      };
      node.connect(audioCtx.destination);
      while (pending.length > 0) node.port.postMessage(pending.shift());
    })
    .catch(fail);

  return {
    kind: "worklet",
    send(message) {
      if (node) node.port.postMessage(message);
      else pending.push(message);
    },
    renderAudio() {
      throw new Error("Audio rendering runs on the worklet thread");
    },
    requestTelemetry() {
      if (node && !hasTelemetry) node.port.postMessage({ type: "requestTelemetry" });
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

export function createWorkbenchPlayer({
  wasm,
  wasmModule,
  rawSources,
  createAudioContext,
  navigatorObj,
  workletUrl,
}) {
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
    audioBackend: null,
    workletReady: false,
    workletError: null,
  };

  const inThreadTransport = createInThreadTransport({ wasm });
  let transport = inThreadTransport;
  let lastTelemetry = null;
  let lastLoadMessage = null;
  let lastHardwareOptions = {};
  let workletAttempted = false;

  getAssembled(state.activeGameId);

  function getTelemetry() {
    const snapshot = transport.requestTelemetry();
    if (snapshot) lastTelemetry = snapshot;
    return lastTelemetry;
  }

  function getRamView() {
    const snapshot = transport.requestTelemetry();
    return snapshot ? snapshot.ram : null;
  }

  function startScriptProcessor(ctx) {
    if (state.scriptNode) return;
    state.audioBackend = "script";

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

  function startWorklet(ctx) {
    if (workletAttempted) return;
    workletAttempted = true;

    const workletTransport = createWorkletTransport({
      audioCtx: ctx,
      wasmModule,
      workletUrl,
      sampleRate: state.sampleRate,
      onTelemetry(snapshot) {
        lastTelemetry = snapshot;
      },
      onReady() {
        workletTransport.send({ type: "init", sampleRate: state.sampleRate });
        if (lastLoadMessage) workletTransport.send(lastLoadMessage);
        workletTransport.send({ type: "setHardwareOptions", options: lastHardwareOptions });
        workletTransport.send({ type: state.isPlaying ? "play" : "pause" });
        transport = workletTransport;
        state.audioBackend = "worklet";
        state.workletReady = true;
      },
      onError(error) {
        state.workletError = String(error?.message || error);
        inThreadTransport.send({ type: "init", sampleRate: state.sampleRate });
        if (lastLoadMessage) inThreadTransport.send(lastLoadMessage);
        inThreadTransport.send({ type: "setHardwareOptions", options: lastHardwareOptions });
        inThreadTransport.send({ type: state.isPlaying ? "play" : "pause" });
        transport = inThreadTransport;
        startScriptProcessor(ctx);
      },
    });
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

      if (workletUrl && wasmModule && ctx.audioWorklet) {
        startWorklet(ctx);
      } else {
        startScriptProcessor(ctx);
      }
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

    lastLoadMessage = {
      type: "loadTrack",
      gameId: game.id,
      track,
      mem: asm.mem,
      symbols: asm.symbols,
      arkanoidMem,
      arkanoidSymbols,
      autoPlay,
    };
    transport.send(lastLoadMessage);

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
    lastHardwareOptions = { ...lastHardwareOptions, ...opts };
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
