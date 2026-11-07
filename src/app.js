// ============================================================================
// Galway 2664 // Ocean 6502-SID Workbench Application Bootstrap
// ============================================================================

import { createAudioDiagnosticsOverlay } from "./audio_diagnostics.js";
import { createWorkbenchPlayer } from "./player_engine.js";
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
  const latencyHint = params.get("latency") === "playback" ? "playback" : "interactive";
  let preUnlockedAudioCtx = null;

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
        } catch (_) {
          preUnlockedAudioCtx = new AudioCtx();
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
  const view = createWorkbenchView({
    document: doc,
    root: options.root,
    elements: options.elements,
    player: null,
    onFirstInteraction: handleFirstInteraction,
  });

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
    rawSources,
    createAudioContext: (opts) => {
      if (preUnlockedAudioCtx) {
        const ctx = preUnlockedAudioCtx;
        preUnlockedAudioCtx = null;
        return ctx;
      }
      const AudioCtx = win.AudioContext || win.webkitAudioContext;
      return opts ? new AudioCtx(opts) : new AudioCtx();
    },
    navigatorObj: typeof navigator !== "undefined" ? navigator : null,
  });

  view.setAssets({ directivesText, narrativeText });
  view.setPlayer(player);

  const diagnostics = createAudioDiagnosticsOverlay({
    document: doc,
    player,
    window: win,
  });

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

  const autoPlay = view.isPendingPlayOnBoot();
  view.selectGameAndTrack("wizball.asm", "wiz-title", autoPlay);

  return { player, view, diagnostics };
}

export {
  bootWorkbench as initWorkbench,
  cancelViewerSmoothScroll,
  createWorkbenchView,
  scrollToSourceLine,
  smoothScrollSourceViewer,
};
