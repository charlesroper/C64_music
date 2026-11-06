---
status: proposed
---

# Engine Core on the AudioWorklet Thread

Mobile browsers starve the main thread for 50 to 200 ms during scrolling and orientation changes, and the `ScriptProcessorNode` audio path stutters even with a 4096-sample buffer (#28). We move the Engine Core (WebAssembly emulator, Loader Adapters, audio rendering, Telemetry Snapshot fill) into an `AudioWorkletProcessor` and drive it from the main-thread Player Engine over a `MessagePort` (#29).

## Considered Options

- **`SharedArrayBuffer` ring buffers**: rejected. GitHub Pages cannot send the COOP/COEP headers that cross-origin isolation requires.
- **Keep a `ScriptProcessorNode` fallback in the browser**: rejected. Every target browser ships `AudioWorklet`, and a second audio path doubles the device testing. Node tests drive the Engine Core in-thread instead.
- **Run the assembler in the worklet**: rejected. The Workbench View needs the Source Index on the main thread, so the main thread assembles and posts only `{ mem, symbols }`.

## Decision

- The main thread compiles `c64_engine.wasm` once and passes the `WebAssembly.Module` in `processorOptions`.
- The Player Engine interface stays synchronous. Commands are fire-and-forget and the port preserves their order.
- A Track Load freezes the emulator clock. `process()` outputs silence and never touches the emulator until the Loader Adapter finishes, so the tune starts at frame 0 however long the load takes. Commands sent during a Track Load queue and apply in order afterwards. The paused pre-render (`wasm_render_audio(2048)`) is removed; the worklet sends one Telemetry Snapshot after each Track Load instead.
- The worklet pushes Telemetry Snapshots at about 60 Hz while playing, using a small pool of transferred buffers. Fast-forward keeps its current rate of 3 extra frames per 2048 output samples.

## Consequences

The Telemetry Snapshot (ADR-0001) keeps its shape but may lag the audio by one message. The worklet module loads during the first-interaction audio unlock, and a `play()` issued before it is ready is queued.
