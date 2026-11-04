# Background Worker Assembly and Immediate Track Playback

Offload 6502 assembly compilation to a background Web Worker, display assembly status badges in Panel 1, use native CSS content visibility, and restore immediate sample-zero playback on track switches.

## Context

Testing on mobile devices revealed audio stutter and ring buffer repetitions when switching games, particularly to Game Over (Issue #30). Initial attempts to silence the transition introduced a `GainNode` with scheduled unmute ramps and delayed playback across `requestAnimationFrame` passes.

Because Web Audio keeps calling `onaudioprocess` on its own clock, the 6502 CPU continued stepping through emulation cycles while audio gain remained held at 0.0. When gain finally unmuted, newly switched tunes started several beats into the song, missing the opening bars.

Profiling revealed that the root cause was not a digital audio artifact, but a 300ms to 500ms main-thread freeze:
1. `gameover.asm` (2,141 lines) was assembled synchronously on the UI thread during track selection.
2. Building and inserting 2,141 source rows into the DOM triggered a full flexbox layout pass.
3. Because `ScriptProcessorNode` runs on the browser UI thread, this pause starved hardware audio buffers, prompting mobile audio drivers to repeat their ring buffers.

## Decision

1. **Roll Back Transitional Muting and Scheduling Delays**:
   Remove `pendingFadeIn`, `playbackTime` alignment delays, and multi-frame animation deferrals. When a track or game is selected during active playback, `player.selectTrack()` resets emulator state and begins audible rendering immediately from sample 0 of beat 1.

2. **Background Assembly in a Web Worker**:
   Compile Martin Galway's 6502 assembly source files in a dedicated Web Worker at startup. Because `sourceIndex` closures cannot be cloned by `structuredClone`, the worker transfers raw byte arrays (`mem.buffer`), entry points, and symbol maps. The player engine re-attaches `sourceIndex` helper methods on receipt. When `Worker` is unavailable (such as in Node.js test suites), fall back gracefully to on-demand synchronous compilation.

3. **Assembly Status Badges in Panel 1**:
   Add a fixed-width `.asm-status-badge` to each game card in Panel 1. The badge displays `ASM...` while compilation is in progress and flips to `READY` once the assembled module is cached. If a user clicks a game before background compilation completes, the player assembles it immediately on demand.

4. **Native CSS Content Visibility**:
   Avoid JavaScript DOM virtualization, which would cause DOM thrashing and layout measurement errors during fast note leaps and long jumps. Instead, apply CSS `content-visibility: auto; contain-intrinsic-size: 18px;` to `.asm-line`. This instructs the browser rendering engine to skip layout and paint for off-screen lines without modifying DOM structure or breaking `offsetTop` calculations.

## Consequences

- Switching games or tracks begins playback immediately on beat 1 without swallowed notes or delay.
- Main-thread compilation freezes are eliminated because assembly runs on an isolated CPU thread.
- Long line jumps and fast 16th-note tracking in the source viewer remain completely jank-free.
- Unit and integration tests continue to run in Node.js without requiring Worker mocks.
