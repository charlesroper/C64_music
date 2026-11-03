# Game Loader Adapters and Lazy Assembly

Replace monolithic loader branching with dedicated game loader adapters and assemble Ocean sources on demand.

## Context

`loadTrackIntoEmulator` handled all six games inside a 130-line conditional cascade. Each branch executed different JSR entry points, memory write sequences, and CPU initialization recipes. Adding or reviewing a game required parsing through repeated zero-page word writes and hardcoded cycle budgets. Additionally, player boot eagerly assembled all six sources before first frame paint, consuming over 380 ms of startup CPU time.

## Decision

Extract one named loader adapter per game (`loadWizball`, `loadArkanoid`, `loadArkadrum`, `loadGameover`, `loadGreenberet`, `loadRambload`) inside a `GAME_LOADERS` dispatch table. Share zero-page word writers (`writeWord`, `readWord`), JSR invocation helpers (`jsr`), and CPU driver starts (`setCpuState`) across adapters.

Assemble source files lazily upon first selection, caching assembled artifacts in `assembledCache`. Boot only pre-assembles the default game (`wizball.asm`), deferring dependent assemblies (such as `arkanoid.asm` for `arkadrum.asm`) until selected. Cache rendered source viewer HTML per file to avoid redundant regex formatting passes during game switching.

## Consequences

Each game's setup recipe is isolated in a testable function with clear parameter boundaries. Startup assembly time drops from 386.5 ms to 56.2 ms (an 85.5% reduction). Source viewer game switching retrieves pre-rendered rows without parsing regex syntax repeatedly.
