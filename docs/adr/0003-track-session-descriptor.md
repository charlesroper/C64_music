# Track Session Descriptor

Return a structured session descriptor from the player engine and eliminate all game identifier branching in the presentation layer.

## Context

The presentation layer mapped game identifiers to source files through three separate ternaries, and derived drum sequencer capability from combinations of `pcSymbols` and game identifiers. `player.selectTrack()` returned only a bare `{ game, track }` tuple, forcing UI handlers and telemetry loops to maintain duplicate conditional logic for Arkanoid, Arkadrum, GameOver and Rambo.

## Decision

`player.selectTrack()` and `player.getSession()` return a complete `TrackSession` descriptor:
`{ game, track, sourceFile, drum: { available, symbol, sourceFile }, pcSymbols, morse: { available } }`.

The helper `getSessionSourceFile(session, voice)` resolves the active source file based on whether voice tracking follows SID channels or the drum sequencer. The presentation layer consumes this descriptor directly without branching on game identifiers.

## Consequences

UI components, telemetry loops, chip toggles and PC click handlers read a single source of truth for on-screen source code, drum sequencer tracking and Morse banners. Game-specific routing rules remain encapsulated within the player engine module.
