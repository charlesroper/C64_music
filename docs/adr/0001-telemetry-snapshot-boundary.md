# Telemetry Snapshot Boundary

Encapsulate all WebAssembly ABI calls, SID register sampling, and screen memory decoration behind a reusable telemetry snapshot on the player engine interface.

## Context

The frame loop reached directly into WebAssembly exports and memory buffers 23 times per frame, bypassing the player engine and coupling the presentation layer to emulator internals.

## Decision

`player.getTelemetry()` returns a pre-allocated, reusable snapshot containing CPU, SID register, voice, filter, scope, and screen memory state. The player interface no longer exports the raw WebAssembly instance.

## Consequences

The view receives typed telemetry without C ABI knowledge, per-frame garbage collection is eliminated through buffer reuse, and emulator memory mutations stay confined to the engine module.
