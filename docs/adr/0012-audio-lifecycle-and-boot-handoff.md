---
status: accepted
---

# Audio Lifecycle and Boot Handoff Seams

Separate session-wide Web Audio ownership (**Audio Lifecycle**) from startup coordination (**Boot Handoff**), replacing cross-module flags, duplicate gesture listeners, and DOM-attribute polling (#113).

## Context

Startup audio unlocking, **Tape Loading Sound** playback, and the transition from **Boot Sequence** into **Workbench View** previously spanned five modules (`src/app.js`, `src/boot_sequence.js`, `src/tape_loading_sound.js`, `src/player_engine.js`, and `src/workbench_view.js`) coordinated through six shared flags. Context ownership split between `createAudioContextManager` and **Player Engine**, capture-phase gesture listeners registered twice without cleanup, `src/app.js` poked `boot.startTapeSound()` on retries, and first-frame readiness polled `document.body.dataset.bootState` every 16 ms.

## Decision

- **Single-owner Audio Lifecycle (`src/audio_lifecycle.js`):** Own the active Web Audio context for the full session across initial gesture unlock, constructor option fallback, `navigator.audioSession.type = "playback"`, subscriber notifications, and context replacement on **Audio Mode** switches. Register one capture-phase gesture listener set (`pointerdown`, `pointerup`, `touchend`, `click`, `keydown`), detach it once the context reaches `"running"` or on `destroy()`, and re-attach it if a context falls out of `"running"` or reopens `"suspended"`.
- **Direct Audio Lifecycle consumers:** Wire **Player Engine** onto the **Audio Lifecycle** seam (default-wrapping injected context factories for isolated tests) and remove `createAudioContextManager`. Subscribe **Tape Loading Sound** directly to **Audio Lifecycle** readiness so `start()` arms across delayed mobile unlocks (`pointerdown` to `pointerup` or `click`) and `stop()` disarms immediately without calling back into **Boot Sequence**.
- **Boot Handoff (`src/boot_handoff.js`):** Isolate the startup async join between **Boot Sequence** gate and completion events, background assembly prewarm, **Player Engine** audio preparation, first-frame **Telemetry Snapshot** readiness, and initial **Load Target** playback. Leave `src/app.js` as composition only and drop `onFirstInteraction` from **Workbench View** (amending ADR-0005).
- **Cancellable `waitBeforeFade`:** Update **Boot Sequence**'s `waitBeforeFade(ready)` seam to invoke any returned `cancel()` function during `destroy()` or early teardown, removing `dataset.bootState` polling.

## Considered Options

- **Merge audio ownership and boot coordination into one module:** Rejected. **Audio Lifecycle** lives for the full browser session (including skipped-boot loads and **Audio Mode** switches), whereas **Boot Handoff** ends once startup completes.
- **Keep `createAudioContextManager` as a deprecated wrapper and poll `dataset.bootState`:** Rejected. Retaining two context owners keeps stale context references across **Audio Mode** switches, and DOM-attribute polling leaks timers across teardown.
- **Keep `onFirstInteraction` in Workbench View alongside Audio Lifecycle:** Rejected. Registering gesture unlock handlers in multiple modules duplicates listeners and obscures ownership.

## Consequences

- **Audio Lifecycle** and **Boot Handoff** run deterministically in-process without WebAssembly compilation across startup ordering permutations, mobile touch unlocks, context replacement, and teardown cancellation.
- **Boot Sequence** holds no knowledge of browser audio retry mechanics (`startTapeSound()` is removed) and cancels first-frame waits directly through the returned `cancel()` handle.
- **Workbench View** drops `onFirstInteraction`, relying on **Audio Lifecycle** for gesture-driven audio unlock across all loads, including `skipBoot` and `reducedMotion`.
