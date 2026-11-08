// ============================================================================
// Player Engine (createWorkbenchPlayer)
// Main-thread module: assembles 6502 sources, holds playback and hardware
// state, and drives the Engine Core through an AudioWorklet MessagePort.
// An in-thread transport keeps Node tests and legacy browsers working.
// ============================================================================

import { createEngineCore } from "./engine_core.js";
import { assembleOceanSource, createSourceIndex } from "./ocean_assembler.js";
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
  let closed = false;
  const latestTelemetry = createTelemetrySnapshot();
  let latestTelemetryBuffer = null;
  let latestDiagnostics = null;
  let hasTelemetry = false;
  const pending = [];

  const fail = (error) => {
    if (!closed && onError) onError(error);
  };

  audioCtx.audioWorklet
    .addModule(workletUrl)
    .then(() => {
      if (closed) return;
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
          applyTelemetry(latestTelemetry, message.buffer);
          hasTelemetry = true;
          if (previousBuffer) {
            node.port.postMessage({ type: "telemetry-recycle", buffer: previousBuffer }, [
              previousBuffer,
            ]);
          }
          if (onTelemetry) onTelemetry(latestTelemetry);
          return;
        }
        if (message.type === "audio-diagnostics") {
          latestDiagnostics = message.diagnostics;
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
      if (closed) return;
      if (node) node.port.postMessage(message);
      else pending.push(message);
    },
    renderAudio() {
      throw new Error("Audio rendering runs on the worklet thread");
    },
    requestTelemetry() {
      if (!closed && node && !hasTelemetry) {
        node.port.postMessage({ type: "requestTelemetry" });
      }
      return latestTelemetry;
    },
    getDiagnostics() {
      return latestDiagnostics;
    },
    close() {
      closed = true;
      pending.length = 0;
      if (!node) return;
      if (node.port) node.port.onmessage = null;
      if (typeof node.disconnect === "function") node.disconnect();
      node = null;
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

function createDefaultAssemblyWorker() {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./assembly_worker.js", import.meta.url), { type: "module" });
}

export function createWorkbenchPlayer({
  wasm,
  wasmModule,
  rawSources,
  createAudioContext,
  navigatorObj,
  workletUrl,
  createAssemblyWorker = createDefaultAssemblyWorker,
  latencyHint = "playback",
}) {
  const sources = { ...rawSources };
  const assembledCache = {};
  let prewarmPromise = null;

  function getAssembled(gameId) {
    if (!assembledCache[gameId] && sources[gameId]) {
      assembledCache[gameId] = assembleOceanSource(sources[gameId]);
    }
    return assembledCache[gameId];
  }

  function hydrateAssembly(assembled) {
    if (!assembled) return assembled;
    if (assembled.sourceIndex) return assembled;
    return { ...assembled, sourceIndex: createSourceIndex(assembled) };
  }

  function prewarmAssemblies() {
    if (prewarmPromise) return prewarmPromise;
    const sourceSnapshot = { ...sources };
    let worker = null;
    try {
      worker = createAssemblyWorker ? createAssemblyWorker() : null;
    } catch (_) {
      worker = null;
    }
    if (!worker) {
      prewarmPromise = Promise.resolve(false);
      return prewarmPromise;
    }

    prewarmPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (typeof worker.terminate === "function") worker.terminate();
        resolve(ok);
      };

      worker.onmessage = (event) => {
        const data = event?.data || {};
        if (data.error || !data.results) {
          finish(false);
          return;
        }
        for (const [gameId, assembled] of Object.entries(data.results)) {
          if (sources[gameId] !== sourceSnapshot[gameId]) continue;
          assembledCache[gameId] = hydrateAssembly(assembled);
        }
        finish(true);
      };
      worker.onerror = () => finish(false);

      try {
        worker.postMessage({ sources: sourceSnapshot });
      } catch (_) {
        finish(false);
      }
    });
    return prewarmPromise;
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
    latencyHint: latencyHint === "interactive" ? "interactive" : "playback",
    audioCtx: null,
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
  let restartQueue = Promise.resolve();
  const contextEvents = [];

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

  function getAudioDiagnostics() {
    const ctx = state.audioCtx;
    const workletDiagnostics = transport.getDiagnostics ? transport.getDiagnostics() : null;
    return {
      backend: state.audioBackend,
      contextState: ctx ? ctx.state : "none",
      sampleRate: state.sampleRate,
      latencyHint: state.latencyHint,
      baseLatency: ctx?.baseLatency ?? null,
      outputLatency: ctx?.outputLatency ?? null,
      contextEvents: contextEvents.slice(),
      ...(workletDiagnostics || {}),
    };
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
        state.audioBackend = "in-thread";
      },
    });
  }

  function handleContextState() {
    const ctx = state.audioCtx;
    if (!ctx) return;
    contextEvents.push({ state: ctx.state, at: Date.now() });
    if (contextEvents.length > 20) contextEvents.shift();
    if (transport.kind === "worklet") {
      transport.send({ type: "audio-interruption", active: ctx.state !== "running" });
    }
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
        ctx = createAudioContext({ sampleRate: 48000, latencyHint: state.latencyHint });
      } catch (_) {
        ctx = createAudioContext();
      }
      state.audioCtx = ctx;
      state.sampleRate = ctx.sampleRate || 48000;
      if (typeof ctx.addEventListener === "function") {
        ctx.addEventListener("statechange", handleContextState);
      }
      transport.send({ type: "init", sampleRate: state.sampleRate });

      if (workletUrl && wasmModule && ctx.audioWorklet) {
        startWorklet(ctx);
      } else {
        state.audioBackend = "in-thread";
      }
    }

    if (state.audioCtx && state.audioCtx.state !== "running") {
      state.audioCtx.resume();
    }
  }

  function closeAudioContext() {
    const ctx = state.audioCtx;
    if (transport && typeof transport.close === "function") transport.close();
    transport = inThreadTransport;
    state.audioCtx = null;
    state.audioBackend = null;
    state.workletReady = false;
    state.workletError = null;
    workletAttempted = false;

    if (!ctx || typeof ctx.close !== "function") return Promise.resolve();
    try {
      const result = ctx.close();
      return result && typeof result.then === "function"
        ? result.catch(() => {})
        : Promise.resolve();
    } catch (_) {
      return Promise.resolve();
    }
  }

  async function restartAudio() {
    const wasPlaying = state.isPlaying;
    await closeAudioContext();

    inThreadTransport.send({ type: "init", sampleRate: state.sampleRate });
    if (lastLoadMessage) inThreadTransport.send(lastLoadMessage);
    inThreadTransport.send({ type: "setHardwareOptions", options: lastHardwareOptions });
    inThreadTransport.send({ type: wasPlaying ? "play" : "pause" });
    ensureAudio();
  }

  function setLatencyMode(mode) {
    const next = mode === "interactive" ? "interactive" : "playback";
    if (next === state.latencyHint) return Promise.resolve(next);
    state.latencyHint = next;

    restartQueue = restartQueue.then(async () => {
      if (!state.audioCtx) return;
      try {
        await restartAudio();
      } catch (error) {
        state.workletError = String(error?.message || error);
      }
    });
    return restartQueue.then(() => state.latencyHint);
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

  function prepareAudio() {
    ensureAudio();
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
    getAudioDiagnostics,
    selectTrack,
    prepareAudio,
    play,
    pause,
    togglePlay,
    pullAudioBlock,
    injectKey,
    setHardwareOptions,
    setLatencyMode,
    updateSource,
    getRamView,
    getRawSource: (gameId) => sources[gameId],
    getAssembled,
    getAssembledCache: () => assembledCache,
    prewarmAssemblies,
    getSession: () =>
      state.currentSession || buildSessionDescriptor(getActiveGame(), getActiveTrack()),
    getState: () => ({ ...state }),
  };
}
