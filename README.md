# Galway 2664: Commodore 64 audio workbench and assembly sources

[Live web player](https://charlesroper.github.io/C64_music/) | [The story: history, architecture and assembly](NARRATIVE.md) | [Martin Galway's original repository](https://github.com/MartinGalway/C64_music)

Galway 2664 is a browser-based Commodore 64 audio workbench and 6502 cross-assembler for Martin Galway's Ocean Software game music (1985-87).

It compiles Galway's original assembly source code in the browser and runs it clock by clock inside a WebAssembly 6510 and SID emulator. Play all 73 tracks and sound effects without a desktop emulator. Edit and reassemble the code while it plays.

The workbench recreates Galway's live debugging screen. In his original sound drivers, Galway wrote internal music engine diagnostics directly into Commodore 64 text screen RAM at `$0400`. The CRT canvas monitor decodes this 1,000-character telemetry block with authentic C64 character ROM glyphs.

Galway published his original source files on GitHub in April and May 2026. The repository was forked in October 2026 and built using Gemini 4 Argon and 3.8 Flash in Google Antigravity CLI and DeepSeek v4.1 Flash in OpenCode.

Read [NARRATIVE.md](NARRATIVE.md) or click **THE STORY** in the player for the historical context, hardware architecture and build log.

## Martin Galway's release note (14 April 2026)

> Music source files from 1980's Commodore 64 games
>
> So that folks can read through, analyse & understand the music players and how I went about doing my work. Feel free to re-assemble, modify & generate new music. Please credit the original author of this work, Martin Galway. I am the current copyright owner in all this music & programming code, but was not the owner at the time it was created in the 1980's. I acquired the rights from Infogrames later. "Wizball" used the "1st Generation" player, whose design had been in use since 1984 thu about mid-1987. The 2nd Generation player was first used on "Athena" - written for that game, in fact - and later on games like Times Of Lore and Insects In Space
>
> -Martin Galway April 14th 2026

## Original assembly sources

* `wizball.asm` (composed 10 February to 23 April 1987): The peak implementation of Galway's first-generation sound driver (an architecture he evolved at Ocean from 1984 to mid-1987), featuring a 200Hz fractional raster clock, fast arpeggios and a live `$0400` telemetry monitor.
* `arkanoid.asm` (composed 23 January to 6 February 1987): Arcade conversion soundtrack (composed with Taito) containing the opening jingle and in-game sound effects. The arcade original had no in-game background music.
* `arkadrum.asm` (completed 5 February 1987): Real-time algorithmic drum synthesis through the SID master volume register (`$D418`). Written as a companion overlay to run alongside `arkanoid.asm` in memory.
* `gameover.asm` (composed 10 February to 9 July 1987): Title theme, Game Over tune and sound effects, featuring rock drum accompaniment streamed from embedded 4-bit digitised PCM samples via a 50Hz raster interrupt.
* `greenberet.asm` (completed 5 April 1986): Arcade conversion soundtrack (composed with Konami) containing the title march, siren cues, high-score and completion themes, a five-part victory suite and eight sound effects. It contains game audio only and no loader music.
* `rambload.asm` (completed 12 November 1985): Ocean loader music for Rambo (First Blood Part II), featuring Galway's secret Morse code transmitter. It contains cassette and disk loading music only, not the in-game soundtrack.
* `ocean_assembler_directives.txt`: Galway's 2026 notes on the syntax and directives of Ocean Software's in-house 6502 cross-assembler (`ORG`, `ENT`, `DFS`, `DFB`, `DFW`, `DFM`, `DFH`, `DFL`, `DSP`, `DFC`, `EQU`, `ADD`, `SUB`).

## How the workbench works

* **Boot Sequence** (`src/boot_sequence.js`, `src/tape_loading_sound.js`): Every full page load opens on a full-screen C64 CRT, with a power-on flash, the exact BASIC screen, typed `LOAD""`, a PRESS PLAY ON TAPE gate and a `GALWAY 2664` tape loader for Wizball. The gate unlocks browser audio, tape loading sound plays during the loader, and the CRT shrinks into the workbench monitor as Wizball title music starts. The boot-pending state is in the static HTML, so the boot screen is visible from first paint and Firefox never flashes the workbench. Normal completion starts audio, then crossfades the boot overlay into the workbench over 2.4 seconds. `?skipBoot=1` and reduced motion use a static immediate mode that reveals the workbench from first paint and starts paused.
* **Cross-assembler and source index** (`src/ocean_assembler.js`, `src/source_index.js`): Parses Galway's source text and Ocean's directives in the browser with no external dependencies. It resolves symbols in three passes, outputs a 64KB memory image with line-to-address maps and indexes symbols and lines for search and navigation.
* **WebAssembly 6510 and SID core** (`src/wasm/c64_engine.c`): Emulates the MOS 6510 CPU, the VIC-II raster timer (63 cycles per line on PAL, 65 on NTSC) and the MOS 6581/8580 SID synthesiser in freestanding C. It runs Galway's 200Hz polled raster loop alongside a 50Hz VIC-II interrupt harness for the drum drivers in `arkadrum.asm` and `gameover.asm`. The audio path uses a 2x-oversampled Chamberlin state-variable filter, a 15Hz high-pass filter modelled on the C64 motherboard output capacitor and a cubic soft saturation curve (`soft_saturate`).
* **Engine Core** (`src/engine_core.js`): Wraps the WebAssembly instance, the six game loader adapters (`GAME_LOADERS`), audio rendering and telemetry collection behind an ordered message interface (`init`, `loadTrack`, `play`, `pause`, `setHardwareOptions`, `injectKey`, `requestTelemetry`). The same core runs inside the browser `AudioWorkletProcessor` (`src/audio_worklet.js`) and in-thread for Node.js tests.
* **Player Engine and telemetry pool** (`src/player_engine.js`, `src/audio_worklet.js`, `src/telemetry_buffer.js`, `src/assembly_worker.js`): Keeps the assembler and source index on the main thread, sends compiled bytecode to the worklet over a `MessagePort` and recycles a pool of six transferable `ArrayBuffer` snapshots so telemetry crosses threads without allocation pauses. It prewarms all six assemblies, plus the Arkanoid payload, in a module Web Worker during the Boot Sequence.
* **C64 character ROM** (`src/c64_charset.js`): Decodes 8x8 bitmap glyphs for all 256 C64 character ROM codes and renders Galway's `$0400` screen memory onto the CRT canvas. Most sources display light grey text; `greenberet.asm` mixes medium grey, light grey and white, and `rambload.asm` uses a custom colour HUD.
* **Workbench UI and catalogue** (`src/workbench_view.js`, `src/app.js`, `src/main.js`, `src/tracks_catalog.js`, `src/markdown.js`): Mounts the UI behind `createWorkbenchView`, including the `$D020` border raster profiler, four-channel oscilloscopes, a full-width SID register strip with V1, V2, V3 and Filter + Drums groups in balanced rows of four, two or one and register cells that stretch between 18px and 34px, live assembly tracking that follows each voice's program counter (`PC0` to `PC2`, `seqPC`), in-browser code editing with live hot-reload, metadata for all 73 tracks and the story modal.

## Run the player locally

Browsers block WebAssembly modules and `.asm` source fetches over `file://` URLs. Serve the repository over HTTP using Node.js 18+ or Python 3.6+. No package installation or build step is required to run the player.

1. Clone the repository and enter the directory:

   ```bash
   git clone https://github.com/charlesroper/C64_music.git
   cd C64_music
   ```

2. Start a static HTTP server from the repository root with Node.js:

   ```bash
   npx serve .
   ```

   Or start one with Python:

   ```bash
   python3 -m http.server 8080
   ```

3. Open `http://localhost:8080` (or the port printed by your server) in your browser and click **PLAY**.

The first load runs the C64 Boot Sequence and ends with Wizball playing. Add `?skipBoot=1` to bypass the boot and land on the workbench with Wizball loaded paused.

### Stats for Nerds

* Click **STATS FOR NERDS** in the header to show or hide the live audio and main-thread frame timing overlay.
* Append `?audioDebug=1` to the URL to open the same overlay on load.
* Click **?** in the overlay title row to expand a scrollable plain-English guide. Every metric gains a description under its value. The expanded guide has a flush, frosted title bar and a circular help button. Click **×** to return to the compact overlay.
* The overlay groups Context, Latency, Process, Deadlines, Telemetry and Events. Each group has its own colour and left border. Text titles remain, so colour is not the only cue.
* Values are health-coded: green is normal, amber is under pressure and red is bad. A dot repeats the state. The expanded guide carries the legend. Group titles keep their category colours.
* Health uses the 2.67ms callback budget, frame work limits, deadline counts, drop counts and output latency. Cumulative totals and unlisted values stay neutral because they mix old and current events.
* Each metric is one label and value unit. Whole units wrap on narrow screens, so a value never drops below its label.
* A **window** is 375 `process()` calls, about one second. Window values reset.
* A **peak** is the worst value since page load. Peaks survive window resets and audio-context restarts.
* **Late** means a callback finished over the 2.67ms budget. **Missed** means the browser skipped a whole 128-frame block.
* **Drops** means a telemetry snapshot was dropped because no telemetry buffer was free. Audio is unaffected.
* The Process group reports window max and session peak for audio render, telemetry pack, message post, gain application and main-thread frame work.
* The Deadlines group reports late blocks and missed quanta as cumulative totals, current-window counts and session peaks.
* The Telemetry group reports cumulative, windowed and peak telemetry drops.
* When telemetry snapshots are stopped, the Context group shows `OFF` for the telemetry rate.

### Telemetry rate

* Telemetry runs at `62.5Hz` by default.
* Append `?telemetry=30` to the URL to select the lighter `30Hz` rate.
* Append `?telemetry=off` to stop snapshots for isolation captures. Audio diagnostics continue. Stats shows `OFF`, and opening Stats cannot re-enable snapshots while the override is active.
* The on-screen Telemetry switch is hidden while `62.5Hz` is the default.
* The six-buffer telemetry pool absorbs the higher update rate.
* The earlier `30Hz` default was reversed after it did not improve Firefox audio deadlines. See `NARRATIVE.md`.

### Audio mode

* Toggle **AUDIO MODE** between `PLAYBACK` and `INTERACTIVE`.
* `PLAYBACK` is the stable default. `INTERACTIVE` asks the browser for a lower-latency `AudioContext`.
* Changing mode closes and recreates the audio context and reloads the current track, so audio stops briefly.
* Append `?latency=interactive` to start in interactive mode.

### Low power mode

* Toggle **LOW POWER** near **AUDIO MODE**. It is off by default and is never enabled automatically.
* Caps workbench rendering at 30fps and updates the C64 monitor and scopes at that rate.
* Stops smooth source auto-scroll while playing. The followed line highlight remains.
* Disables logo sparkle and CRT scanlines.
* Uses 30Hz telemetry while on and restores the base rate when off.
* Leaves the Engine Core, SID emulation and audio worklet path unchanged.

## Edit and reassemble music live

You can modify any track's assembly code in the browser and hear the changes immediately in running Commodore 64 memory.

### Quick example: customise the Wizball title theme

To test a live code modification, use the default startup track (`wizball.asm`, **Title Screen (1987)**):

1. Click **EDIT .ASM** above the source viewer (or in the **LIVE .ASM** tab on mobile) to switch from the read-only source view to an editable text area.
2. Make a sample edit in `wizball.asm`:

   * **Opening pitch (line 3520):** Find label `TITLE0` and change `DFL 58,32` on line 3525 to `DFL 70,32` (an octave up) or `DFL 34,32` (deep sub-bass):

     ```asm
     TITLE0         DFL FLoad,VRC
                    DFW TD00
                    DFL Master
                    DFL Filter
                    DFW TC00
                    DFL 70,32 ; was 58,32
     ```

   * **Pitch bend and vibrato (line 3448):** Find label `TD00` and exaggerate the bend offsets (or set them to `+0,+0,+0,+0` to flatten the bend completely):

     ```asm
     TD00           DFW +600,-600,+600,+600 ; was +25,-25,+25,+10
     ```

3. Click **RE-ASSEMBLE**.

The in-browser cross-assembler parses the Ocean directives, resolves symbols in three passes and sends the updated 64KB memory image to the running sound core. The status badge confirms `HOT-RELOADED OK` and the active track restarts with your changes. If your edits contain syntax errors, the badge displays the error message and preserves your unsaved text.

## Run the test suite

The test suite uses the built-in Node.js test runner (`node:test`) with zero external dependencies:

```bash
npm test
```

The test runner executes 94 automated checks across 12 test files:

* `tests/engine_core.test.mjs`: Tests the Engine Core message protocol. It loads assembled bytecode (`mem` and `symbols`), passes the extra `arkanoid.asm` payload for `arkadrum.asm` tracks, renders stereo blocks and checks playback controls, hardware options, key injection, telemetry and sample-rate updates. It also checks that track loads freeze the clock at frame 0 without pre-rendering audio, apply queued commands in order after loading and scale fast-forward to three extra frames per 2048 samples across 128-frame and 2048-frame blocks. It verifies that disabled telemetry skips snapshot construction and posting.
* `tests/c64_screen.test.mjs`: Checks the shared PETSCII screen rasteriser used by the workbench CRT monitor and the Boot Sequence. It verifies border colours, glyph rows, colour RAM, screen placement and ImageData reuse.
* `tests/assembly_prewarm.test.mjs`: Checks the module worker assembler prewarm. It verifies all six sources are assembled, source indexes are rehydrated, the cache is filled and the synchronous fallback works when no worker is available.
* `tests/boot_sequence.test.mjs`: Checks the static boot-pending state, visible boot overlay at first paint, Boot Sequence phases, PRESS PLAY gate, readiness wait, normal crossfade, collapsed frame position during the fade, skip path, reduced-motion path and completion handoff.
* `tests/audio_worklet.test.mjs`: Runs `AudioWorkletProcessor` with a compiled `WebAssembly.Module` across 128-frame stereo quanta. It checks command queueing before readiness, silence before instantiation, telemetry throttling, the 62.5Hz default and 30Hz opt-in telemetry divider, telemetry enable and disable, forced track-load telemetry, transferable buffer recycling, late-block and process timing diagnostics, persistent window peaks, audio sub-phase timings, telemetry-drop windows, queued playback startup, the default `playback` latency hint and the soft audio-context restart when the latency mode changes.
* `tests/telemetry_buffer.test.mjs`: Checks that telemetry snapshots pack screen RAM, oscilloscope samples, SID registers, scanline border colours, voice states and filter values into one transferable `ArrayBuffer` and unpack cleanly without stale data on reuse.
* `tests/issue_close_guard.test.mjs`: Checks that `npm run issue:close` blocks issue closure when any definition-of-done or acceptance-criteria checkbox is unchecked or missing.
* `tests/repo_rules.test.mjs`: Checks CalVer monotonicity in `scripts/bump_version.mjs`, clean-tree and remote preflight guards in `scripts/deploy.mjs`, zero literal em-dashes (U+2014), SHA-256 checksums for all seven historical files, test-count synchronisation between `README.md` and `NARRATIVE.md`, harness-agnostic search rules in `AGENTS.md` and version synchronisation across all seven release locations.
* `tests/player_audio_and_pitch.test.mjs`: Uses Hann-windowed Discrete Fourier Transforms (DFT) to check that MOS 6581 oscillator pitches match the hardware datasheet formula at 44.1kHz PAL, 48kHz PAL and 48kHz NTSC. It sweeps all 73 tracks and sound effects for alternating-current (AC) oscillation without clipping or DC lock. It also tests `$D418` drum synthesis in `arkadrum.asm`, pause and mute controls, catalogue metadata, game loader adapters (`GAME_LOADERS`), on-demand assembly and track session descriptors.
* `tests/spa_boot_and_play.test.mjs`: Boots the single-page application in a shared browser harness (`tests/helpers/browser_harness.mjs`). It tests the Boot Sequence handoff, SID and audio mode switches, the retired PAL/NTSC control, low power mode, telemetry enable and disable, the `?telemetry=off` hard override, the Stats for Nerds overlay button, the grouped Stats layout, Stats health colours and legend, Stats `OFF`, Stats help mode, label/value pairing, main-thread frame timing peaks, workbench render pause and resume, `AudioContext` gesture unlock, playback queued during asset downloads, live assembly error handling, unsaved edit protection on track switch, keyboard shortcut isolation when modals are open, drum program-counter tracking, `$0000` gutter rendering, symbol jump and source search, cached source HTML reuse and idle render-loop suspension when paused or hidden.
* `tests/mobile_ui_layout.test.mjs`: Tests CSS breakpoints across desktop, laptop (1024x768, 1100x700) and mobile (375x812) viewports. It checks vertical scrolling, minimum touch targets (36px on transport buttons, hardware switches and modal buttons, 34px on key buttons), mobile tab switching, 256-glyph C64 character ROM decoding, startup toggle state, voice follow chips, responsive `#sid-group-*` register stacking, `tabular-nums` telemetry widths and smooth source scrolling.
* `tests/narrative.test.mjs`: Tests `src/markdown.js`, checks that every quotation in [NARRATIVE.md](NARRATIVE.md) matches Galway's source files verbatim and verifies cited line numbers and equates against the assembly sources.

### Verify AudioWorklet in a headless browser

WebKit 27.2 and Chromium 153 load `AudioWorklet` modules, run `process()` callbacks and keep `AudioContext` running inside the PRoot Linux sandbox. Chromium 156 and later exit at startup with `SIGTRAP` under PRoot. Firefox 159 loads worklet modules for UI checks, but its `AudioContext` stays suspended without a hardware audio device. See [docs/agents/browser-verification.md](docs/agents/browser-verification.md) for the browser paths and verification scripts.

## Lint and format the code

[Biome](https://biomejs.dev/) lints and formats JavaScript, JSON, CSS and HTML. It ignores Markdown, the historical `.asm` files, the C sound core and machine-local directories (`node_modules`, `.agents`, `.codegraph`, `.projectmem`).

Check the working tree without modifying files:

```bash
npm run lint
```

Format files and apply safe fixes:

```bash
npm run format
```

## Bump the version and deploy to GitHub Pages

Releases use calendar versioning (`YYYY.MM.DD` or `YYYY.MM.DD.MICRO`) and deploy to GitHub Pages at [https://charlesroper.github.io/C64_music/](https://charlesroper.github.io/C64_music/).

1. Update the version across `package.json`, `package-lock.json`, `src/version.js` and the four version references in `index.html`:

   ```bash
   npm run bump
   ```

   Running `npm run bump` again on the same UTC date increments the `.MICRO` suffix (`.1`, `.2`).

2. Run the test suite and commit the release:

   ```bash
   npm test
   git commit -am "Release vYYYY.MM.DD"
   ```

3. Push the release to `fork/main`:

   ```bash
   npm run deploy
   ```

   `scripts/deploy.mjs` checks that the working tree is clean and the `fork` remote exists, runs `npm run lint` and `npm test`, pushes `HEAD` to `fork/main` and prints the deployed commit SHA.

## Rebuild the WebAssembly sound core

`wasm/c64_engine.wasm` (about 25KB) is pre-compiled and committed to the repository. Rebuild it only when you edit `src/wasm/c64_engine.c`.

1. Install Clang with `wasm32` target support and the `wasm-ld` linker.

   On Debian or Ubuntu:

   ```bash
   sudo apt update && sudo apt install clang lld
   ```

   On macOS with Homebrew:

   ```bash
   brew install llvm
   ```

2. Compile `src/wasm/c64_engine.c` into `wasm/c64_engine.wasm`:

   ```bash
   clang --target=wasm32 -O3 -nostdlib -c src/wasm/c64_engine.c -o wasm/c64_engine.o
   wasm-ld --no-entry --export-dynamic -O3 wasm/c64_engine.o -o wasm/c64_engine.wasm
   rm wasm/c64_engine.o
   ```

   On Android or Termux, pass `-fintegrated-cc1` to `clang`.

## Licence and credits

* Original music and 6502 assembly code: Copyright (C) Martin Galway, published under the GNU General Public License v3.0 (GPL-3.0).
* WebAssembly emulator, cross-assembler and workbench interface: GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE).
