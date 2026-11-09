// ============================================================================
// Galway 2664 // Ocean 6502-SID Workbench Application Bootstrap
// ============================================================================

import { createAudioDiagnosticsOverlay } from "./audio_diagnostics.js";
import { createBootSequence } from "./boot_sequence.js";
import { resolveLatencyHint } from "./latency_hint.js";
import { createWorkbenchPlayer } from "./player_engine.js";
import { createTapeLoadingSound } from "./tape_loading_sound.js";
import { resolveTelemetryEnabled, resolveTelemetryHz } from "./telemetry_rate.js";
import {
  cancelViewerSmoothScroll,
  createWorkbenchView,
  scrollToSourceLine,
  smoothScrollSourceViewer,
} from "./workbench_view.js";

export async function bootWorkbench(options = {}) {
  const doc = options.document || (typeof document !== "undefined" ? document : null);
  const win = options.window || (typeof window !== "undefined" ? window : globalThis);
  if (!doc) return null;

  const params = new URLSearchParams(win?.location?.search || "");
  const latencyHint = resolveLatencyHint(params.get("latency"));
  const telemetryParam = params.get("telemetry");
  const telemetryHz = resolveTelemetryHz(telemetryParam);
  const telemetryEnabled = resolveTelemetryEnabled(telemetryParam);
  const telemetryLockedOff = !telemetryEnabled;
  const renderMinimal = params.get("render") === "minimal";
  const reducedMotion =
    options.reducedMotion === true ||
    Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const skipBoot = options.skipBoot === true || params.get("skipBoot") === "1";
  let view = null;
  let player = null;
  let bootOutcome = null;
  let bootActive = true;
  let bootTarget = null;
  let bootTargetLoaded = false;
  let prewarmDone = false;
  let preUnlockedAudioCtx = null;
  let preUnlockedLatencyHint = null;
  const tapeSound = createTapeLoadingSound({
    getContext: () => player?.getAudioContext?.() || null,
  });

  function loadBootTargetPaused() {
    if (!bootTarget || !view || !player || !prewarmDone || bootTargetLoaded) return;
    bootTargetLoaded = true;
    view.selectGameAndTrack(bootTarget.gameId, bootTarget.trackId, false);
  }

  function applyBootOutcome() {
    if (!bootOutcome || !view || !player) return;
    const outcome = bootOutcome;
    bootOutcome = null;
    const autoPlay = outcome.autoPlay || view.isPendingPlayOnBoot();
    if (bootTargetLoaded) {
      if (autoPlay) view.setPlaying(true);
      return;
    }
    view.selectGameAndTrack(outcome.target.gameId, outcome.target.trackId, autoPlay);
    bootTargetLoaded = true;
  }

  const boot = createBootSequence({
    document: doc,
    target: { gameId: "wizball.asm", trackId: "wiz-title", title: "WIZBALL" },
    reducedMotion,
    skip: skipBoot,
    tapeSound,
    onGate({ target }) {
      bootTarget = target;
      loadBootTargetPaused();
    },
    onComplete(outcome) {
      bootActive = false;
      view?.setRenderingPaused(false);
      bootOutcome = outcome;
      applyBootOutcome();
    },
  });
  boot.start();

  const handleFirstInteraction = () => {
    if (typeof navigator !== "undefined" && navigator.audioSession) {
      try {
        navigator.audioSession.type = "playback";
      } catch (_) {}
    }
    if (!preUnlockedAudioCtx) {
      const AudioCtx = win.AudioContext || win.webkitAudioContext;
      if (AudioCtx) {
        try {
          preUnlockedAudioCtx = new AudioCtx({ sampleRate: 48000, latencyHint });
          preUnlockedLatencyHint = latencyHint;
        } catch (_) {
          preUnlockedAudioCtx = new AudioCtx();
          preUnlockedLatencyHint = null;
        }
        if (preUnlockedAudioCtx.state !== "running") {
          preUnlockedAudioCtx.resume();
        }
      }
    }
  };

  const fileNames = [
    "wizball.asm",
    "arkanoid.asm",
    "arkadrum.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
  ];

  const fetchFn = options.fetch || (typeof fetch !== "undefined" ? fetch : globalThis.fetch);

  // Mount view early so UI handlers (including early first-tap unlock) are active
  view = createWorkbenchView({
    document: doc,
    root: options.root,
    elements: options.elements,
    player: null,
    latencyHint,
    telemetryHz,
    renderMinimal,
    onFirstInteraction: handleFirstInteraction,
  });
  view.setRenderingPaused(bootActive);

  const [wasmResp, directivesResp, narrativeResp, ...asmResps] = await Promise.all([
    fetchFn("./wasm/c64_engine.wasm"),
    fetchFn("./ocean_assembler_directives.txt"),
    fetchFn("./NARRATIVE.md"),
    ...fileNames.map((f) => fetchFn(`./${f}`)),
  ]);

  const wasmBytes = await wasmResp.arrayBuffer();
  const wasmModule = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(wasmModule, {});

  const directivesText = await directivesResp.text();
  const narrativeText = await narrativeResp.text();

  const decoder = new TextDecoder("utf-8");
  const rawSources = {};
  for (let i = 0; i < fileNames.length; i++) {
    const buf = await asmResps[i].arrayBuffer();
    rawSources[fileNames[i]] = decoder.decode(buf);
  }

  player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    workletUrl: new URL("./audio_worklet.js", import.meta.url).href,
    latencyHint,
    telemetryHz,
    telemetryEnabled,
    telemetryLockedOff,
    rawSources,
    createAudioContext: (opts) => {
      if (preUnlockedAudioCtx && (!opts || opts.latencyHint === preUnlockedLatencyHint)) {
        const ctx = preUnlockedAudioCtx;
        preUnlockedAudioCtx = null;
        preUnlockedLatencyHint = null;
        return ctx;
      }
      if (preUnlockedAudioCtx) {
        const stale = preUnlockedAudioCtx;
        preUnlockedAudioCtx = null;
        preUnlockedLatencyHint = null;
        if (typeof stale.close === "function") {
          const closing = stale.close();
          if (closing && typeof closing.catch === "function") closing.catch(() => {});
        }
      }
      const AudioCtx = win.AudioContext || win.webkitAudioContext;
      return opts ? new AudioCtx(opts) : new AudioCtx();
    },
    navigatorObj: typeof navigator !== "undefined" ? navigator : null,
  });
  const prewarm = player.prewarmAssemblies();

  view.setAssets({ directivesText, narrativeText });
  view.setPlayer(player);

  const diagnostics = createAudioDiagnosticsOverlay({
    document: doc,
    player,
    window: win,
    getFrameDiagnostics: view.getFrameDiagnostics,
  });
  view.setDiagnostics(diagnostics);

  let audioPrepared = false;
  const prepareAudio = () => {
    if (audioPrepared) return;
    audioPrepared = true;
    player.prepareAudio();
    doc.removeEventListener("pointerdown", prepareAudio, true);
    doc.removeEventListener("keydown", prepareAudio, true);
  };
  doc.addEventListener("pointerdown", prepareAudio, true);
  doc.addEventListener("keydown", prepareAudio, true);

  const led = view.elements.get("status-led");
  if (led) led.classList.add("ready");

  prewarm.finally(() => {
    prewarmDone = true;
    loadBootTargetPaused();
    boot.setReady();
    applyBootOutcome();
  });

  return { player, view, diagnostics, boot };
}

export {
  bootWorkbench as initWorkbench,
  cancelViewerSmoothScroll,
  createWorkbenchView,
  scrollToSourceLine,
  smoothScrollSourceViewer,
};
