# Galway 2664: history, architecture and source code

[This repository](https://github.com/charlesroper/C64_music) | [Martin Galway's original source](https://github.com/MartinGalway/C64_music) | [Live player](https://charlesroper.github.io/C64_music/)

---

## 1. What this project is

Galway 2664 is a web workbench for Martin Galway's Commodore 64 game music. The name nods to Martin Galway releasing his source code on GitHub in 2026 and writing the music for the Commodore 64, echoing four-digit chip numbers like the MOS 6502 processor and 6581 SID. It is built from the source code he wrote for Ocean Software in 1985 to 1987.

The player does not play recordings. Galway wrote his music as a program for the Commodore 64's processor. This player turns that program into machine code in your browser, then runs it on a software copy of the computer's processor and sound chip. What you hear is the browser itself mimicking a 1980s machine's physical silicon chips, computing the sound live from Galway's raw code and playing it through your computer's audio hardware.

The initial source files were uploaded by Galway in April and May 2026. In October 2026, Charles Roper forked the repository to build this player, working with Gemini (Argon and Flash) in Google's Antigravity. The files include the music and sound effects for Wizball, Arkanoid, Rambo: First Blood Part II, Green Beret and Game Over, plus Galway's notes on the assembler Ocean used.

The first sections need no technical background. The later ones go into the code.

---

## 2. Why Galway's code is worth reading

The Commodore 64 had a sound chip called the SID, with three voices and a filter. It had no way to play recorded sound. Music was written by setting the chip's registers (control values) directly, at the right moments, from a program that also had to share the processor with the game.

Galway's sources show him working around those limits:

* **Faster timing.** One update per television frame gives 50 updates a second on a PAL machine. His Wizball program updates four times per frame, which allows much quicker note changes.
* **Drums from a volume knob.** The chip could not play samples. He changed its master volume thousands of times a second to produce drum sounds.
* **A hidden message.** The Rambo loading music secretly taps out the development team's names in Morse code.
* **A built-in performance meter.** He changed the screen border colour while the music program ran, so the thickness of the coloured band showed how much processor time it used.
* **A compact score format.** Each voice reads a stream of notes and commands, with loops and reusable phrases, rather than a long list of notes.

---

## 3. What you see in the player

* **Header, logo and version.** The banner shows the white Galway 2664 logo, drawn with glyphs from the Commodore 64 PETSCII character ROM, which sparkles through VIC-II colours. It also shows the WebAssembly engine status light and the CalVer release pill.
* **Tune list and transport controls.** Choose a tune, pause, restart or fast-forward.
* **Oscilloscopes.** Live traces for the three voices and the master volume channel.
* **Monitor.** A copy of the text display that Galway's program draws into screen memory, rendered with authentic C64 character glyphs and a border that shows processor load.
* **Source viewer.** Galway's assembly source, with markers that follow each voice through the score. Scrolling keeps pace with fast 16th notes and eases large leaps. Chips (V1, V2, V3 or DRM) select which voice to follow, and the Follow Voice toggle turns following on. In hybrid pieces such as Arkanoid Digi-Drums, DRM tracks the drum sequencer in `arkadrum.asm`, and the voice chips switch to `arkanoid.asm`. A SID register strip ($D400-$D418) at the bottom shows live hex values in four colour-coded voice and filter groups that light up when voices sound. You can also edit the source and rerun it.
* **Hardware options.** Switch between chip models, video standards and drum levels:
  * **SID chip.** Select the 1982 MOS 6581 or the 1987 MOS 8580. The 6581 has an analogue filter with non-linear resistance and mild saturation, plus quirks on combined waveforms. The 8580 uses a cleaner switched-capacitor filter. If a tune does not use the filter or combined waveforms, both chips sound identical. Where a filter is active, the difference is a subtle change in warmth and resonance.
  * **Clock and VIC.** Toggle between European PAL (50Hz, 985.2 kHz, 312 lines) and North American NTSC (60Hz, 1.023 MHz, 263 lines). Although NTSC runs at a higher clock frequency, switching to NTSC slows many tunes down. Galway composed for PAL machines and hardcoded PAL raster line counts into his music drivers. In Wizball, the 200Hz routine waits for raster lines 32, 110, 188 and 266. NTSC displays only have 263 scanlines (lines 0 to 262), so line 266 never arrives. The wait loop must roll over an entire extra frame to escape, stalling the sequencer and dragging the tempo down.
  * **$D418 digi slider.** Adjust the volume boost (0.0x to 3.0x) for Galway's 4-bit digital-to-analogue percussion on register `$D418`. Tracks using pure three-voice SID synthesis (such as Wizball, Green Beret and Rambo) set the master volume once and never modulate `$D418`, so the slider has no effect. It alters drum levels only on pieces with dedicated percussion routines: the hybrid Arkanoid Digi-Drums (`arkadrum.asm`) and Game Over (`gameover.asm`). Setting the slider to 0.0x silences the drums, while 3.0x boosts them over the musical chords.

A short glossary for the sections below:

* **6502 / 6510.** The processor family in the Commodore 64.
* **Assembly language.** Human-readable text that maps almost one-to-one to processor instructions.
* **Register.** A memory address that controls hardware. `$D418` is the SID's master volume register. The `$` means the number is hexadecimal.
* **Raster.** The beam that draws the television picture line by line. The VIC-II is the video chip that tracks it.
* **PAL and NTSC.** The European and North American television standards. PAL runs at 50 frames a second and NTSC at about 60.

---

## 4. Galway's techniques in detail

### Four updates per frame (200Hz)

In `wizball.asm`, the routine `DREFRESH` (lines 608 to 624) waits for the video chip's raster line counter to reach a set line, runs the music update, then waits for the next line. It does this four times per frame, at lines 32, 110, 188 and 266. That is 200 updates a second on a PAL machine.

```assembly
DREFRESH       LDA #32
               JSR WAITCLOCK00
               JSR REFRESH
               JSR RefScreen1
REF2           LDA #110
               JSR WAITCLOCK00
               JSR REFRESH
               JSR RefScreen2
```

The listing shows the first two of the four steps. The waiting happens in `WAITCLOCK00` and `WAITCLOCK80`, which compare `$D012` with the target line. Line 266 is reached by waiting for line 10 with the high bit of `$D011` set. Whitespace in all listings is condensed.

Tempo is set by a 16-bit speed value, `Refsp`. On every tick, `WAITCLOCKb` adds it to a running total, `CREFSP`. The music routine runs only when the high byte of the total changes:

```assembly
WAITCLOCKb     LDA Refsp
               ADC CREFSP
               STA CREFSP
               LDA CREFSP+1
               PHA
               ADC Refsp+1
               STA CREFSP+1
               PLA
               CMP CREFSP+1
               RTS
```

A value of `$0100` runs the music on every tick, `$0080` on every second tick and `$0040` on every fourth. The starting values differ by file:

* `wizball.asm` sets `refsp EQU $100` (line 3773).
* `arkanoid.asm` sets `refsp EQU $080`, commented "Opening Sequence (100Hz P.A.L.)".
* `gameover.asm` sets `refsp EQU $0040`.

The Arkanoid and Game Over files use different raster lines in `DREFRESH` from Wizball. The 200Hz scheme described here is Wizball's. In the Arkanoid and Game Over key handlers, the asterisk key sets `Refsp` to 1, which slows the music to a crawl for inspection.

### Drums from the volume register

The SID's master volume is the low four bits of `$D418`, giving 16 levels. Writing new values to it at audio rates turns the volume control into a crude 4-bit digital-to-analogue converter. Galway used it two ways:

* **Calculated drums in `arkadrum.asm`.** Drum routines such as `HIHAT` (line 138 onward) compute each value with arithmetic, adding a constant to a running total and masking it to four bits (`AND #15`), then write the result to `$D418`. The routine `PLEY` starts whichever drum the score has requested.
* **Stored samples in `gameover.asm`.** The tables `ROCKBASS` and `ROCKSNARE` hold recorded sounds, two 4-bit values per byte. The playback loop shifts out the high four bits and writes them, then writes the low four bits after a few padding `NOP` instructions that keep the timing even.

### The Morse code in the Rambo loader

`rambload.asm` contains three `Code` commands (lines 885, 888 and 891) that jump to machine-code routines in the middle of the score. One of them, `STARTMC` (line 1232), points the music driver at a different routine, `MCREFR`:

```assembly
STARTMC        LDA #$A0:STA $D406
               LDX #$4B:STX $D400
               LDY #$22:STY $D401
               LDX #MCREFR
               LDY ^MCREFR
               STX MUS+1
               STY MUS+2
```

The excerpt stops before the lines that clear voice 1's other registers. Voice 1's frequency is set to `$224B`, about 516Hz on a PAL machine. `MCREFR` reads the table at `Secret` one letter at a time, looks up each letter's dots and dashes in `CodeTab`, and switches voice 1's gate on (control value 33) and off (32) for each. The table spells:

BILL BARNA, DAVID COLLIER, MARTIN GALWAY, TONY POMFRET, STEVE WAHID

When the table ends, the routine restores the normal music driver.

### The border as a profiler

In 1987, developers had no performance profilers or debugging overlays. To measure how many clock cycles his music routines used, Galway turned the Commodore 64's video border into an oscilloscope.

The VIC-II video chip drew the television picture line by line from top to bottom (312 scanlines per frame on a European PAL display). At the start of the music interrupt, `REFRESH` in `wizball.asm` increments the border colour register, `BDR` (`$D020`), turning the border white. At the end of the update, it decrements the register back to black:

```assembly
REFRESH        PHP
               INC ClkAdd
               PLP
               BEQ xit
               INC BDR
               JSR FILTER
               ; ... (Voice routines MUSIC0..2 and SOUND0..2)
xit            DEC BDR
               RTS
```

While the processor was busy computing music tables and updating SID registers, the television electron beam kept sweeping downwards. Turning the border white at the start and black at the exit painted a horizontal stripe across the screen border. The vertical thickness (height in scanlines) showed Galway exactly how much processor time the music consumed per frame. If the white bar grew too tall, the music was stealing too many cycles from game graphics and sprite routines.

The WebAssembly emulator (`src/wasm/c64_engine.c`) reproduces this by recording the active border colour for each of the 312 scanlines into a buffer whenever code writes to `$D020`. The web canvas then draws the border scanline by scanline, so Galway's debug raster bars flicker and resize in real time exactly as they did on his workbench monitor in 1987.

In the same file, `DREFCOLOUR EQU 15` in `wizball.asm` (line 418) temporarily turns the border light grey while copying debug telemetry (voice pointers, clocks and filter values) into screen memory at `$0400`. The Arkanoid and Game Over files set `DREFCOLOUR` to 0.

### A bytecode score

Each voice has a 16-bit pointer (`PC0`, `PC1`, `PC2`) into its own score. Values from `$C0` (`COM`) upward are commands, dispatched through the jump tables `vt0`, `vt1` and `vt2`. Lower values are notes, with `$5F` (`Rest`) as a rest. The commands, defined as offsets from `COM` in `wizball.asm`, include:

* `Call` and `Ret` for reusable phrases.
* `For` and `Next` for loops.
* `Filter` for the SID filter.
* `Code` for a jump to arbitrary machine code, as the Morse routine uses.
* Others, such as `FLoad`, `Freq`, `Transp` and `Master`, which this page does not describe.

---

## 4.1. Community analysis: toolchains and modern re-assembly

When Galway released the source files in April 2026, a [Hacker News discussion](https://news.ycombinator.com/item?id=47900398) examined the history, toolchains and preservation hurdles behind the code:

* **Cross-development on host machines.** Ocean developers rarely assembled code on the Commodore 64 itself. They worked on dedicated host machines, primarily the Tatung Einstein or early MS-DOS PCs, running proprietary cross-assemblers and piping binaries over a cable to test on the C64. This stopped code loss whenever an experimental routine crashed the machine.
* **Proprietary assembler directives.** Galway's source used in-house Ocean assembler syntax, including directives such as `ORG`, `DSP`, `DFS`, `ADD` (which combined `CLC` and `ADC`), `SUB` (combining `SEC` and `SBC`) and caret notation (`^`) for high bytes.
* **Modern re-assembly hurdles.** Developers attempting to assemble Galway's original files found that modern open-source 6502 toolchains (such as `acme`, `xa65` or `ca65`) rejected Ocean's custom directives. Compiling Galway's raw source required syntax translation or a dedicated assembler written for Ocean's 1980s dialect.
* **Early browser experiments.** Within hours of the release, readers used large language models to transcribe Galway's custom bytecode tables and build experimental JavaScript and Web Audio players.
* **Legal provenance.** Commenters praised Galway for securing a clean rights recovery from Infogrames and publishing the work under GPL-3.0, avoiding the corporate archive limbo typical of vintage commercial games.

---

## 5. How the player works

### Assembler (`src/ocean_assembler.js`)

A JavaScript assembler reads Galway's `.asm` files. It implements the directives in `ocean_assembler_directives.txt`: `ORG`, `ENT`, `DFS`, `DFB`, `DFW`, `DFL`, `DFH`, `DFM`, `ADD`, `SUB` and `EQU`. It resolves labels in two passes and produces a memory image plus a map from addresses to source lines, which the source viewer uses.

### Emulator (`src/wasm/c64_engine.c`)

The emulator is written in C and compiled to WebAssembly, a compact binary format that browsers run at near-native speed. The file is about 25KB. It contains:

* A 6510 processor that counts cycles for each instruction.
* A VIC-II raster counter, at 63 cycles per line (PAL) or 65 (NTSC), so the raster waits above behave as they did on the machine.
* A SID with three oscillators, envelope generators, a noise source, the `$D418` volume channel and a filter.

The filter is a 2x-oversampled Chamberlin state-variable design. The output stage has a high-pass at about 15Hz, modelled on the capacitor that blocks direct current on a real machine's audio output, and a soft saturation curve (`soft_saturate`) in place of hard clipping.

### Engine core (`src/engine_core.js`)

The Engine Core owns the WebAssembly emulator, the loader adapters, audio rendering and the telemetry snapshot. The main thread sends it ordered messages to initialize the sample rate, load a track from assembled bytecode, play, pause, change hardware options, inject a key or request telemetry. The core renders stereo blocks into caller-supplied buffers and emits a telemetry snapshot after each track load and audio frame. A Track Load freezes the emulator clock and emits silence until the loader finishes, so the tune starts at frame 0. Commands that arrive during the load wait in a queue and apply in order afterwards. The same interface runs in-thread for tests and inside the AudioWorklet for live audio.

### Browser audio (`src/player_engine.js`)

The player keeps the assembler and Source Index on the main thread. It sends only assembled bytecode and symbols to the Engine Core through an in-thread transport adapter. It picks up the audio hardware's sample rate (44.1kHz or 48kHz) and tells the core without resetting loaded C64 RAM. On phones, it unlocks audio inside the first tap, because browsers block sound otherwise. It also keeps the Web Audio processing node fed with a silent looping buffer, which some WebKit browsers need to keep running. Hardware telemetry, SID registers, voice states and screen RAM return in a reusable telemetry snapshot, so the rendering loop never touches emulator internals directly.

### Interface

The workbench layout adapts to the screen size:

* **Desktop.** Three columns show the tunes and controls on the left, the live C64 monitor and oscilloscopes in the centre, and the assembly source viewer on the right.
* **Laptop and tablet.** On medium-width screens (821px to 1200px) or shorter viewports, the monitor and tune controls sit side by side and the assembly source spans the full width below.
* **Mobile.** On narrow screens, a single column has tabs for the monitor, tunes and source, with the Galway 2664 logo and version in the header.
* **Adaptive code viewer.** Assembly tracking uses requestAnimationFrame interpolation tailored to step distance: 90ms ease-out curves track rapid 16th notes, while large jumps across hundreds of lines pre-position near the target and ease the final 40 pixels over 70ms. Touch or mouse scrolling instantly cancels active transitions.
* **Character display and logo.** Screen memory at `$0400` and the Galway 2664 header logo render with authentic 8x8 glyphs for all 256 PETSCII characters (`src/c64_charset.js`), supporting both uppercase and lowercase text. The white logo sparkles through Commodore 64 palette colours on click or every 10 seconds.

---

## 6. In Galway's words

These are exact quotations from the source files.

From `ocean_assembler_directives.txt`, on `DFM`:

> "This is where you would put text into your program like 'Hello Mum' or 'I Love Gary Bracey.' Or something more useful & relevant to your program lol."

On `ADD`:

> "Packages a CLC with an ADC to save you some typing"

On `DFS` with a fill value, he describes `$DD` as:

> "a common random/magic number I used which would not crop up as a result of code running... so I could assume it was untouched RAM"

From `wizball.asm`, the comment beside the memory budget (line 3768):

> "I've currently got 7.5K to play with"

And the comment that closes the file (line 3775):

> "This is the end of the source file... (or is it?)"

The header of `gameover.asm` reads:

> "Design, code, music & arrangements by Martin Galway"

---

## 7. How it was made and tested

Martin Galway uploaded his original assembly files to GitHub in early 2026. In October 2026, Charles Roper forked the repository to build this player. It was built by vibe coding with Gemini (Argon and Flash) in Google's Antigravity, with Roper listening, testing on a phone and directing changes. The assembler, emulator and interface were written that way. Errors are likely, and corrections are welcome.

`npm test` runs 52 automated checks across 7 test files:

* **Engine core message protocol.** `createEngineCore({ wasm, postMessage })` loads raw assembled bytecode, accepts an extra arkanoid payload for arkadrum drum tracks, renders audio blocks into caller buffers, and handles init, play, pause, hardware options, key injection and telemetry requests. Tests assert telemetry is emitted on track load and repeated audio frames, that sample-rate negotiation leaves loaded C64 RAM intact, that a Track Load freezes the clock at frame 0 and emits silence without a pre-render, and that commands received during a load apply in exact order afterwards.
* **Issue closure guard.** `npm run issue:close` audits the issue body and refuses to close while any DoD or acceptance criteria task item is unchecked. A GitHub Action reopens any completed issue closed with unchecked items.
* **Repository rules and integrity guards.** Automated suite checks enforce zero em-dash characters (Unicode U+2014) across all tracked files, cryptographic SHA-256 integrity of frozen historical assembly sources and directives, documentation test count synchronization across both README.md and NARRATIVE.md, and four-file CalVer alignment.
* **Deployment and bump preflights.** Version bump calculations (`scripts/bump_version.mjs`) refuse to downgrade versions on clock-skewed machines, and deployment automation (`scripts/deploy.mjs`) aborts if working trees are dirty or the fork remote is absent, distinguishing push failure from success.
* **Idle render throttling.** The presentation loop takes an early return idle path when paused or when `document.hidden` is true, eliminating all C64 monitor canvas draws, oscilloscope strokes, and telemetry DOM writes, throttling refresh rates to 60 Hz, and restoring immediately on visibility.
* **Telemetry change guards.** All telemetry text elements, SID register hex cells, active voice classes, and Morse stream spans compare against previous values before writing to the DOM, eliminating redundant mutations on consecutive identical frames.
* **Workbench view interface.** The presentation layer sits behind `createWorkbenchView` in `src/workbench_view.js` with a small surface (`renderSession`, `renderTelemetry`, `renderSource`, `setPlaying`), element lookup behind a registry, and zero side effects on module import, while UI test suites drive the view using fake player adapters.
* **Assembler source index.** Assembled source artifacts provide a bound `sourceIndex` exposing `lineForAddress(addr)`, `lineForSymbol(name)` and `findLines(query)`, replacing regular expression scans and backwards address loops in the view with direct index queries.
* **Track session descriptors.** Calling `player.selectTrack()` yields a structured `TrackSession` descriptor defining the active game, tune, primary source file, drum sequencer availability and Morse banner states, removing all game identifier branching from the presentation layer.
* **Game loader adapters.** A dispatch table of named loader adapters (`GAME_LOADERS`) encapsulates hardware initialization, zero-page word writes, custom raster setup and entry-point jumps across all six games, verified by asserting CPU states and cycle budgets.
* **Lazy assembly and cached HTML.** Sources assemble on demand per game rather than all six eagerly on boot, reducing initial assembly time by 85.5% (from 386.5 ms to 56.2 ms), while rendered source viewer HTML is cached per file and reused across switches.
* **Telemetry snapshot encapsulation.** Engine state (cycles, PC, SID registers, voices, filter, scope buffers and screen RAM) returns as a reusable, pre-allocated snapshot from `player.getTelemetry()`, eliminating per-frame allocations and hiding the WebAssembly C ABI from the presentation layer.
* **Shared browser test harness.** A unified test harness (`tests/helpers/browser_harness.mjs`) parses authentic markup, throws on missing element identifiers to prevent silent fake drift, and manages strict WebKit audio and animation frames across UI test suites.
* **Pitch.** Fourier analysis confirms that generated tones match the datasheet pitch formula at 44.1kHz and 48kHz, in PAL and NTSC.
* **Catalogue.** All 73 tunes and sound effects across the six source files render audio without invalid values, clipping or a stuck output level.
* **Metadata.** All 73 tracks carry non-empty descriptions, valid duration hints, authentic keys and unique identifiers.
* **Drums.** The `$D418` drum routines produce sound, and the volume control for them works.
* **Mobile and audio unlock.** The page loads, unlocks audio on the first tap even during asset download, and starts playback cleanly.
* **AudioWorklet verification gate.** Headless WebKit under PRoot verifies the worklet pipeline. Chromium 153 also works, Chromium 156 and later crash at startup, and Firefox loads modules but keeps its audio context suspended. `npm test` verifies the Engine Core in-thread, and a manual listen in a real mobile browser provides the final audio check.
* **Versioning and deployment.** The CalVer release identifier renders beside the title in both the header and document head, validated against same-day increments (`scripts/bump_version.mjs`), with automated deployments pushed directly to GitHub Pages (`scripts/deploy.mjs`).
* **Code style.** Biome checks JavaScript, JSON, CSS and HTML before every deployment. The first formatting pass sits in its own commit, recorded in `.git-blame-ignore-revs`, so history stays readable.
* **Responsive layouts.** The interface scrolls vertically and sizes elements correctly across mobile (375x812) and laptop (1024x768, 1100x700) viewports.
* **Character ROM and logo.** All 256 character codes produce authentic 8x8 glyphs with readable letters and punctuation, and the white Galway 2664 brand logo sparkles through valid VIC-II colours.
* **Telemetry and controls.** Section 4 telemetry values render with tabular numbers to prevent jitter, control checkboxes synchronise on boot with Follow Voice off by default, interactive chips select the voice to follow, and the bottom SID register strip groups voices responsively with active sound lights.
* **Smooth code tracking.** The assembly viewer uses adaptive requestAnimationFrame timing to follow fast 16th notes without lag, pre-positions large leaps near their targets and yields immediately on user gestures.
* **Source editor safety.** Reassembly surfaces syntax errors in the status badge and preserves text, and unsaved edits survive track changes.
* **Modal keyboard isolation.** Keyboard shortcuts ignore modal dialogs and preserve native button activation.
* **Track-aware drum following.** Drum sequencer tracking enables only on songs with percussion, reads through the seqPC symbol, and preserves user follow state across track switches.
* **Source gutter address fidelity.** Address gutters hide empty statement sentinels while preserving authentic $0000 locations.
* **Source search and symbol alignment.** Symbol jumps and text searches scan whichever source file currently renders in the viewer.
* **Assembler hardening and loader safety.** The assembler rejects missing non-implied operands, enforces multi-pass convergence across all six sources while failing on unstable edits, and guards unkeyed tracks and zero-page pointers.
* **Factual fidelity.** All quotations and technical references match Galway's original source files and equates verbatim.

These checks show that the player behaves consistently. They do not prove it is identical to a real Commodore 64.

---

## 8. Development blog

### 14 April 2026: Galway publishes the music sources

The release note is dated 14 April 2026 and is preserved in [README.md](https://github.com/charlesroper/C64_music/blob/main/README.md). Galway explains why the files are public: "So that folks can read through, analyse & understand the music players and how I went about doing my work." He also sets the terms. He retains copyright, having acquired the rights from Infogrames, and asks for credit.

The note matters for anyone editing this repository. It sets the licence position and explains why the sources are treated as historical documents rather than working files. It also explains the two generations of player. Wizball uses the first, whose design had been in use since 1984 until about mid-1987. The second began with Athena and continued into Times of Lore and Insects in Space.

Two days passed between the note and the first upload.

[Evidence](https://github.com/charlesroper/C64_music/commit/312c429)

### 16 April to 12 May 2026: six sources arrive through the browser

Galway uploaded the files over four weeks, mostly through GitHub's web interface, which is why the commit messages read "Add files via upload". Wizball arrived first on 16 April ([2a7a561](https://github.com/charlesroper/C64_music/commit/2a7a561)), followed by the assembler notes on 18 April ([a19961a](https://github.com/charlesroper/C64_music/commit/a19961a)), Game Over on 21 April ([11b9332](https://github.com/charlesroper/C64_music/commit/11b9332)), Arkanoid and the drum routine on 4 May ([fe93226](https://github.com/charlesroper/C64_music/commit/fe93226)), the Rambo loader the same day ([77dc334](https://github.com/charlesroper/C64_music/commit/77dc334)), and Green Beret on 12 May ([a458a36](https://github.com/charlesroper/C64_music/commit/a458a36)).

The assembler notes were edited four times over the same period, which suggests Galway was answering questions as readers found them. The files carry the dates of composition in their contents, from the Rambo loader in November 1985 to Game Over in July 1987. These initial uploads established Galway's historical archive, which then sat untouched for five months.

### 29 October 2026: Roper forks the repo and builds the player with Argon and Flash

In October 2026, Charles Roper forked the repository. The new application was built from the fork by Roper, Argon and Flash, vibe coding in Google's Antigravity.

The first build landed on 29 October as a single commit of 5,347 lines: a 370-line page, a 1,300-line application, a 470-line assembler, an 854-line catalogue, a 1,109-line stylesheet and a 1,111-line C core compiled to a 24,961-byte WebAssembly module ([d70dc1a](https://github.com/charlesroper/C64_music/commit/d70dc1a)). It looked finished, but pressing play produced nothing.

The cause was a missing export. `ensureAudioContext()` called `wasm_set_sample_rate()`, which had not been exported from the C core. The call threw a `TypeError` after the audio context was assigned but before the processing node was connected, so every later click failed as well. The fix exported the function, added a 15Hz AC coupling filter to remove the DC offset from narrow pulses, and moved the audio work into `src/player_engine.js` ([cde6239](https://github.com/charlesroper/C64_music/commit/cde6239)).

That commit also started the test suite, with three files covering mobile layout, pitch and boot. The lesson held for the rest of the build: silence points to a wiring fault, so the wiring needs a test that clicks play.

### 29 October 2026: the typo that made two narratives

The story overlay needed a document, so `e2fdd30` created one. It created two: `NARRATIVE.md` and a misspelled duplicate, each 272 lines, differing by a single letter in the filename ([e2fdd30](https://github.com/charlesroper/C64_music/commit/e2fdd30)). The next two commits edited both files in parallel, so every fix was written twice.

The recovery came in `12ff883`, which deleted the misspelled file, rewrote the narrative and moved the markdown renderer into `src/markdown.js` with its own tests ([12ff883](https://github.com/charlesroper/C64_music/commit/12ff883)). The rewrite also removed claims the sources did not support, including an invented Filth Raid tempo, decimal mode arithmetic and an imagined capacitor filter. The commit body says it plainly: the new text quotes Galway verbatim and drops what the engine could not back up.

Deleting the duplicate was cheaper than maintaining it. The narrative now has one home, and `tests/narrative.test.mjs` checks that every quotation appears in the sources.

### 30 October 2026: the catalogue was partly invented

The tune list had been written from plausibility rather than from the files. `2131438` corrected it against the assembly sources and found real errors: Wizball's jump vectors were corrected to the keys the source uses, B through K, a track called BonusBass was missing, and Filth Raid was catalogued as a five-minute song when it is a five-second alarm jingle. Duration hints were fabricated, so they were replaced with verified times or an explicit "Loops" marker ([2131438](https://github.com/charlesroper/C64_music/commit/2131438)).

The correction touched 345 lines of `src/tracks_catalog.js` and added metadata tests. Those tests now assert a unique identifier, a valid duration hint and an authentic key for every entry, and they check the catalogue for em-dashes. The tune list feeds the browser, the duration hints and the key labels, so an invented value was visible to every visitor. It is the clearest example in the repository of generated content passing review because nothing checked it against the primary source.

### 30 October 2026: CalVer and a rulebook

Eighteen commits landed on 30 October, most of them small fixes shipped one after another. Two of them changed how the project works. The page showed no release number and the package sat at `1.0.0`, so there was no way to tell which build a listener was using. `59da218` put a calendar version in the header and the document title ([59da218](https://github.com/charlesroper/C64_music/commit/59da218)), and `bcb7ace` added a script that bumps `package.json`, `index.html` and `src/version.js` together ([bcb7ace](https://github.com/charlesroper/C64_music/commit/bcb7ace)). The script adds a fourth segment when several releases land on one day, which is how so many commits in a single day each got a distinct number.

The same day produced [AGENTS.md](https://github.com/charlesroper/C64_music/blob/main/AGENTS.md), which states the rules that had been learned the hard way: the historical sources are immutable, documentation changes with the code, test counts must match, and no em-dashes. `84ff480` strengthened the documentation sync rule after a feature shipped with stale docs ([84ff480](https://github.com/charlesroper/C64_music/commit/84ff480)). A test now checks that the badge sits immediately after the app title, so the rule holds without a human looking.

### 30 October 2026: three names in one day

The workbench was first called Galway26, then Galway 64, then Galway 2664. Each rename touched about a dozen files: the page title, the header, the package name, the version script, the character ROM, the tests and both documents ([7a3ca0d](https://github.com/charlesroper/C64_music/commit/7a3ca0d), [3a7f8e1](https://github.com/charlesroper/C64_music/commit/3a7f8e1), [daf82a4](https://github.com/charlesroper/C64_music/commit/daf82a4)). The cost comes from the name being encoded in a test as well as in the page, so a rename means editing assertions about the header before the build passes again.

The final name comes from the two facts in the README: Galway released the music in 2026 and wrote it for the Commodore 64, so the number echoes the four-digit chip designators in the machine, the MOS 6502 and the 6581 SID. The two earlier names each captured half of that. The same commit fixed voice following for the hybrid Arkanoid Digi-Drums, where the DRM chip now loads `arkadrum.asm` while the voice chips stay on `arkanoid.asm`.

### 31 October 2026: smooth scrolling broke, then came back

`51dab0a` rewrote the rendering loop and the line highlighting to cut per-frame work ([51dab0a](https://github.com/charlesroper/C64_music/commit/51dab0a)). It also moved the source viewer onto `scrollTo({ behavior: "smooth" })`. The change looked like a speed improvement and broke tracking on WebKit, where smooth scrolling inside an overflow container fails without an error.

`889c372` replaced it with requestAnimationFrame interpolation ([889c372](https://github.com/charlesroper/C64_music/commit/889c372)). The commit body explains the two faults: browser transitions restarted whenever a 100 to 200-millisecond note step interrupted a 400-millisecond animation, and sampling bounding rectangles mid-animation caused jitter. The replacement computes targets from `offsetTop`, eases short steps over 90 milliseconds and jumps most of a long distance before easing the final 40 pixels. It added 97 lines of tests, including cancellation on user touch.

The regression lasted one day. No test had watched the viewer during fast passages, so the new test does.

### 2 November 2026: Biome tooling and the clean-slate baseline

The codebase lacked a single linter and formatter, leaving indentation and style inconsistent across JavaScript, CSS, HTML and JSON. Commit `8938d16` introduced [Biome](https://biomejs.dev/) as the sole tooling gate ([8938d16](https://github.com/charlesroper/C64_music/commit/8938d16)). A repository-wide formatting pass formatted 33 files in `0937522`, fixing syntax warnings and establishing zero-diagnostic clean code ([0937522](https://github.com/charlesroper/C64_music/commit/0937522)).

To protect git history, commit `b3fdd6d` recorded the formatting revision in `.git-blame-ignore-revs` ([b3fdd6d](https://github.com/charlesroper/C64_music/commit/b3fdd6d)). Running `git blame` skips the mechanical formatting commit entirely, keeping original line attributions intact. This established Wave 0 of the review programme and resolved issue #17.

### 2 November 2026: the layered review programme

Fifteen open issues sat in the tracker, five earlier fixes had landed without review trails, and every architectural discussion risked re-inventing vocabulary ([Issue #16](https://github.com/charlesroper/C64_music/issues/16)). Mixing defect fixes, structural redesigns and performance work into single passes had produced churn where refactoring baked bugs into new shapes.

Wave A ran a read-only audit across the repository ([c42208a](https://github.com/charlesroper/C64_music/commit/c42208a)). It validated the fifteen open issues against the code and sorted them into three sequential waves: defects first, so refactoring never hardens broken behaviour; structure second, so seams are never designed around dead code; and performance third, so optimization measures the final architecture rather than temporary shapes.

### 2 November 2026: clearing the defect backlog

Wave B resolved five long-standing functional defects test-first across six commits. Syntax errors in the source editor were surfaced in the status badge while protecting dirty edit buffers from being wiped during track switches ([dfd6781](https://github.com/charlesroper/C64_music/commit/dfd6781)). Global shortcuts (Space, 1-4, letter keys) were isolated from open modal dialogs and native button clicks ([a0c3748](https://github.com/charlesroper/C64_music/commit/a0c3748)).

The DRM chip follow mode was made track-aware so it only activated on songs with percussion, resolving through the `seqPC` symbol and preserving user follow choices across switches ([96f822f](https://github.com/charlesroper/C64_music/commit/96f822f)). Address gutters stopped displaying sentinel -1 values while keeping valid $0000 locations ([2e1ea68](https://github.com/charlesroper/C64_music/commit/2e1ea68)). Symbol jumps and text searches were redirected to the on-screen file rather than activeGameId ([ce27e49](https://github.com/charlesroper/C64_music/commit/ce27e49)), and the assembler was hardened to reject missing operands and enforce deterministic multi-pass convergence ([87e6117](https://github.com/charlesroper/C64_music/commit/87e6117)).

### 3 November 2026: six structural seams for agent navigation

With defects resolved, Wave C redesigned the architecture to give AI agents and human contributors clear modular seams documented by Architectural Decision Records:

1. **Shared test harness**: `c1cb150` created `tests/helpers/browser_harness.mjs`, enforcing strict element identifier lookups and eliminating 541 lines of duplicate mock harness code across test suites ([c1cb150](https://github.com/charlesroper/C64_music/commit/c1cb150)).
2. **Telemetry snapshot boundary**: `a11e745` placed engine state behind `player.getTelemetry()`, pre-allocating reusable snapshot buffers and removing raw WebAssembly exports from the public interface ([a11e745](https://github.com/charlesroper/C64_music/commit/a11e745); [ADR 0001](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0001-telemetry-snapshot-boundary.md)).
3. **Loader adapters & lazy assembly**: `8ca5b72` replaced a 130-line load cascade with dedicated loader adapters (`GAME_LOADERS`) and lazy on-demand source assembly, cutting boot assembly latency by 85.5% from 386.5 ms to 56.2 ms ([8ca5b72](https://github.com/charlesroper/C64_music/commit/8ca5b72); [ADR 0002](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0002-game-loader-adapters.md)).
4. **Track session descriptors**: `67df9b9` introduced structured `TrackSession` objects returned by `player.selectTrack()` and `player.getSession()`, eliminating game identifier checks across the UI ([67df9b9](https://github.com/charlesroper/C64_music/commit/67df9b9); [ADR 0003](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0003-track-session-descriptor.md)).
5. **Assembler source index**: `0501936` built an assembler-owned `sourceIndex` providing O(1) address and symbol lookups, removing regular expressions and reverse line loops from the view ([0501936](https://github.com/charlesroper/C64_music/commit/0501936); [ADR 0004](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0004-assembler-source-index.md)).
6. **Workbench view boundary**: `d0315de` encapsulated all presentation, canvas scopes and DOM event handlers inside `createWorkbenchView` in `src/workbench_view.js`, moving browser boot to `src/app.js` and `src/main.js` with zero import side effects while preserving first-tap mobile audio unlock ([d0315de](https://github.com/charlesroper/C64_music/commit/d0315de); [ADR 0005](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0005-workbench-view-boundary.md)).

### 3 November 2026: cutting idle CPU and per-frame DOM writes

An audit of the presentation layer showed the `requestAnimationFrame` loop repainting the 384x272 C64 monitor canvas, four oscilloscope canvases and 27 telemetry cells on every display tick, even while paused or backgrounded ([2e29739](https://github.com/charlesroper/C64_music/commit/2e29739)). On a 120Hz or 144Hz screen, the browser did double the work for 50Hz PAL music. In `rambload.asm`, the Morse code banner rebuilt 55 `<span>` elements through `innerHTML` up to 60 times a second. Idle CPU sat between 12% and 18%.

Commit `2e29739` bypassed all canvas transfers and DOM writes when playback is paused or the document is hidden, and clamped refresh rates to 60Hz. It also cached telemetry strings, SID registers, voice states and line highlights, writing to elements only when values change. On consecutive identical frames, DOM writes dropped from 27 down to zero. The Morse banner now rebuilds only when a decoded character advances. Idle CPU dropped to near 0.0%, and lazy on-demand assembly cut initial startup assembly from 386.5 ms to 56.2 ms ([8ca5b72](https://github.com/charlesroper/C64_music/commit/8ca5b72)).

### 3 November 2026: closing the loop with standards and deterministic rules

The layered review programme concluded with Wave E, turning review findings into deterministic checks and written standards that automated review skills can cite ([Issue #16](https://github.com/charlesroper/C64_music/issues/16)). Previously, core project invariants (zero em-dashes, frozen historical sources, documentation test counts, and four-file CalVer alignment) existed only as prose instructions in contributor notes and could be breached silently. In addition, version bumping lacked guards against clock skew downgrades, and deployment scripts pushed to GitHub Pages without verifying clean working trees or remote configurations ([Issue #9](https://github.com/charlesroper/C64_music/issues/9)).

[CODING_STANDARDS.md](CODING_STANDARDS.md) was created to establish nine citable rules for architecture, rendering performance, typography, and test-driven development. `scripts/bump_version.mjs` was hardened to refuse CalVer downgrades when machine clocks skew, and `scripts/deploy.mjs` was equipped with preflight guards verifying a clean working tree and the existence of the `fork` remote before executing linter and test gates.

Finally, `tests/repo_rules.test.mjs` introduced eight deterministic regression checks that scan all tracked files for literal em-dash characters, verify SHA-256 cryptographic checksums on all seven historical Ocean assembly files and directives, assert lockstep test counts across `README.md` and `NARRATIVE.md`, and confirm four-file CalVer synchronization. The automated suite expanded from 36 checks across four files to 44 checks across five files, ensuring future agent reviews build on an enforced foundation.

### 6 November 2026: the engine core moves behind a message seam

Mobile browsers can starve the main thread for 50 to 200 ms during scrolling, which makes the `ScriptProcessorNode` audio path stutter. The fix is to move emulation and audio rendering onto the AudioWorklet thread, but that needs a seam before it needs a worklet. Issue #35 extracted the WebAssembly emulator, the six Loader Adapters, audio rendering and Telemetry Snapshot extraction into `src/engine_core.js`, behind a message protocol ([Issue #35](https://github.com/charlesroper/C64_music/issues/35); [ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md)).

`createEngineCore({ wasm, postMessage })` accepts ordered messages for `init`, `loadTrack`, `play`, `pause`, `setHardwareOptions`, `injectKey` and `requestTelemetry`. `loadTrack` takes only raw assembled bytecode and symbols, so the assembler and Source Index stay on the main thread. `src/player_engine.js` now drives the core through a thin in-thread transport adapter and keeps its public interface unchanged, re-exporting `GAME_LOADERS`, `jsr`, `setCpuState`, `readWord` and `writeWord`. Tests in `tests/engine_core.test.mjs` verify that the track load resets the CPU to the expected entry point, that arkadrum receives its arkanoid payload, that telemetry arrives on load and on every rendered block, and that sample-rate negotiation does not wipe loaded RAM. The full suite rose from 44 to 47 checks with the existing player tests still green.

### 6 November 2026: a track load that never drops a cycle

The Engine Core seam from #35 made track loading a message, but the load still behaved like an ordinary synchronous reset. Issue #36 gave it deterministic semantics. A Track Load now freezes the emulator clock and renders silence until the Loader Adapter finishes. The tune starts at frame 0, and the paused pre-render is gone. The core emits one Telemetry Snapshot when the load completes, so the CRT shows the initial screen without advancing song position.

Commands that arrive during a load no longer race the loader. The core holds them in a queue and applies each one in order once the load finishes. Tests in `tests/engine_core.test.mjs` drive a reentrant loader to prove the queue order, check that a paused load never calls `wasm_render_audio`, and confirm the clock stays at frame 0 while the core outputs silence ([Issue #36](https://github.com/charlesroper/C64_music/issues/36); [ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md)).

### 6 November 2026: when the worklet thread never answers

Issue #34 asked whether Chromium command-line flags could make `audioWorklet.addModule()` work in the PRoot sandbox, so the AudioWorklet migration could be verified headlessly before it shipped to a phone. The spike tested Chromium 1187 from Playwright 1.55.0 across flag variants: baseline, `--disable-features=AudioWorkletRealtimeThread`, `AudioServiceOutOfProcess`, `AudioServiceSandbox`, `--single-process`, `--mute-audio`, `--disable-audio-output` and `--disable-gpu`. Every run produced a running `AudioContext` and a present `audioWorklet`, but the module promise never resolved or rejected.

A sharper probe isolated the failure. A plain `Worker` started and replied, so thread creation works. `addModule()` then hung for an HTTP URL, a blob URL, a data URL and a deliberately missing URL. A missing module must reject at once if the loader thread is alive, so the fault sits in the AudioWorklet loading thread itself, not in the network, the module text or the flags ([Issue #34](https://github.com/charlesroper/C64_music/issues/34)). The newer Chromium 1254 build crashed at startup in this environment, headed under Xvfb included.

The decision is recorded in [ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md) and in project memory. Local verification stops at the in-thread Engine Core tests in `npm test`, which guard the message protocol, the frozen clock and the command queue. The end-to-end gate is a manual listen in a real mobile browser: load a track, play it, scroll and rotate the phone, and confirm the audio stays clean. Issue #37 can now build the worklet pipeline against that split gate.

### 6 November 2026: the sandbox could run the worklet after all

The previous entry was wrong. The worklet loading thread did answer, but only in some browser builds. A wider probe across the three Playwright engines found that WebKit 27.2 and Chromium 153 both load HTTP, blob, and data worklet modules, keep the `AudioContext` running, and call `process()` about 500 times in 1.5 seconds. Firefox 159 loads the module and constructs the node, but its context stays suspended, so the processor never ticks. Chromium 156 revision 1248 and Chromium 158 revision 1254 die at startup with SIGTRAP in this sandbox ([Issue #34](https://github.com/charlesroper/C64_music/issues/34)).

The old conclusion came from Chromium 1187 and a newer Chromium that crashed. It was a build regression, not a PRoot limit. Headless verification no longer stops at the in-thread Engine Core tests. WebKit can exercise the AudioWorklet pipeline for [Issue #37](https://github.com/charlesroper/C64_music/issues/37), Chromium 153 can repeat the check, and Firefox remains useful for boot, DOM, and layout checks. The engine matrix, install commands, and verification contract are recorded in [docs/agents/browser-verification.md](docs/agents/browser-verification.md), with the decision in [ADR 0008](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0008-headless-browser-verification.md). Audible output still needs a phone because the sandbox has no audio device.
