---
status: accepted
---

# Engine Core on the AudioWorklet Thread

Mobile browsers starve the main thread for 50 to 200 ms during scrolling and orientation changes, and the `ScriptProcessorNode` audio path stutters even with a 4096-sample buffer (#28). We move the Engine Core (WebAssembly emulator, Loader Adapters, audio rendering, Telemetry Snapshot fill) into an `AudioWorkletProcessor` and drive it from the main-thread Player Engine over a `MessagePort` (#29).

## Considered Options

- **`SharedArrayBuffer` ring buffers**: rejected. GitHub Pages cannot send the COOP/COEP headers that cross-origin isolation requires.
- **Keep a `ScriptProcessorNode` fallback as the primary path**: rejected. Every target browser ships `AudioWorklet`. The fallback survives only for the Node test harness and for browsers without AudioWorklet support. Node tests drive the Engine Core in-thread instead.
- **Run the assembler in the worklet**: rejected. The Workbench View needs the Source Index on the main thread, so the main thread assembles and posts only `{ mem, symbols }`.

## Decision

- The main thread compiles `c64_engine.wasm` once and passes the `WebAssembly.Module` in `processorOptions`.
- The Player Engine interface stays synchronous. Commands are fire-and-forget and the port preserves their order.
- A Track Load freezes the emulator clock. `process()` outputs silence and never touches the emulator until the Loader Adapter finishes, so the tune starts at frame 0 however long the load takes. Commands sent during a Track Load queue and apply in order afterwards. The paused pre-render (`wasm_render_audio(2048)`) is removed; the worklet sends one Telemetry Snapshot after each Track Load instead.
- The worklet pushes Telemetry Snapshots at about 60 Hz while playing. Each snapshot is packed into one `ArrayBuffer` from a three-buffer pool and transferred to the main thread, which returns used buffers for reuse. Fast-forward keeps its current rate of 3 extra frames per 2048 output samples.

## Consequences

The Telemetry Snapshot (ADR-0001) keeps its shape but may lag the audio by one message. The worklet module loads during the first-interaction audio unlock, and a `play()` issued before it is ready is queued.

## Verification

The earlier verification note is superseded by ADR-0008. That note claimed headless AudioWorklet loading was unavailable under PRoot ([Issue #34](https://github.com/charlesroper/C64_music/issues/34)). The conclusion was wrong. It came from the Chromium build under test, not from PRoot. WebKit 27.2 and Chromium 153 load worklet modules, run `process()` ticks, and keep the `AudioContext` running in this sandbox. Firefox 159 loads the module but its context stays suspended.

`npm test` drives the Engine Core in-thread and guards the message protocol, the frozen clock, and the command queue. Headless WebKit now verifies the worklet pipeline. A real mobile browser still provides the final check by ear: load a track, start playback, scroll and rotate the phone, and confirm the audio stays clean without dropouts. See `docs/agents/browser-verification.md`.
