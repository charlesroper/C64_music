// ============================================================================
// Galway 2664 // Ocean 6502-SID Workbench Application Bootstrap
// ============================================================================

import { createAudioDiagnosticsOverlay } from "./audio_diagnostics.js";
import { createBootSequence } from "./boot_sequence.js";
import {
  createAudioContextManager,
  createWorkbenchPlayer,
  resolveAudioMode,
} from "./player_engine.js";
import { createTapeLoadingSound } from "./tape_loading_sound.js";
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
  const latencyHint = resolveAudioMode({
    override: params.get("latency"),
    window: win,
  });
  const navigatorObj = typeof navigator !== "undefined" ? navigator : null;
  const audioManager = createAudioContextManager({
    window: win,
    navigator: navigatorObj,
    latencyHint,
  });
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
  const fetchFn = options.fetch || (typeof fetch !== "undefined" ? fetch : globalThis.fetch);
  const tapeSound =
    options.tapeSound ||
    createTapeLoadingSound({
      getContext: () =>
        player?.getAudioContext?.() || audioManager.getPreUnlockedContext?.() || null,
      fetchFn,
    });
  if (!skipBoot && !reducedMotion) tapeSound.preload?.();

  // Touch pointerdown does not grant user activation in mobile browsers, so keep
  // listening across pointerup, touchend and click until the context runs.
  const gestureEvents = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  const addGestureListeners = (fn) => {
    for (const type of gestureEvents) doc.addEventListener(type, fn, true);
  };
  const removeGestureListeners = (fn) => {
    for (const type of gestureEvents) doc.removeEventListener(type, fn, true);
  };
  const unlockOnce = () => {
    if (!player?.getAudioContext?.()) {
      audioManager.unlock();
      boot?.startTapeSound?.();
    }
    const ctx = player?.getAudioContext?.() || audioManager.getPreUnlockedContext?.();
    if (ctx?.state === "running") removeGestureListeners(unlockOnce);
  };
  addGestureListeners(unlockOnce);

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

  function waitForBootScopes(ready) {
    const tel = player?.getTelemetry?.();
    if (tel && tel.frameCount > 0) {
      view?.renderTelemetry(tel);
      ready();
      return;
    }
    const ctx = player?.getAudioContext?.();
    const playerState = player?.getState?.();
    if (
      ctx?.state !== "running" ||
      !ctx.audioWorklet ||
      playerState?.audioBackend === "in-thread"
    ) {
      ready();
      return;
    }
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (!doc.body.dataset.bootState) return;
      const current = player?.getTelemetry?.();
      if ((current && current.frameCount > 0) || Date.now() >= deadline) {
        if (current) view?.renderTelemetry(current);
        ready();
        return;
      }
      setTimeout(poll, 16);
    };
    setTimeout(poll, 16);
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
    waitBeforeFade: waitForBootScopes,
    onComplete(outcome) {
      bootActive = false;
      view?.setRenderingPaused(false);
      bootOutcome = outcome;
      applyBootOutcome();
    },
  });
  boot.start();

  const fileNames = [
    "wizball.asm",
    "arkanoid.asm",
    "arkadrum.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
  ];

  // Mount view early so UI handlers (including early first-tap unlock) are active
  view = createWorkbenchView({
    document: doc,
    elements: options.elements,
    player: null,
    latencyHint,
    onFirstInteraction: audioManager.unlock,
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
    window: win,
    rawSources,
    createAudioContext: audioManager.createAudioContext,
    navigatorObj,
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

  const prepareAudio = () => {
    player.prepareAudio();
    boot.startTapeSound();
    if (player.getAudioContext()?.state === "running") {
      removeGestureListeners(unlockOnce);
      removeGestureListeners(prepareAudio);
    }
  };
  addGestureListeners(prepareAudio);

  const led = view.elements.get("status-led");
  if (led) led.classList.add("ready");

  prewarm.finally(() => {
    prewarmDone = true;
    loadBootTargetPaused();
    if (boot.getState().gateActive) prepareAudio();
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
