# Galway 2664: Commodore 64 Audio Workbench and Assembly Sources

[Live Web Player](https://charlesroper.github.io/C64_music/) | [The Story: History, Architecture and Assembly](NARRATIVE.md) | [Martin Galway's Original Repository](https://github.com/MartinGalway/C64_music)

Galway 2664 is a WebAssembly audio workbench and live in-browser cross-assembler for Martin Galway's original Commodore 64 game music from Ocean Software (1985 to 1987). Named "Galway 2664" because Galway released his original music on GitHub in 2026 and composed it for the Commodore 64 (echoing the four-digit chip numbers he made innovative use of, like the MOS 6502 processor and 6581 SID), the repository was forked by Charles Roper in October 2026 and built with Gemini (Argon and Flash) in Google's Antigravity. It compiles Galway's raw 6502 assembly source text directly in your browser and executes it clock by clock inside a custom WebAssembly emulation core. You can listen to all 73 catalogued tracks and sound effects, inspect hardware telemetry and oscilloscopes, trace Galway's program counter through the score in real time, and edit and reassemble the original code.

For the full story of Galway's technical innovations, the historical context, the architecture behind the emulation, and the chronological development blog, read [NARRATIVE.md](NARRATIVE.md) or click **THE STORY** in the web interface.

### Key capabilities

1. **Assembles Galway's raw source code on the fly.** A zero-dependency JavaScript cross-assembler parses Ocean Software's bespoke 1980s directives (`ORG`, `ENT`, `DFS`, `DFB`, `DFW`, `DFM`, `DFH`, `DFL`, `EQU`, `ADD`, `SUB`) directly in the browser in under 20 milliseconds.
2. **Runs a standalone WebAssembly 6510 and SID engine.** A freestanding C core compiled to WebAssembly executes the assembled code clock by clock, with 200Hz raster timer interrupts, Chamberlin filter modelling, and 15Hz AC coupling.
3. **Supports the complete catalogue.** Plays all six original assembly sources and all 73 tracks and sound effects without requiring disk images or emulator installations.
4. **Visualises developer telemetry.** Recreates Galway's original light grey `$0400` memory display with authentic 256-glyph C64 character ROM rendering and `$D020` border raster profiler alongside 4-channel hardware oscilloscopes.
5. **Enables live in-browser editing and hot-reloading.** Lets you follow Galway's program counter with adaptive smooth scrolling that tracks fast 16th notes without lag, adjust note values, instruments, or filter settings in the source viewer, assemble the changes, and hear them in running C64 memory in real time.

---

## Martin Galway's original release note

The following text is Martin Galway's original release note from April 2026, preserved verbatim for reference:

> Music source files from 1980's Commodore 64 games
>
> So that folks can read through, analyse & understand the music players and how I went about doing my work. Feel free to re-assemble, modify & generate new music. Please credit the original author of this work, Martin Galway. I am the current copyright owner in all this music & programming code, but was not the owner at the time it was created in the 1980's. I acquired the rights from Infogrames later. "Wizball" used the "1st Generation" player, whose design had been in use since 1984 thu about mid-1987. The 2nd Generation player was first used on "Athena" - written for that game, in fact - and later on games like Times Of Lore and Insects In Space
>
> -Martin Galway April 14th 2026

---

## Included source files

The repository includes six complete assembly sources and Galway's notes on Ocean's bespoke cross-assembler:

* `wizball.asm` (April 1987): Galway's 1st Generation sound driver featuring his 200Hz fractional raster clock, rapid 30ms arpeggios, and `$0400` telemetry monitor.
* `arkanoid.asm` (February 1987): Opening sequence and in-game sound effects.
* `arkadrum.asm` (February 1987): Real-time algorithmic drum synthesis output through the SID master volume register (`$D418`).
* `gameover.asm` (July 1987): Rock drum accompaniment streamed from 4-bit digitized PCM samples.
* `greenberet.asm` (April 1986): Arcade conversion title theme and loading jingles.
* `rambload.asm` (November 1985): The loader music featuring Galway's secret Morse code transmitter broadcasting the development team's names.
* `ocean_assembler_directives.txt`: Galway's notes explaining the syntax and directives used by Ocean's in-house 6502 cross-assembler (`ORG`, `ENT`, `DFS`, `DFB`, `DFW`, `DFM`, `DFH`, `DFL`, `EQU`, `ADD`, `SUB`).

---

## Running the player locally

Because modern web browsers prevent WebAssembly modules and source text from loading over `file://` URLs for security reasons, the player must be served over HTTP.

### 1. Prerequisites

You need either:
* **Node.js** (version 18 or later, which includes `npx`).
* **Python 3** (version 3.6 or later).

No package installation or build step is required to run the player.

### 2. Clone the repository

```bash
git clone https://github.com/charlesroper/C64_music.git
cd C64_music
```

### 3. Start a local web server

Start a static web server from the repository root using either Node.js or Python.

Using Node.js:
```bash
npx serve .
```

Or using Python:
```bash
python3 -m http.server 8080
```

### 4. Open the workbench

Open `http://localhost:8080` (or the address printed by your server) in any modern browser. Click **PLAY** to start audio output.

---

## Running the automated test suite

The test suite validates pitch accuracy, audio waveform stability, drum synthesis, mobile and laptop responsive layouts, C64 character ROM decoding, and narrative factual fidelity. It runs on Node.js using its built-in test runner (`node:test`) and requires zero external dependencies.

Run the test suite from the repository root:
```bash
npm test
```

`npm test` first runs `biome format --write .`, applying Biome's formatter across the repository, then executes the checks. Formatting drift is corrected on every test run, so the working tree stays consistently rendered without a separate command. Safe lint fixes remain the job of `npm run format` and the deploy gate.

The test runner executes 47 automated checks across five test files:
* `tests/repo_rules.test.mjs`: Enforces repository integrity rules: blocks CalVer downgrades from clock-skewed machines in version calculation (`scripts/bump_version.mjs`), verifies clean working tree and remote configuration preflight guards in deployment automation (`scripts/deploy.mjs`), guarantees zero literal em-dash characters (Unicode U+2014) across all tracked prose and code, confirms SHA-256 cryptographic authenticity of frozen historical Ocean assembly sources and directives, validates automated test count synchronization across documentation, and asserts four-file CalVer synchronization across `package.json`, `package-lock.json`, `index.html`, and `src/version.js`.
* `tests/player_audio_and_pitch.test.mjs`: Uses Hann-windowed Discrete Fourier Transforms (DFT) to confirm that synthesized tones match the MOS 6581 datasheet pitch formula across 44.1kHz, 48kHz, PAL and NTSC configurations. Verifies that all 73 catalogued tracks and sound effects produce valid alternating current (AC) output without clipping or DC lock. Tests `$D418` algorithmic and sampled drum synthesis, pause controls, channel mute masks, catalog metadata integrity, telemetry snapshot encapsulation with pre-allocated buffer reuse, removal of raw WebAssembly exports from the public player interface, named game loader adapter dispatch (`GAME_LOADERS`) with shared 16-bit word and JSR helpers, lazy on-demand source assembly, background worker compilation tracking, and structured track session descriptors with drum and Morse capability mapping across all 73 catalogued tracks.
* `tests/spa_boot_and_play.test.mjs`: Enforces strict element identifier lookups via a unified browser harness (`tests/helpers/browser_harness.mjs`), tests AudioContext gesture unlocks, verifies that audio starts cleanly even when playback is triggered before WebAssembly and assembly assets finish downloading, validates CalVer versioning, surfaces assembly errors in the status badge while preserving editor text, protects unsaved edits across track changes, isolates global keyboard shortcuts from modal dialogs and focused interactive buttons, verifies track-aware DRM chip activation and drum PC symbol resolution, hides sentinel -1 values from source viewer address gutters while displaying valid $0000 addresses, directs symbol jumps and text searches to the active on-screen file rather than the game identifier, confirms assembler hardening against missing operands, multi-pass convergence, and guarded loader track key and pointer reads, reuses cached source viewer HTML across game switches to prevent redundant formatting passes, verifies assembler-owned source index address resolution, O(1) symbol definition jumps, and substring line search, validates that the workbench view mounts behind a focused interface (`src/workbench_view.js`) with zero module import side effects while automated UI tests drive the view with mock player adapters and unified element registries, confirms that telemetry change guards eliminate redundant text writes and Morse re-renders on identical frames, validates that the idle render loop skips canvas monitor and oscilloscope repaints while paused or hidden, resuming drawing on visibility, verifies that game and track switches load with autoPlay and update session DOM immediately without transitional muting delays, and asserts that Panel 1 displays reactive assembly status badges updating to READY and tracks compilation progress in the header badge before flipping to ASSEMBLED OK.
* `tests/mobile_ui_layout.test.mjs`: Evaluates the CSS media-query cascade across desktop, laptop (1024x768, 1100x700), and mobile (375x812) viewports. Verifies vertical scrolling, touch target dimensions (>= 36px), single-column layout tab switches, authentic 256-glyph C64 character ROM decoding without arithmetic noise artifacts, startup toggle synchronization (HUD Row Guide, Follow Voice), interactive voice tracking chips (V1, V2, V3, DRM), responsive $D400-$D418 hardware register group stacking with active sound lights, jitter-free Section 4 telemetry rendering with tabular numbers, and adaptive requestAnimationFrame smooth scrolling for code tracking with leap pre-positioning and user touch cancellation.
* `tests/narrative.test.mjs`: Validates the custom markdown renderer, confirms that all quotations in [NARRATIVE.md](NARRATIVE.md) match Galway's sources verbatim, and checks cited line numbers and equates against the original assembly files.

---

## Calendar versioning (CalVer)

The project tracks deployments with Calendar Versioning (`YYYY.MM.DD` or `YYYY.MM.DD.MICRO`), displayed immediately following the app title in the header banner.

To bump the version before a release:
```bash
npm run bump
```

The script (`scripts/bump_version.mjs`) updates `package.json`, `package-lock.json`, `index.html` (header badge and document title), and `src/version.js`. If deployed multiple times on the same date, it increments the `.MICRO` segment (`.1`, `.2`, etc.); on a new date, it resets to `YYYY.MM.DD`.

---

## Linting and formatting

Code style is enforced by [Biome](https://biomejs.dev/), the project's only linter and formatter. It covers JavaScript, JSON, CSS and HTML, using Biome's experimental HTML support. Markdown, the historical assembly sources and the C sound core are not formatted by it.

Check the tree without changing it:
```bash
npm run lint
```

Apply formatting and safe fixes:
```bash
npm run format
```

Biome skips `node_modules`, `.agents`, `.codegraph` and `.projectmem`. The first formatting pass was committed on its own and recorded in `.git-blame-ignore-revs`, so `git blame` skips it.

---

## Deploying to GitHub Pages

The application deploys as a static site hosted on GitHub Pages at [https://charlesroper.github.io/C64_music/](https://charlesroper.github.io/C64_music/).

To run the automated deployment:
```bash
npm run deploy
```

The deploy script (`scripts/deploy.mjs`) executes preflight checks (verifying a clean git working tree and the existence of the `fork` remote), applies the Biome formatter (`npm run format`) and re-verifies that the tree stayed clean, runs the lint and format check (`npm run lint`), executes the automated test suite (`npm test`), pushes the release to `fork/main`, and reports the deployed commit hash.

---

## Rebuilding the WebAssembly sound core (optional)

The pre-compiled WebAssembly binary is located at `wasm/c64_engine.wasm` (about 25KB) and is committed to the repository. You only need to rebuild it if you modify the C emulator source code in `src/wasm/c64_engine.c`.

### Prerequisites

Rebuilding requires the LLVM toolchain:
* **Clang** with WebAssembly target support (`wasm32`).
* **LLD** linker (`wasm-ld`).

On Debian or Ubuntu, install the toolchain with:
```bash
sudo apt update && sudo apt install clang lld
```

On macOS using Homebrew:
```bash
brew install llvm
```

### Compilation

Compile `src/wasm/c64_engine.c` into a standalone, freestanding WebAssembly module:

```bash
clang --target=wasm32 -O3 -nostdlib -c src/wasm/c64_engine.c -o wasm/c64_engine.o
wasm-ld --no-entry --export-dynamic -O3 wasm/c64_engine.o -o wasm/c64_engine.wasm
rm wasm/c64_engine.o
```

*(Note: On Android environments such as Termux, pass the `-fintegrated-cc1` flag to `clang`.)*

---

## Architecture overview

The application is structured into five focused modules:

1. **In-browser cross-assembler (`src/ocean_assembler.js`)**: A JavaScript assembler that parses Galway's raw source text, handles Ocean's custom directives (`ORG`, `ENT`, `DFS`, `DFB`, `DFW`, `DFM`, `DFH`, `DFL`, `DSP`, `DFC`, `EQU`, `ADD`, `SUB`), performs two-pass symbol resolution, and generates a binary memory image along with line-to-address source maps in under 20 milliseconds.
2. **Cycle-accurate emulation core (`src/wasm/c64_engine.c`)**: A freestanding C core compiled to WebAssembly that emulates the MOS 6510 CPU, VIC-II raster timer (63 cycles per line on PAL, 65 on NTSC), and the MOS 6581/8580 SID synthesizer. It includes a 2x-oversampled Chamberlin state-variable filter, a 15Hz high-pass AC-coupling filter matching the C64 motherboard output capacitor, and a cubic soft saturation curve (`soft_saturate`) to prevent harsh clipping.
3. **Web Audio driver (`src/player_engine.js`)**: Coordinates audio sample rate negotiation (44.1kHz or 48kHz), synchronizes the WebAssembly clock divider, routes stereo audio through a ScriptProcessorNode with a silent looping buffer, and manages mobile WebKit autoplay unlocks.
4. **C64 Character ROM and logo (`src/c64_charset.js`)**: Decodes authentic 8x8 bitmap glyphs for all 256 C64 PETSCII character codes, including lowercase letters, uppercase graphics, and punctuation. Generates the white Galway 2664 brand logo with a retro reflection sparkle cycling valid VIC-II palette colors, and renders the `$0400` telemetry monitor directly to the CRT canvas.
5. **Studio workbench interface and track catalogue (`src/workbench_view.js`, `src/app.js`, `src/main.js`, `src/tracks_catalog.js`, `src/styles.css`, `index.html`)**: Mounts the presentation layer behind `createWorkbenchView` with a focused interface (`renderSession`, `renderTelemetry`, `renderSource`, `setPlaying`), a unified element registry, and zero module import side effects. Provides the CRT memory display (`$0400`), border profiler raster bars (`$D020`), 4-channel oscilloscopes, live code disassembly tracking voice program counters (`PC0` to `PC2`, `seqPC`) with adaptive smooth scrolling, complete metadata and registers for all 73 tracks, adaptive responsive breakpoints for mobile and laptop screens with refined brand header typography, and the in-app narrative modal overlay rendered by `src/markdown.js`.

---

## License and credits

* **Original music and 6502 assembly code**: Copyright (C) Martin Galway. Preserved and published under the GNU General Public License v3.0 (GPL-3.0).
* **Web emulator, assembler, and workbench interface**: GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
