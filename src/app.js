// ============================================================================
// Galway 2664 // Ocean 6502-SID Workbench Application Bootstrap
// ============================================================================

import { createAudioDiagnosticsOverlay } from "./audio_diagnostics.js";
import { createAudioLifecycle } from "./audio_lifecycle.js";
import { createBootHandoff } from "./boot_handoff.js";
import { createBootSequence } from "./boot_sequence.js";
import { createWorkbenchPlayer, resolveAudioMode } from "./player_engine.js";
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
  const audioLifecycle = createAudioLifecycle({
    document: doc,
    window: win,
    navigator: navigatorObj,
    latencyHint,
  });
  const reducedMotion =
    options.reducedMotion === true ||
    Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const skipBoot = options.skipBoot === true || params.get("skipBoot") === "1";
  const fetchFn = options.fetch || (typeof fetch !== "undefined" ? fetch : globalThis.fetch);
  const tapeSound =
    options.tapeSound ||
    createTapeLoadingSound({
      audioLifecycle,
      fetchFn,
    });
  if (!skipBoot && !reducedMotion) tapeSound.preload?.();

  const handoff = createBootHandoff({ audioLifecycle });
  const boot = createBootSequence({
    document: doc,
    target: { gameId: "wizball.asm", trackId: "wiz-title", title: "WIZBALL" },
    reducedMotion,
    skip: skipBoot,
    tapeSound,
    ...(options.schedule ? { schedule: options.schedule } : {}),
    ...(options.cancel ? { cancel: options.cancel } : {}),
    ...(options.setIntervalFn ? { setIntervalFn: options.setIntervalFn } : {}),
    ...(options.clearIntervalFn ? { clearIntervalFn: options.clearIntervalFn } : {}),
    onGate: handoff.handleGate,
    waitBeforeFade: handoff.waitBeforeFade,
    onComplete: handoff.handleComplete,
  });
  handoff.attachBoot(boot);
  boot.start();

  const fileNames = [
    "wizball.asm",
    "arkanoid.asm",
    "arkadrum.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
  ];

  // Mount view early so UI handlers are active before async asset fetching completes.
  const view = createWorkbenchView({
    document: doc,
    elements: options.elements,
    player: null,
    latencyHint,
  });
  handoff.attachView(view);

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

  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    wasmModule,
    workletUrl: new URL("./audio_worklet.js", import.meta.url).href,
    latencyHint,
    window: win,
    rawSources,
    audioLifecycle,
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

  const led = view.elements.get("status-led");
  if (led) led.classList.add("topBar-led-isReady");

  handoff.attachPlayer(player, prewarm);

  return { player, view, diagnostics, boot, audioLifecycle, handoff };
}

export {
  bootWorkbench as initWorkbench,
  cancelViewerSmoothScroll,
  createWorkbenchView,
  scrollToSourceLine,
  smoothScrollSourceViewer,
};
