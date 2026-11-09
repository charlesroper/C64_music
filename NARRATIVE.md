# Galway 2664: history, architecture and source code

[This repository](https://github.com/charlesroper/C64_music) | [Martin Galway's original source](https://github.com/MartinGalway/C64_music) | [Live player](https://charlesroper.github.io/C64_music/)

---

## 1. What this project is

Galway 2664 is a web workbench for Martin Galway's Commodore 64 game music. The name nods to Martin Galway releasing his source code on GitHub in 2026 and writing the music for the Commodore 64, echoing four-digit chip numbers like the MOS 6502 processor and 6581 SID. It is built from the source code he wrote for Ocean Software from 1985 to 1987.

The player does not play recordings. Galway wrote his music as a program for the Commodore 64's processor. This player turns that program into machine code in your browser, then runs it on a software copy of the computer's processor and sound chip. What you hear is the browser mimicking a 1980s machine's silicon chips, computing the sound live from Galway's raw code and playing it through your computer's audio hardware.

The initial source files were uploaded by Galway in April and May 2026. In October 2026, Charles Roper forked the repository to build this player, working with Gemini 4 Argon and 3.8 Flash in Google Antigravity CLI and DeepSeek v4.1 Flash in OpenCode. The files include the music and sound effects for Wizball, Arkanoid, Rambo: First Blood Part II, Green Beret and Game Over, plus Galway's notes on the assembler Ocean used.

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

* **Boot Sequence.** Every full page load starts on a full-screen C64 CRT. The boot-pending state is in the static HTML, so the C64 screen is visible from first paint and the workbench cannot flash before it. A brief power-on flash leads to the exact BASIC screen, typed `LOAD""` and a PRESS PLAY ON TAPE gate. A click, tap or key unlocks browser audio and starts the `GALWAY 2664` tape loader for Wizball, with credits, loading bars, a block counter, border raster stripes and a synthesised tape sound. After a brief `READY.`, the CRT shrinks into the workbench monitor, audio starts and the boot overlay fades into the workbench over 2.4 seconds. `?skipBoot=1` and reduced motion use a static immediate mode that reveals the workbench from first paint and starts paused.
* **Header, logo and version.** The banner shows the white Galway 2664 logo, drawn with glyphs from the Commodore 64 PETSCII character ROM, which sparkles through VIC-II colours. It also shows the WebAssembly engine status light and the CalVer release pill.
* **Tune list and transport controls.** Choose a tune, pause, restart or fast-forward.
* **Oscilloscopes.** Live traces for the three voices and the master volume channel.
* **Monitor.** A copy of the text display that Galway's program draws into screen memory, rendered with authentic C64 character glyphs and a border that shows processor load. The HUD Row Guide follows the active game's memory layout, so Wizball, Arkanoid, Green Beret and Rambo each label the correct rows.
* **Source viewer.** Galway's assembly source, with markers that follow each voice through the score. Scrolling keeps pace with fast 16th notes and eases large leaps. Chips (V1, V2, V3 or DRM) select which voice to follow and the Follow Voice toggle turns following on. In hybrid pieces such as Arkanoid Digi-Drums, DRM tracks the drum sequencer in `arkadrum.asm` and the voice chips switch to `arkanoid.asm`. A full-width SID register strip (`$D400` to `$D418`) at the bottom shows live hex values in four colour-coded groups: V1, V2, V3 and Filter + Drums (FLT). The Filter + Drums group shares `$D418` between the filter and the digi-drum DAC. Each group lights up when its voices or filter sound. You can also edit the source and rerun it.
* **Track filters and voice controls.** Category pills narrow the tune list to ALL, MUSIC or SFX / DRUMS. Per-voice Mute (`M`), Solo (`S`) and `DIGI M` buttons isolate or silence individual voices.
* **Header toggles and keyboard injection.** HUD Row Guide and CRT Scanlines switch the on-screen guides and scanline effect. Stats for Nerds toggles the live audio and main-thread frame timing overlay, grouped by context, latency, process, deadlines, telemetry and events. Values are colour-coded green for normal, amber for under pressure and red for bad, with a matching dot and a legend in the guide. A `?` button expands plain-English descriptions for every group and metric. Session peaks persist until reload. Audio Mode switches between the stable `PLAYBACK` buffer and the lower-latency `INTERACTIVE` hint; changing it restarts the audio context and reloads the current track. Debug URLs also accept `?latency=balanced`, `?latency=0.1` and `?latency=0.2` for capture runs; invalid values fall back to `playback`. Low Power caps workbench rendering at 30fps, stops smooth source scrolling, disables sparkle and scanlines and uses 30Hz telemetry. It is off by default. Telemetry runs at 62.5Hz by default; `?telemetry=30` selects the lighter rate and `?telemetry=off` stops snapshots for isolation captures while audio diagnostics continue. Stats shows `OFF` when snapshots are stopped. The `C64 KEY INJECT` PETSCII bar sends keystrokes to the running routine.
* **Morse banner and source tools.** The live Rambo Morse decoder banner appears for the loader track. Symbol jump and search controls move through the active source file and the `OCEAN ASM DOCS` modal holds the assembler reference.
* **Hardware options.** A two-state switch selects the chip model, and a slider sets the drum boost:
  * **SID chip.** Toggle between the 1982 MOS 6581 and the 1987 MOS 8580. The 6581 has an analogue filter with non-linear resistance and mild saturation, plus quirks on combined waveforms. The 8580 uses a cleaner switched-capacitor filter. If a tune does not use the filter or combined waveforms, both chips sound identical. Where a filter is active, the difference is a subtle change in warmth and resonance.
  * **PAL timing.** The workbench runs the PAL machine: 50Hz, 985.2kHz and 312 lines. The engine and player still support NTSC, but the switch is retired because these PAL compositions run about 20% fast and unevenly. Wizball waits for PAL line 266; on a 263-line NTSC frame the fourth refresh lands at line 10 of the next frame. The SID frequency table is also the PAL table, so NTSC raises pitch by about 4%. The 50Hz VIC-II IRQ harnesses in `arkadrum.asm` and `gameover.asm` require PAL timing.
  * **Drum boost (`$D418`).** Adjust the volume boost (0.0x to 2.5x, default 1.3x) for Galway's 4-bit digital-to-analogue percussion on register `$D418`. Tracks using pure three-voice SID synthesis (such as Wizball, Green Beret and Rambo) set the master volume once and never modulate `$D418`, so the slider has no effect. It alters drum levels only on pieces with dedicated percussion routines: the hybrid Arkanoid Digi-Drums (`arkadrum.asm`) and Game Over (`gameover.asm`). Setting the slider to 0.0x silences the drums, while 2.5x boosts them over the musical chords.

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

Wizball and the non-drum Game Over routines share the same `DREFRESH` raster lines (32, 110, 188 and 266). Only Arkanoid uses a different set (57, 117, 172 and 237), which stays below line 263 and therefore works on both PAL and NTSC frames. In Wizball, Arkanoid and Game Over, the asterisk key sets `Refsp` to 1, which slows the music to a crawl for inspection.

### Drums from the volume register

The SID's master volume is the low four bits of `$D418`, giving 16 levels. Writing new values to it at audio rates turns the volume control into a crude 4-bit digital-to-analogue converter. Galway used it two ways:

* **Calculated drums in `arkadrum.asm`.** Drum routines such as `HIHAT` (line 138 onward) compute each value with arithmetic, adding a constant to a running total and masking it to four bits (`AND #15`), then write the result to `$D418`. The routine `PLEY` starts whichever drum the score has requested.
* **Stored samples in `gameover.asm`.** The tables `ROCKBASS` and `ROCKSNARE` hold recorded sounds, two 4-bit values per byte. The playback loop shifts out the high four bits and writes them, then writes the low four bits after a few padding `NOP` instructions that keep the timing even.

### The Morse code in the Rambo loader

`rambload.asm` contains four `Code` commands that jump to machine-code routines in the middle of the score. `STARTMC` (line 885) begins the Morse section, `MCFC1` (line 888) and `MCFC2` (line 891) step the carrier down to follow the bass and `YNCREMENT` (line 953) transposes Voice 1 upward inside a 64-step loop. `STARTMC` (line 1232) points the music driver at a different routine, `MCREFR`:

```assembly
STARTMC        LDA #$A0:STA $D406
               LDX #$4B:STX $D400
               LDY #$22:STY $D401
               LDX #MCREFR
               LDY ^MCREFR
               STX MUS+1
               STY MUS+2
```

The excerpt stops before the lines that clear Voice 1's other registers. Voice 1's frequency starts at `$224B`, about 516Hz on PAL and 535Hz on NTSC. `MCFC1` and `MCFC2` later step the carrier down to `$1B38` (about 409Hz PAL, 425Hz NTSC) and `$19B1` (about 386Hz PAL, 401Hz NTSC). `MCREFR` reads the table at `Secret` one letter at a time, looks up each letter's dots and dashes in `CodeTab` and switches Voice 1's gate on (control value 33) and off (32) for each. The table stores the names without spaces and spells:

BILL BARNA, DAVID COLLIER, MARTIN GALWAY, TONY POMFRET, STEVE WAHID

When the table ends, the routine restores the normal music driver.

### The border as a profiler

In 1987, developers had no performance profilers or debugging overlays. To measure how many clock cycles his music routines used, Galway turned the Commodore 64's video border into an oscilloscope.

The VIC-II video chip drew the television picture line by line from top to bottom (312 scanlines per frame on a European PAL display). Wizball disables interrupts with `SEI` (line 427) and calls `REFRESH` from the polled `DREFRESH` raster loop. At the start of the update, `REFRESH` increments the border colour register, `BDR` (`$D020`), turning the border white. At the end of the update, it decrements the register back to black:

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

The WebAssembly emulator (`src/wasm/c64_engine.c`) reproduces this by recording the active border colour for each of the 312 scanlines into a buffer whenever code writes to `$D020`. The web canvas draws visible scanlines 20 to 291 from that PAL buffer, so Galway's debug raster bars flicker and resize in real time as they did on his workbench monitor in 1987.

In the same file, `DREFCOLOUR EQU 15` in `wizball.asm` (line 418) temporarily turns the border light grey while copying debug telemetry (voice pointers, clocks and filter values) into screen memory at `$0400`. The Arkanoid and Game Over files set `DREFCOLOUR` to 0.

### A bytecode score

Each voice has a 16-bit pointer (`PC0`, `PC1`, `PC2`) into its own score. Values from `$C0` (`COM`) upward are commands, dispatched through the jump tables `vt0`, `vt1` and `vt2`. Lower values are notes, with `$5F` (`Rest`) as a rest. The commands, defined as offsets from `COM` in `wizball.asm`, include:

* `Call` and `Ret` for reusable phrases.
* `For` and `Next` for loops.
* `Filter` for the SID filter.
* `Code` for a jump to arbitrary machine code, as the Morse routine uses.
* Others include `FLoad`, `Freq`, `Transp` and `Master`.

---

### Community analysis: toolchains and modern reassembly

When Galway released the source files in April 2026, a [Hacker News discussion](https://news.ycombinator.com/item?id=47900398) examined the history, toolchains and preservation hurdles behind the code:

* **Cross-development on host machines.** For most 1986 and 1987 projects, Ocean developers assembled code on dedicated host machines, primarily the Tatung Einstein or early MS-DOS PCs, running proprietary cross-assemblers and piping binaries over a cable to test on the C64. The November 1985 `rambload.asm` loader is the exception: Galway developed it natively on a C64 with Zeus 64 Assembler. Host development stopped code loss whenever an experimental routine crashed the machine.
* **Proprietary assembler directives.** Galway's source used in-house Ocean assembler syntax, including directives such as `ORG`, `DSP`, `DFS`, `ADD` (which combined `CLC` and `ADC`), `SUB` (combining `SEC` and `SBC`) and caret notation (`^`) for high bytes.
* **Modern reassembly hurdles.** Developers attempting to assemble Galway's original files found that modern open-source 6502 toolchains (such as `acme`, `xa65` or `ca65`) rejected Ocean's custom directives. Compiling Galway's raw source required syntax translation or a dedicated assembler written for Ocean's 1980s dialect.
* **Early browser experiments.** Within hours of the release, readers used large language models to transcribe Galway's custom bytecode tables and build experimental JavaScript and Web Audio players.
* **Legal provenance.** Commenters praised Galway for securing a clean rights recovery from Infogrames and publishing the work under GPL-3.0, avoiding the corporate archive limbo typical of vintage commercial games.

---

## 5. How the player works

### Assembler (`src/ocean_assembler.js`)

A JavaScript assembler reads Galway's `.asm` files. It implements the directives in `ocean_assembler_directives.txt`: `ORG`, `ENT`, `DFS`, `DFB`, `DFW`, `DFL`, `DFH`, `DFM`, `DSP`, `DFC`, `ADD`, `SUB` and `EQU`, plus the expression operators `MOD`, `OR`, `XOR`, `DIV`, `AND`, `#` and `^`. It resolves labels in three passes and produces a memory image plus a map from addresses to source lines, which the source viewer uses.

### Emulator (`src/wasm/c64_engine.c`)

The emulator is written in C and compiled to WebAssembly, a compact binary format that browsers run at near-native speed. The file is about 25KB. It contains:

* A 6510 processor that counts cycles for each instruction.
* A VIC-II raster counter, at 63 cycles per line (PAL) or 65 (NTSC), so the raster waits above behave as they did on the machine.
* A SID with three oscillators, envelope generators, a noise source, the `$D418` volume channel and a filter.

The filter is a 2x-oversampled Chamberlin state-variable design. The output stage has a high-pass at about 15Hz, modelled on the capacitor that blocks direct current on a real machine's audio output and a soft saturation curve (`soft_saturate`) in place of hard clipping.

### Boot Sequence (`src/boot_sequence.js`)

The Boot Sequence mounts before the WASM engine and source files finish downloading, so the C64 screen appears immediately. A static boot-pending state in the document hides the app shell from first paint. The Workbench View skips rendering while the boot overlay covers it. It drives a small phase state machine through power-on, BASIC, typing, PRESS PLAY, tape load, READY and collapse. The PRESS PLAY gate is the user gesture that unlocks browser audio. Tape sound is a short-lived Web Audio graph that stops before Wizball starts playing. The screen uses the same PETSCII rasteriser and VIC-II palette as the workbench monitor. A module Web Worker assembles all six sources and the Arkanoid payload during the boot, and the loader waits for that prewarm before handing off. A system worker failure falls back to synchronous assembly of the active track. Normal completion starts audio, removes the boot-pending state and fades the overlay out over 2.4 seconds. Skip and reduced-motion paths use a static immediate mode that hides the boot overlay and reveals the workbench from first paint.

### Engine core (`src/engine_core.js`)

The Engine Core owns the WebAssembly emulator, the loader adapters, audio rendering and the telemetry snapshot. The main thread sends it ordered messages to initialise the sample rate, load a track from assembled bytecode, play, pause, change hardware options, inject a key or request telemetry. The core renders stereo blocks into caller-supplied buffers and emits a telemetry snapshot after each track load and, depending on the transport setting, after each audio frame. A Track Load freezes the emulator clock and emits silence until the loader finishes, so the tune starts at frame 0. Commands that arrive during the load wait in a queue and apply in order afterwards. The same interface runs in-thread for tests and inside the AudioWorklet for live audio.

### Browser audio (`src/player_engine.js`)

The player keeps the assembler and Source Index on the main thread. It compiles `c64_engine.wasm` once, passes the compiled module to the AudioWorklet and sends only assembled bytecode and symbols to the Engine Core over the processor `MessagePort`. It picks up the audio hardware's sample rate (44.1kHz or 48kHz) and tells the core without resetting loaded C64 RAM. On phones, it loads the worklet and unlocks audio inside the first interaction, because browsers block sound otherwise. The worklet queues commands until its Engine Core is ready, then replays the active track, hardware options and playback state. Tests use an in-thread transport adapter. Hardware telemetry, SID registers, voice states and screen RAM return in a reusable telemetry snapshot, so the rendering loop never touches emulator internals directly. The worklet holds six telemetry buffers and sends snapshots at 62.5Hz by default. `?telemetry=30` selects the lighter rate. `?telemetry=off` stops snapshot construction and sending for isolation captures while audio diagnostics continue. Diagnostics count late audio blocks separately from missed quanta: a late block finished over the 2.67ms budget, while a missed quantum was skipped entirely. Session peaks persist across diagnostics windows, and the overlay reports audio sub-phase and main-thread frame costs beside the audio totals.

### Interface

The workbench layout adapts to the screen size:

* **Desktop.** Three columns show the tunes and controls on the left, the live C64 monitor and oscilloscopes in the centre and the assembly source viewer on the right. Viewports shorter than 1200px keep the three columns and scroll vertically.
* **Laptop and tablet.** From 821px to 1200px wide, the monitor and tune controls sit side by side and the assembly source spans the full width below.
* **Mobile.** On narrow screens, a single column has four tabs: ALL PANELS, MONITOR, TUNES and LIVE .ASM. The Galway 2664 logo and version stay in the header.
* **Adaptive code viewer.** Assembly tracking uses `requestAnimationFrame` interpolation tailored to step distance. Steps up to 120px ease over 90ms, steps from 121px to 500px ease over 130ms and larger jumps pre-position near the target and ease the final 40 pixels over 70ms. Touch or mouse scrolling cancels active transitions at once.
* **Character display and logo.** Screen memory at `$0400` and the Galway 2664 header logo render with authentic 8x8 glyphs for all 256 PETSCII characters (`src/c64_charset.js`), supporting uppercase and lowercase text. The white logo sparkles through Commodore 64 palette colours 1.2 seconds after boot, on click and every 10 seconds.

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

Martin Galway uploaded his original assembly files to GitHub in April and May 2026. In October 2026, Charles Roper forked the repository to build this player. It was built by vibe coding with Gemini 4 Argon and 3.8 Flash in Google Antigravity CLI and DeepSeek v4.1 Flash in OpenCode, with Roper listening, testing on a phone and directing changes. The assembler, emulator and interface were written that way. Errors are likely and corrections are welcome.

`npm test` runs 102 automated checks across 12 test files:

* **Engine core message protocol.** `createEngineCore({ wasm, postMessage, shouldEmitTelemetry })` loads raw assembled bytecode, accepts an extra arkanoid payload for arkadrum drum tracks, renders audio blocks into caller buffers and handles init, play, pause, hardware options, key injection and telemetry requests. Tests assert telemetry is emitted on track load and repeated audio frames, that disabled telemetry skips snapshot construction and posting, that sample-rate negotiation leaves loaded C64 RAM intact, that a Track Load freezes the clock at frame 0 and emits silence without a pre-render, that commands received during a load apply in exact order afterwards and that fast-forward adds 3 frames per 2048 samples at any render block size.
* **PETSCII screen rasteriser.** The shared renderer paints screen RAM, colour RAM and border scanlines into the VIC-II palette for both the workbench CRT monitor and the Boot Sequence. Tests cover border colours, glyph rows, colour RAM, screen placement and ImageData reuse.
* **Assembly prewarm.** A module worker assembles all six sources before playback needs them. Tests verify the cache, source-index rehydration and the synchronous fallback when no worker is available.
* **Boot Sequence.** Tests cover the static first-paint state, visible boot overlay, power-on, BASIC, typing, the PRESS PLAY gate, readiness waiting, the normal crossfade, the collapsed frame position during the fade, skip, reduced motion, live-region phases and the handoff to a playing Wizball.
* **AudioWorklet processor.** The processor class receives a compiled `WebAssembly.Module`, instantiates the Engine Core on the audio thread, renders 128 stereo samples per quantum, queues commands that arrive before the core is ready, outputs silence during instantiation, throttles telemetry below the audio callback rate and transfers telemetry buffers back and forth through a six-buffer pool. The Player Engine is tested for queueing play until the worklet is ready, then replaying the active track and transport state, for defaulting to the playback latency hint and 62.5Hz telemetry, for accepting the 30Hz opt-in and for closing and recreating the audio context when the latency mode changes. The processor reports process timing percentiles, the 128-frame audio budget, persistent session peaks, late blocks, missed quanta, telemetry drops, audio sub-phase timings, the telemetry divider and output gain for the diagnostics overlay.
* **Telemetry buffer.** One transferable `ArrayBuffer` carries screen RAM, oscilloscope samples, SID registers, scanline border data, voice channels and filter values. Tests verify the packed layout round-trips into the `player.getTelemetry()` shape and that buffer reuse overwrites every field without stale data.
* **Issue closure guard.** `npm run issue:close` audits the issue body and refuses to close while any DoD or acceptance criteria task item is unchecked. A GitHub Action reopens any completed issue closed with unchecked items.
* **Repository rules and integrity guards.** Automated suite checks enforce zero em-dash characters (Unicode U+2014) across all tracked files, cryptographic SHA-256 integrity of frozen historical assembly sources and directives, documentation test count synchronisation across both README.md and NARRATIVE.md, harness-agnostic search guidance in AGENTS.md and four-file CalVer alignment.
* **Deployment and bump preflights.** Version bump calculations (`scripts/bump_version.mjs`) refuse to downgrade versions on clock-skewed machines and deployment automation (`scripts/deploy.mjs`) aborts if working trees are dirty or the fork remote is absent, distinguishing push failure from success.
* **Idle render throttling.** The presentation loop takes an early return idle path when paused or when `document.hidden` is true, eliminating all C64 monitor canvas draws, oscilloscope strokes and telemetry DOM writes, throttling refresh rates to 60Hz and restoring immediately on visibility.
* **Telemetry change guards.** All telemetry text elements, SID register hex cells, active voice classes and Morse stream spans compare against previous values before writing to the DOM, eliminating redundant mutations on consecutive identical frames.
* **Workbench view interface.** The presentation layer sits behind `createWorkbenchView` in `src/workbench_view.js` with a small surface (`renderSession`, `renderTelemetry`, `renderSource`, `getFrameDiagnostics`, `setPlaying`, `setRenderingPaused`), element lookup behind a registry and zero side effects on module import, while UI test suites drive the view using fake player adapters. Tests cover the boot-overlay rendering pause and resume.
* **Stats help mode and health colours.** Tests cover the help toggle, accessible name and `aria-expanded` state, all six group descriptions, all 38 metric descriptions, scroll reset, hide and reopen, and compact mode restoration. Health tests cover normal, under-pressure and bad values, the three-state legend, the 12.8ms Firefox output buffer as bad and neutral cumulative totals.
* **Debug latency hints.** Tests cover parsing of playback, balanced, interactive, 0.1 and 0.2, playback fallback, context creation, URL boot and Stats display.
* **Telemetry enable and disable.** Tests cover the Player Engine state, worklet and in-thread enable and disable paths, snapshots stopping while audio diagnostics continue, snapshots resuming on enable, the `?telemetry=off` hard override and Stats showing `OFF`.
* **Minimal render.** Tests cover the `?render=minimal` flag, the `render-minimal` body class, the paused workbench render loop, transport and track switching, the absence of the `low-power` class and phone-width CSS panel hiding.
* **Minimal render browser check.** `npm run check:minimal-render` launches Chromium 153 at 360px and 390px, opens `?render=minimal`, and asserts that the centre panel, right panel, SID strip and mobile tabs are hidden, the track list is visible and the page has no horizontal overflow.
* **Low power mode.** Tests cover the default-off switch, the 30fps render cap, telemetry reduction and restore, and sparkle suppression.
* **Assembler source index.** Assembled source artefacts provide a bound `sourceIndex` exposing `lineForAddress(addr)`, `lineForSymbol(name)` and `findLines(query)`, replacing regular expression scans and backwards address loops in the view with direct index queries.
* **Track session descriptors.** Calling `player.selectTrack()` yields a structured `TrackSession` descriptor defining the active game, tune, primary source file, drum sequencer availability and Morse banner states, removing all game identifier branching from the presentation layer.
* **Game loader adapters.** A dispatch table of named loader adapters (`GAME_LOADERS`) encapsulates hardware initialisation, zero-page word writes, custom raster setup and entry-point jumps across all six games, verified by asserting CPU states and cycle budgets.
* **Lazy assembly and cached HTML.** Sources assemble on demand per game rather than all six eagerly on boot, reducing initial assembly time by 85.5% (from 386.5ms to 56.2ms), while rendered source viewer HTML is cached per file and reused across switches.
* **Telemetry snapshot encapsulation.** Engine state (cycles, PC, SID registers, voices, filter, scope buffers and screen RAM) returns as a reusable snapshot from `player.getTelemetry()`. The audio thread packs it into a transferred `ArrayBuffer` from a six-buffer pool, so the hot path avoids structured cloning and hides the WebAssembly C ABI from the presentation layer.
* **Shared browser test harness.** A unified test harness (`tests/helpers/browser_harness.mjs`) parses authentic markup, throws on missing element identifiers to prevent silent fake drift and manages strict WebKit audio and animation frames across UI test suites.
* **Pitch.** Fourier analysis confirms that generated tones match the datasheet pitch formula in three configurations: 44.1kHz PAL, 48kHz PAL and 48kHz NTSC.
* **Catalogue.** All 73 tunes and sound effects across the six source files render audio without invalid values, clipping or a stuck output level.
* **Metadata.** All 73 tracks carry non-empty descriptions, valid duration hints, authentic keys and unique identifiers.
* **Drums.** The isolated `$D418` test runs Arkadrum and the 73-track sweep covers Game Over's PCM drums. The volume control works on both paths.
* **Mobile and audio unlock.** The page loads, unlocks audio on the first tap even during asset download and starts playback cleanly.
* **AudioWorklet verification gate.** Headless WebKit under PRoot verifies the worklet pipeline. Chromium 153 also works, Chromium 156 and later crash at startup and Firefox loads modules but keeps its audio context suspended. `npm test` verifies the Engine Core in-thread and a manual listen in a real mobile browser provides the final audio check.
* **Versioning and deployment.** The CalVer release identifier renders beside the title in both the header and document head, validated against same-day increments (`scripts/bump_version.mjs`), with automated deployments pushed directly to GitHub Pages (`scripts/deploy.mjs`).
* **Code style.** Biome checks JavaScript, JSON, CSS and HTML before every deployment. The first formatting pass sits in its own commit, recorded in `.git-blame-ignore-revs`, so history stays readable.
* **Responsive layouts.** The interface scrolls vertically and sizes elements correctly across mobile (375x812) and laptop (1024x768, 1100x700) viewports.
* **Character ROM and logo.** All 256 character codes produce authentic 8x8 glyphs with readable letters and punctuation and the white Galway 2664 brand logo sparkles through valid VIC-II colours.
* **Telemetry and controls.** Section 4 telemetry values render with tabular numbers to prevent jitter, control checkboxes synchronise on boot with Follow Voice off by default, interactive chips select the voice to follow and the bottom SID register strip groups voices responsively. The register-strip test checks the responsive `#sid-group-*` DOM grouping rather than the active sound lights.
* **Smooth code tracking.** The assembly viewer uses adaptive `requestAnimationFrame` timing to follow fast 16th notes without lag, pre-positions large leaps near their targets and yields immediately on user gestures.
* **Source editor safety.** Reassembly surfaces syntax errors in the status badge and preserves text and unsaved edits survive track changes.
* **Modal keyboard isolation.** Keyboard shortcuts ignore modal dialogs and preserve native button activation.
* **Track-aware drum following.** Drum sequencer tracking enables only on songs with percussion, reads through the seqPC symbol and preserves user follow state across track switches.
* **Source gutter address fidelity.** Address gutters hide empty statement sentinels while preserving authentic $0000 locations.
* **Source search and symbol alignment.** Symbol jumps and text searches scan whichever source file currently renders in the viewer.
* **Assembler hardening and loader safety.** The assembler rejects missing non-implied operands, enforces multi-pass convergence across all six sources while failing on unstable edits and guards unkeyed tracks and zero-page pointers.
* **Factual fidelity.** All quotations and technical references match Galway's original source files and equates verbatim.

These checks show that the player behaves consistently. They do not prove it is identical to a real Commodore 64.

---

## 8. Development blog

### 16 April 2026: Galway publishes the music sources

The release note is dated 14 April 2026 and is preserved in [README.md](https://github.com/charlesroper/C64_music/blob/main/README.md). Galway explains why the files are public: "So that folks can read through, analyse & understand the music players and how I went about doing my work." He also sets the terms. He retains copyright, having acquired the rights from Infogrames and asks for credit.

The note matters for anyone editing this repository. It sets the licence position and explains why the sources are treated as historical documents rather than working files. It also explains the two generations of player. Wizball uses the first, whose design had been in use since 1984 until about mid-1987. The second began with Athena and continued into Times of Lore and Insects in Space.

The release note landed on GitHub on 16 April, two days after the date written on it. Commit [312c429](https://github.com/charlesroper/C64_music/commit/312c429) created the repository and [cb92854](https://github.com/charlesroper/C64_music/commit/cb92854) added the note, later refined in [2721aec](https://github.com/charlesroper/C64_music/commit/2721aec) and [8ea9dcb](https://github.com/charlesroper/C64_music/commit/8ea9dcb). Those commits landed 14 minutes before Wizball arrived in [2a7a561](https://github.com/charlesroper/C64_music/commit/2a7a561).

### 16 April to 12 May 2026: six sources arrive through the browser

Galway uploaded the files over four weeks, mostly through GitHub's web interface, which is why the commit messages read "Add files via upload". Wizball arrived first on 16 April ([2a7a561](https://github.com/charlesroper/C64_music/commit/2a7a561)), followed by the assembler notes on 18 April ([a19961a](https://github.com/charlesroper/C64_music/commit/a19961a)), Game Over on 21 April ([11b9332](https://github.com/charlesroper/C64_music/commit/11b9332)), Arkanoid and the drum routine on 4 May ([fe93226](https://github.com/charlesroper/C64_music/commit/fe93226)), the Rambo loader the same day ([77dc334](https://github.com/charlesroper/C64_music/commit/77dc334)) and Green Beret on 12 May ([a458a36](https://github.com/charlesroper/C64_music/commit/a458a36)).

The assembler notes were edited four times over the same period, which suggests Galway was answering questions as readers found them. The files carry the dates of composition in their contents, from the Rambo loader in November 1985 to Game Over in July 1987. These initial uploads established Galway's historical archive, which then sat untouched for five months.

### 29 October 2026: Roper forks the repo and builds the player with Argon and Flash

In October 2026, Charles Roper forked the repository. The new application was built from the fork by Roper, Argon and Flash, vibe coding in Google's Antigravity.

The first build landed on 29 October as a single commit of 5,347 lines: a 370-line page, a 1,300-line application, a 470-line assembler, an 854-line catalogue, a 1,109-line stylesheet, a 133-line character ROM and a 1,111-line C core compiled to a 24,961-byte WebAssembly module ([d70dc1a](https://github.com/charlesroper/C64_music/commit/d70dc1a)). It looked finished, but pressing play produced nothing.

The cause was a missing export. `ensureAudioContext()` called `wasm_set_sample_rate()`, which had not been exported from the C core. The call threw a `TypeError` after the audio context was assigned but before the processing node was connected, so every later click failed as well. The fix exported the function, added a 15Hz AC coupling filter to remove the DC offset from narrow pulses and moved the audio work into `src/player_engine.js` ([cde6239](https://github.com/charlesroper/C64_music/commit/cde6239)).

That commit also started the test suite, with three files covering mobile layout, pitch and boot. The lesson held for the rest of the build: silence points to a wiring fault, so the wiring needs a test that clicks play.

### 29 October 2026: the typo that made two narratives

The story overlay needed a document, so `e2fdd30` created one. It created two: `NARRATIVE.md` and a misspelled duplicate, each 272 lines, differing by a single letter in the filename ([e2fdd30](https://github.com/charlesroper/C64_music/commit/e2fdd30)). The next two commits edited both files in parallel, so every fix was written twice.

The recovery came in `12ff883`, which deleted the misspelled file, rewrote the narrative and moved the markdown renderer into `src/markdown.js` with its own tests ([12ff883](https://github.com/charlesroper/C64_music/commit/12ff883)). The rewrite also removed claims the sources did not support, including an invented Filth Raid tempo, decimal mode arithmetic and an imagined capacitor filter. The commit body says it plainly: the new text quotes Galway verbatim and drops what the engine could not back up.

Deleting the duplicate was cheaper than maintaining it. The narrative now has one home and `tests/narrative.test.mjs` checks that every quotation appears in the sources.

### 30 October 2026: the catalogue was partly invented

The tune list had been written from plausibility rather than from the files. `2131438` corrected it against the assembly sources and found real errors: Wizball's jump vectors were corrected to the keys the source uses, B through K, a track called BonusBass was missing and Filth Raid was catalogued as a five-minute song when it is a five-second alarm jingle. Duration hints were fabricated, so they were replaced with verified times or an explicit "Loops" marker ([2131438](https://github.com/charlesroper/C64_music/commit/2131438)).

The correction touched 345 lines of `src/tracks_catalog.js` and added metadata tests. Those tests now assert a unique identifier, a valid duration hint and an authentic key for every entry and they check the catalogue for em-dashes. The tune list feeds the browser, the duration hints and the key labels, so an invented value was visible to every visitor. It is the clearest example in the repository of generated content passing review because nothing checked it against the primary source.

### 30 October 2026: CalVer and a rulebook

Eighteen commits landed on 30 October, most of them small fixes shipped one after another. Two of them changed how the project works. The page showed no release number and the package sat at `1.0.0`, so there was no way to tell which build a listener was using. `59da218` put a calendar version in the header and the document title ([59da218](https://github.com/charlesroper/C64_music/commit/59da218)) and `bcb7ace` added a script that bumps `package.json`, `index.html` and `src/version.js` together ([bcb7ace](https://github.com/charlesroper/C64_music/commit/bcb7ace)). The script adds a fourth segment when several releases land on one day, which is how so many commits in a single day each got a distinct number.

The same day produced [AGENTS.md](https://github.com/charlesroper/C64_music/blob/main/AGENTS.md) in [4b0e866](https://github.com/charlesroper/C64_music/commit/4b0e866), which states the rules that had been learned the hard way: the historical sources are immutable, documentation changes with the code, test counts must match and no em-dashes. [84ff480](https://github.com/charlesroper/C64_music/commit/84ff480) strengthened the documentation sync rule after a feature shipped with stale docs. The badge test added in [59da218](https://github.com/charlesroper/C64_music/commit/59da218) checks that the version sits next to the app title, so the rule holds without a human looking.

### 30 October 2026: three names in one day

The workbench was first called Galway26, then Galway 64, then Galway 2664. Each rename touched about a dozen files: the page title, the header, the package name, the version script, the character ROM, the tests and both documents ([7a3ca0d](https://github.com/charlesroper/C64_music/commit/7a3ca0d), [3a7f8e1](https://github.com/charlesroper/C64_music/commit/3a7f8e1), [daf82a4](https://github.com/charlesroper/C64_music/commit/daf82a4)). The cost comes from the name being encoded in a test as well as in the page, so a rename means editing assertions about the header before the build passes again.

The final name comes from the two facts in the README: Galway released the music in 2026 and wrote it for the Commodore 64, so the number echoes the four-digit chip designators in the machine, the MOS 6502 and the 6581 SID. The two earlier names each captured half of that. The same commit fixed voice following for the hybrid Arkanoid Digi-Drums, where the DRM chip now loads `arkadrum.asm` while the voice chips stay on `arkanoid.asm`.

### 30 to 31 October 2026: smooth scrolling broke, then came back

`f4dea5b` moved the source viewer onto `scrollTo({ behavior: "smooth" })` on 30 October ([f4dea5b](https://github.com/charlesroper/C64_music/commit/f4dea5b)). `51dab0a` rewrote the rendering loop and the line highlighting that evening and switched target calculation to `getBoundingClientRect()` ([51dab0a](https://github.com/charlesroper/C64_music/commit/51dab0a)). The change looked like a speed improvement and broke tracking on WebKit, where smooth scrolling inside an overflow container fails without an error.

`889c372` replaced it with `requestAnimationFrame` interpolation roughly four hours later on 31 October ([889c372](https://github.com/charlesroper/C64_music/commit/889c372)). The commit body explains the two faults: browser transitions restarted whenever a 100 to 200ms note step interrupted a 400ms animation and sampling bounding rectangles mid-animation caused jitter. The replacement computes targets from `offsetTop`, eases short steps over 90ms and jumps most of a long distance before easing the final 40 pixels. It added 97 lines of tests, including cancellation on user touch.

The regression lasted roughly four hours. No test had watched the viewer during fast passages, so the new test does.

### 1 November 2026: the licence changes from MIT to GPL-3.0

The repository initially carried an MIT licence. [13c2c77](https://github.com/charlesroper/C64_music/commit/13c2c77) corrected it to GPL-3.0 to match Galway's release terms and the copyright position set out in his note.

### 2 November 2026: Biome tooling and the clean-slate baseline

The codebase lacked a single linter and formatter, leaving indentation and style inconsistent across JavaScript, CSS, HTML and JSON. Commit `8938d16` introduced [Biome](https://biomejs.dev/) as the sole tooling gate ([8938d16](https://github.com/charlesroper/C64_music/commit/8938d16)). A repository-wide formatting pass formatted 33 files in `0937522`, fixing syntax warnings and establishing zero-diagnostic clean code ([0937522](https://github.com/charlesroper/C64_music/commit/0937522)).

To protect git history, commit `b3fdd6d` recorded the formatting revision in `.git-blame-ignore-revs` ([b3fdd6d](https://github.com/charlesroper/C64_music/commit/b3fdd6d)). Running `git blame` skips the mechanical formatting commit entirely, keeping original line attributions intact. This established Wave 0 of the review programme and resolved issue #17.

### 2 November 2026: the layered review programme

Fifteen open issues sat in the tracker, five earlier fixes had landed without review trails and every architectural discussion risked re-inventing vocabulary ([Issue #16](https://github.com/charlesroper/C64_music/issues/16)). Mixing defect fixes, structural redesigns and performance work into single passes had produced churn where refactoring baked bugs into new shapes.

Wave A ran a read-only audit across the repository ([c42208a](https://github.com/charlesroper/C64_music/commit/c42208a)). It validated the fifteen open issues against the code and sorted them into three sequential waves: defects first, so refactoring never hardens broken behaviour; structure second, so seams are never designed around dead code; and performance third, so optimisation measures the final architecture rather than temporary shapes.

### 2 November 2026: clearing the defect backlog

Wave B resolved five long-standing functional defects test-first across six commits. Syntax errors in the source editor were surfaced in the status badge while protecting dirty edit buffers from being wiped during track switches ([dfd6781](https://github.com/charlesroper/C64_music/commit/dfd6781)). Global shortcuts (Space, 1-4, letter keys) were isolated from open modal dialogs and native button clicks ([a0c3748](https://github.com/charlesroper/C64_music/commit/a0c3748)).

The DRM chip follow mode was made track-aware so it only activated on songs with percussion, resolving through the `seqPC` symbol and preserving user follow choices across switches ([96f822f](https://github.com/charlesroper/C64_music/commit/96f822f)). Address gutters stopped displaying sentinel -1 values while keeping valid $0000 locations ([2e1ea68](https://github.com/charlesroper/C64_music/commit/2e1ea68)). Symbol jumps and text searches were redirected to the on-screen file rather than activeGameId ([ce27e49](https://github.com/charlesroper/C64_music/commit/ce27e49)) and the assembler was hardened to reject missing operands and enforce deterministic multi-pass convergence ([87e6117](https://github.com/charlesroper/C64_music/commit/87e6117)).

### 3 November 2026: six structural seams for agent navigation

With defects resolved, Wave C redesigned the architecture to give AI agents and human contributors clear modular seams documented by Architectural Decision Records:

1. **Shared test harness**: `c1cb150` created `tests/helpers/browser_harness.mjs`, enforcing strict element identifier lookups and eliminating 541 lines of duplicate mock harness code across test suites ([c1cb150](https://github.com/charlesroper/C64_music/commit/c1cb150)).
2. **Telemetry snapshot boundary**: `a11e745` placed engine state behind `player.getTelemetry()`, pre-allocating reusable snapshot buffers and removing raw WebAssembly exports from the public interface ([a11e745](https://github.com/charlesroper/C64_music/commit/a11e745); [ADR 0001](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0001-telemetry-snapshot-boundary.md)).
3. **Loader adapters and lazy assembly**: `8ca5b72` replaced a 130-line load cascade with dedicated loader adapters (`GAME_LOADERS`) and lazy on-demand source assembly, cutting boot assembly latency by 85.5% from 386.5ms to 56.2ms ([8ca5b72](https://github.com/charlesroper/C64_music/commit/8ca5b72); [ADR 0002](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0002-game-loader-adapters.md)).
4. **Track session descriptors**: `67df9b9` introduced structured `TrackSession` objects returned by `player.selectTrack()` and `player.getSession()`, eliminating game identifier checks across the UI ([67df9b9](https://github.com/charlesroper/C64_music/commit/67df9b9); [ADR 0003](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0003-track-session-descriptor.md)).
5. **Assembler source index**: `0501936` built an assembler-owned `sourceIndex` providing O(1) address and symbol lookups, removing regular expressions and reverse line loops from the view ([0501936](https://github.com/charlesroper/C64_music/commit/0501936); [ADR 0004](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0004-assembler-source-index.md)).
6. **Workbench view boundary**: `d0315de` encapsulated all presentation, canvas scopes and DOM event handlers inside `createWorkbenchView` in `src/workbench_view.js`, moving browser boot to `src/app.js` and `src/main.js` with zero import side effects while preserving first-tap mobile audio unlock ([d0315de](https://github.com/charlesroper/C64_music/commit/d0315de); [ADR 0005](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0005-workbench-view-boundary.md)).

### 3 November 2026: cutting idle CPU and per-frame DOM writes

An audit of the presentation layer showed the `requestAnimationFrame` loop repainting the 384x272 C64 monitor canvas, four oscilloscope canvases and 27 telemetry cells on every display tick, even while paused or backgrounded ([2e29739](https://github.com/charlesroper/C64_music/commit/2e29739)). On a 120Hz or 144Hz screen, the browser did double the work for 50Hz PAL music. In `rambload.asm`, the Morse code banner rebuilt 55 `<span>` elements through `innerHTML` up to 60 times a second. Idle CPU sat between 12% and 18%.

Commit `2e29739` bypassed all canvas transfers and DOM writes when playback is paused or the document is hidden and clamped refresh rates to 60Hz. It also cached telemetry strings, SID registers, voice states and line highlights, writing to elements only when values change. On consecutive identical frames, DOM writes dropped from 27 down to zero. The Morse banner now rebuilds only when a decoded character advances. Idle CPU dropped to near 0.0% and lazy on-demand assembly cut initial startup assembly from 386.5ms to 56.2ms ([8ca5b72](https://github.com/charlesroper/C64_music/commit/8ca5b72)).

### 3 November 2026: closing the loop with standards and deterministic rules

The layered review programme concluded with Wave E, turning review findings into deterministic checks and written standards that automated review skills can cite ([Issue #16](https://github.com/charlesroper/C64_music/issues/16)). Previously, core project invariants (zero em-dashes, frozen historical sources, documentation test counts and four-file CalVer alignment) existed only as prose instructions in contributor notes and could be breached silently. In addition, version bumping lacked guards against clock skew downgrades and deployment scripts pushed to GitHub Pages without verifying clean working trees or remote configurations ([Issue #9](https://github.com/charlesroper/C64_music/issues/9)).

[CODING_STANDARDS.md](CODING_STANDARDS.md) was created to establish nine citable rules for architecture, rendering performance, typography and test-driven development. `scripts/bump_version.mjs` was hardened to refuse CalVer downgrades when machine clocks skew and `scripts/deploy.mjs` was equipped with preflight guards verifying a clean working tree and the existence of the `fork` remote before executing linter and test gates.

Finally, `tests/repo_rules.test.mjs` introduced eight deterministic regression checks that scan all tracked files for literal em-dash characters, verify SHA-256 cryptographic checksums on all seven historical Ocean assembly files and directives, assert lockstep test counts across `README.md` and `NARRATIVE.md` and confirm four-file CalVer synchronisation. The automated suite expanded from 36 checks across four files to 44 checks across five files, ensuring future agent reviews build on an enforced foundation.

### 6 November 2026: the engine core moves behind a message seam

Mobile browsers can starve the main thread for 50 to 200ms during scrolling, which makes the `ScriptProcessorNode` audio path stutter. The fix is to move emulation and audio rendering onto the AudioWorklet thread, but that needs a seam before it needs a worklet. Issue #35 extracted the WebAssembly emulator, the six Loader Adapters, audio rendering and Telemetry Snapshot extraction into `src/engine_core.js`, behind a message protocol ([Issue #35](https://github.com/charlesroper/C64_music/issues/35); [ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md)).

`createEngineCore({ wasm, postMessage })` accepts ordered messages for `init`, `loadTrack`, `play`, `pause`, `setHardwareOptions`, `injectKey` and `requestTelemetry`. `loadTrack` takes only raw assembled bytecode and symbols, so the assembler and Source Index stay on the main thread. `src/player_engine.js` now drives the core through a thin in-thread transport adapter and keeps its public interface unchanged, re-exporting `GAME_LOADERS`, `jsr`, `setCpuState`, `readWord` and `writeWord`. Tests in `tests/engine_core.test.mjs` verify that the track load resets the CPU to the expected entry point, that arkadrum receives its arkanoid payload, that telemetry arrives on load and on every rendered block and that sample-rate negotiation does not wipe loaded RAM. The full suite rose from 44 to 47 checks with the existing player tests still green.

### 6 November 2026: a track load that never drops a cycle

The Engine Core seam from #35 made track loading a message, but the load still behaved like an ordinary synchronous reset. Issue #36 gave it deterministic semantics. A Track Load now freezes the emulator clock and renders silence until the Loader Adapter finishes. The tune starts at frame 0 and the paused pre-render is gone. The core emits one Telemetry Snapshot when the load completes, so the CRT shows the initial screen without advancing song position.

Commands that arrive during a load no longer race the loader. The core holds them in a queue and applies each one in order once the load finishes. Tests in `tests/engine_core.test.mjs` drive a reentrant loader to prove the queue order, check that a paused load never calls `wasm_render_audio` and confirm the clock stays at frame 0 while the core outputs silence ([Issue #36](https://github.com/charlesroper/C64_music/issues/36); [ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md)).

### 6 November 2026: when the worklet thread never answers

Issue #34 asked whether Chromium command-line flags could make `audioWorklet.addModule()` work in the PRoot sandbox, so the AudioWorklet migration could be verified headlessly before it shipped to a phone. The spike tested Chromium 1187 from Playwright 1.55.0 across flag variants: baseline, `--disable-features=AudioWorkletRealtimeThread`, `AudioServiceOutOfProcess`, `AudioServiceSandbox`, `--single-process`, `--mute-audio`, `--disable-audio-output` and `--disable-gpu`. Every run produced a running `AudioContext` and a present `audioWorklet`, but the module promise never resolved or rejected.

A sharper probe isolated the failure. A plain `Worker` started and replied, so thread creation works. `addModule()` then hung for an HTTP URL, a blob URL, a data URL and a deliberately missing URL. A missing module must reject at once if the loader thread is alive, so the fault sits in the AudioWorklet loading thread itself, not in the network, the module text or the flags ([Issue #34](https://github.com/charlesroper/C64_music/issues/34)). The newer Chromium 1254 build crashed at startup in this environment, headed under Xvfb included.

The decision is recorded in [ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md) and in project memory. Local verification stops at the in-thread Engine Core tests in `npm test`, which guard the message protocol, the frozen clock and the command queue. The end-to-end gate is a manual listen in a real mobile browser: load a track, play it, scroll and rotate the phone and confirm the audio stays clean. Issue #37 can now build the worklet pipeline against that split gate.

### 6 November 2026: the sandbox could run the worklet after all

The previous entry was wrong. The worklet loading thread did answer, but only in some browser builds. A wider probe across the three Playwright engines found that WebKit 27.2 and Chromium 153 both load HTTP, blob and data worklet modules, keep the `AudioContext` running and call `process()` about 500 times in 1.5 seconds. Firefox 159 loads the module and constructs the node, but its context stays suspended, so the processor never ticks. Chromium 156 revision 1248 and Chromium 158 revision 1254 die at startup with SIGTRAP in this sandbox ([Issue #34](https://github.com/charlesroper/C64_music/issues/34)).

The old conclusion came from Chromium 1187 and a newer Chromium that crashed. It was a build regression, not a PRoot limit. Headless verification no longer stops at the in-thread Engine Core tests. WebKit can exercise the AudioWorklet pipeline for [Issue #37](https://github.com/charlesroper/C64_music/issues/37), Chromium 153 can repeat the check and Firefox remains useful for boot, DOM and layout checks. The engine matrix, install commands and verification contract are recorded in [docs/agents/browser-verification.md](docs/agents/browser-verification.md), with the decision in [ADR 0008](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0008-headless-browser-verification.md). Audible output still needs a phone because the sandbox has no audio device.

### 6 November 2026: the engine moves onto the audio thread

The audio path still ran through a `ScriptProcessorNode`, so main-thread work could starve the SID emulation during scrolling, orientation changes and track loads. Issue #37 moved the Engine Core into an `AudioWorkletProcessor` ([Issue #37](https://github.com/charlesroper/C64_music/issues/37)).

`src/audio_worklet.js` receives the compiled `WebAssembly.Module` through `processorOptions`, instantiates the Engine Core on the audio thread and renders 128 stereo frames per `process()` callback. The Player Engine sends track loads, play and pause, hardware options and key injections over the processor `MessagePort`. Commands that arrive before the core is ready wait in a queue. Telemetry is throttled to about 62.5Hz instead of one snapshot per 128-frame quantum. The in-thread transport remains for `npm test`; browser playback relies on the AudioWorklet alone.

Four new tests in `tests/audio_worklet.test.mjs` cover module instantiation, 128-frame rendering, pre-ready command queuing, silence during startup and telemetry throttling. The suite is now 56 checks across 8 files. Headless WebKit and Chromium 153 both report `audioBackend: "worklet"` after the first tap and the telemetry frame count advances while `process()` runs. The manual phone listen remains the final audio gate ([ADR 0007](https://github.com/charlesroper/C64_music/blob/main/docs/adr/0007-audioworklet-engine-core.md)).

### 6 November 2026: telemetry moves without stopping the audio thread

The first AudioWorklet build played music on the phone, but it popped under load and sounded slightly worse than the old `ScriptProcessorNode` path. A render benchmark found the cause. Emulation of a 128-frame quantum took about 47 microseconds at the median. Attaching a full Telemetry Snapshot raised the 99th percentile to about 1 millisecond and produced multi-millisecond spikes, because the worklet structured-cloned C64 RAM, oscilloscope samples, SID registers and border data on the audio thread every six quanta. C64 RAM alone is 64KB.

Issue #38 replaced the clone with a transferred `ArrayBuffer` ([Issue #38](https://github.com/charlesroper/C64_music/issues/38)). The audio thread packs one snapshot into a buffer from a three-buffer pool and transfers ownership to the main thread. The main thread rebuilds the familiar snapshot views, then returns the previous buffer to the pool. If the pool runs dry, the worklet drops that telemetry frame rather than miss an audio deadline. Packing keeps the 99th percentile near 200 microseconds in the same benchmark, against about 1 millisecond for the clone.

`src/telemetry_buffer.js` owns the fixed layout and round-trip functions. Two tests in `tests/telemetry_buffer.test.mjs` and one new worklet test cover the packed shape, buffer reuse and transfer recycling. The suite is now 59 checks across 9 files. Headless WebKit and Chromium 153 still report `audioBackend: "worklet"` and the CRT canvas and register readouts keep updating from transferred buffers.

### 6 November 2026: the worklet owns the whole audio lifecycle

Issue #39 closed the gaps left by the first worklet build ([Issue #39](https://github.com/charlesroper/C64_music/issues/39)). The worklet now loads on the first pointer or key interaction, not only on the Play button. A play pressed before the processor is ready waits in the queue, then replays the active track, hardware options and transport state when the processor reports ready.

The fast-forward path also carried a real bug. The engine added 3 extra frames on every render call, which was correct for 2048-frame ScriptProcessor blocks but 16 times too fast for 128-frame worklet quanta. The core now accumulates output samples and applies 3 extra frames per 2048 samples at any block size. A regression test renders the same 4096 samples through 128-frame and 2048-frame blocks and asserts two fast-forward calls of 3 frames each.

The browser `ScriptProcessorNode` path is gone. Browser playback relies on the AudioWorklet alone, while `npm test` keeps the in-thread transport adapter. There is now one audio path to tune and one lifecycle to verify. The suite is 61 checks across 9 files. The next ticket (#41) adds interruption diagnostics and smoothing before the final phone listening test.

### 7 November 2026: audio diagnostics land before the listening test

Issue #41 started with measurement, not another blind fix ([Issue #41](https://github.com/charlesroper/C64_music/issues/41)). The app now accepts `?audioDebug=1` and draws a fixed overlay with process timing percentiles, the 128-frame audio budget, missed quanta, telemetry drops, output gain, context state and `baseLatency` / `outputLatency`. A second flag, `?latency=playback`, compares the browser's playback latency hint against the default.

The worklet now tracks how many audio quanta the browser skipped by comparing `currentFrame` deltas against the expected 128-frame step. It also buckets `process()` duration into a small histogram, so the overlay can show p50, p95, p99 and max without sorting an array on the audio thread.

Play, pause and context interruptions now use a 5ms sample-accurate gain ramp inside the worklet. Hard track cuts stay unchanged. Telemetry voice and filter fields moved into the transferable buffer and the Engine Core caches its audio views, removing the last per-block typed-array allocations.

Headless WebKit reports a 25 microsecond median, about 1 millisecond at p95 and zero missed quanta. Headless Chromium reports missed quanta during the same run, which fits its headless audio scheduler and makes WebKit the more trustworthy local gate. The latency hint comparison and the notification-shade test still need real phone data. Issue #40 stays blocked until that data arrives.

### 7 November 2026: playback latency becomes the default

The phone comparison settled the latency trade. Playback mode reported zero missed quanta, about 184ms output latency and minimal pops. Interactive mode reported about 16ms output latency, but the capture was taken while paused, so it never proved itself under load. Listening judgment favoured playback mode.

The default `AudioContext` latency hint is now `"playback"`. `?latency=interactive` remains available for lower-latency experiments. The diagnostic overlay still reports both values, so the choice can be revisited with data. The 64-check suite includes a regression test that keeps playback as the default.

### 7 November 2026: the worklet passes the phone test

The final listening test passed on Android at `2026.11.07.1` ([Issue #40](https://github.com/charlesroper/C64_music/issues/40)). Playback stayed clean while scrolling the assembly viewer, rotating the phone, opening and closing the notification shade, changing volume, switching games and tracks and using fast-forward.

The debug overlay reported zero missed quanta, a p99 near 1ms against the 2.67ms budget and about 184ms output latency in playback mode. The remaining occasional pop is outside the app: Android volume ducking or the device audio path. No render-ahead buffer was needed.

This closes the AudioWorklet refactor ([Issue #29](https://github.com/charlesroper/C64_music/issues/29)). Browser playback now has one path: the worklet owns emulation, audio rendering, command handling and telemetry transfer. The ScriptProcessorNode path is gone, the in-thread adapter remains for tests and the default latency hint favours stability over the last 180ms of responsiveness.

### 7 November 2026: the in-app reference matches the machines

Issue #14 corrected the live workbench copy against the emulator and the assembly sources ([Issue #14](https://github.com/charlesroper/C64_music/issues/14)). The restart and fast-forward buttons no longer advertise `R` and `F` shortcuts that never existed. The SID dropdown describes the 6581 as a 1982 analogue chip and the 8580 as a 1987 C64C linear chip, matching the modelled filter behaviour. The headers now say `Ocean .asm source` and cover the 1985-87 corpus rather than 1987 alone.

The Morse banner names the frequency register pair (`$D400` to `$D401`), and the assembler reference explains the Arkanoid raster lines, the per-game zero-page maps, the `$60` duration threshold and the stepped Morse carrier. The HUD Row Guide is now game-aware: Wizball uses `ZERO0` at `$04-$1C`, Arkanoid and Game Over use `ZER0` at `$10-$2E`, Green Beret uses its own `A0..SZ` layout, and Rambo uses its loader rows. The guide re-renders when the active game changes.

The copy edits remove ghost shortcuts, Americanisms, Oxford commas and Title Case tooltips. `npm test` passes with 64 checks.

### 7 November 2026: the catalogue is checked against the sources

Issue #15 corrected the last metadata layer: the 73 track entries in `src/tracks_catalog.js` ([Issue #15](https://github.com/charlesroper/C64_music/issues/15)). Header dates now use the dates written in Galway's files, from Rambo in November 1985 to Game Over in July 1987. The `ORG` and zero-page maps match the assembler layout: Wizball at `$1000` and `$4600`, Arkadrum at `$4000` and `$5000`, Arkanoid at `$0803`, `$2000`, `$3E00` and `$3F00`. Arkanoid now lists 6 tunes and 12 three-channel SFX. Green Beret lists 12 tunes and 8 SFX, with two stage siren cues.

The track durations, loop markers and voice roles were checked against playback. End of Level is 0:02, four one-shot SFX no longer claim to loop, Game Over's cowbell break starts in bar 11, Green Beret's title voices are swapped back to the source order, and Rambo's loader runs for about 30 seconds of Morse before finishing at 3:32 rather than looping. Raw backticks are gone from the summary text.

The metadata test now checks for en and em dashes across the documentation, rejects backticks in game summaries, validates keys for every keyed game, and compares the Arkanoid and Green Beret badge counts with the catalogue. `tests/narrative.test.mjs` checks the Game Over and Arkanoid `DREFRESH` lines and ties the digi-boost slider maximum to the narrative. The suite remains at 64 checks across 9 files.

### 7 November 2026: two-state hardware switches and a diagnostics button

The SID chip and clock/VIC dropdowns became two-state switches, so the current chip and video standard stay visible without opening a menu. The header also gained a Stats for Nerds button that toggles the audio diagnostics overlay, which previously required `?audioDebug=1`. The overlay starts hidden, updates only while visible and still reports process timing, missed quanta, telemetry drops, context state and output latency.

The NTSC switch remains a hardware-fidelity check, not a supported playback mode for these PAL compositions. Wizball's 200Hz loop waits for PAL line 266. On a 263-line NTSC frame the fourth refresh lands at line 10 of the next frame, so the rhythm lurches and the driver runs about 20% fast. The SID frequency table is also the PAL table, which raises pitch by about 4%. None of that is an emulator fault; the source itself is tied to PAL raster timing.

`npm test` now covers both hardware switches, the mobile switch touch targets and the overlay button. The suite is 66 checks across 9 files.

### 7 November 2026: audio mode restarts without a page reload

The header now has an Audio Mode switch between `PLAYBACK` and `INTERACTIVE`. `PLAYBACK` is the stable default. `INTERACTIVE` asks the browser for a smaller audio buffer. The switch replaces the earlier `?latency=interactive` experiment as the everyday control, though the query flag still sets the initial mode.

Changing mode closes the current `AudioContext`, tears down the worklet transport, replays the active track, hardware options and play state into the in-thread core, then creates a new context with the selected latency hint. The track restarts from the beginning and audio stops briefly. This avoids a page reload while keeping one audio lifecycle at a time. If the worklet path is available, its ready callback replays the same track load into the new audio thread.

The Player Engine test checks that the old context closes, the new context receives the selected hint, playback state survives and audio resumes. The browser harness checks the switch and label. The suite is 67 checks across 9 files.

### 7 November 2026: NTSC switch retired and audio mode promoted

The PAL/NTSC switch is gone from the header. The emulator, player hardware options and pitch tests still support NTSC, but the workbench runs PAL because these compositions depend on PAL raster timing. Removing the switch stops a 20% tempo error being presented as a normal playback choice. Audio Mode moved into the old Clock/VIC slot.

The `$D418` slider is now labelled Drum Boost (`$D418`). The plain name comes first and the register name stays visible, so the control says what it does without hiding the hardware detail. Its tooltip still explains the digital-to-analogue percussion path.

The browser harness checks that the retired NTSC control is absent and that the remaining switches still apply their options. `npm test` passes with 67 checks across 9 files.

### 7 November 2026: SID register strip gets plain names and full width

The bottom register strip moved out of the source panel and now spans all three workbench columns on wide screens. Group tags read V1, V2, V3 and Filter + Drums (FLT). The three voice labels stay short and the shared filter and drum group keeps its plain-English name.

There is no separate drum strip. The digi drums use SID register `$D418`, which already belongs to the filter group, so the last group is labelled Filter + Drums. The strip header reads SID Registers (`$D400-$D418`). Existing register tooltips and the technical addresses remain.

The register groups use balanced rows. Four sit across on wide screens, two per row on tablets and one full-width row per group on phones. Inside each group the label stays fixed while the register cells grow to fill the spare width. Cells are capped at 34px and floored at 18px, so they stay readable without becoming oversized. The strip stays hidden in the Monitor and Tunes tabs, matching the source panel it used to live inside. Tests assert the full-width grid placement, the 4/2/1 row behaviour, the cell width limits and the labels. The suite remains at 67 checks across 9 files.

### 8 November 2026: the first load becomes a C64 power-on

The workbench used to appear as a finished dashboard. The first impression was a web page loading, not a Commodore 64 booting Galway's software. Issue #42 specified a full-screen Boot Sequence that runs on every full page load. A power-on flash leads to the exact BASIC screen, typed `LOAD""`, and a PRESS PLAY ON TAPE gate. The gate is the browser gesture that unlocks audio. It starts an Ocean-style `GALWAY 2664` tape loader for Wizball, with Martin Galway and Ocean Software credits, loading bars, a block counter, border raster stripes and a synthesised tape sound. After a brief `READY.`, the CRT shrinks into the workbench monitor and Wizball title music starts.

The screen renderer is shared with the workbench monitor, so the boot does not duplicate PETSCII glyph or palette code. All six sources and the Arkanoid payload are assembled in a module Web Worker during the boot. The loader waits for that prewarm before handoff, and a worker failure falls back to synchronous assembly of the active track. Wizball is loaded paused from the warmed cache while the loader is visible, then playback starts when the CRT collapses. This avoids a blank monitor at handoff.

The Boot Sequence can be skipped with a key or click. Skipping uses the same gesture to unlock audio and lands on loaded Wizball with music. `?skipBoot=1` and `prefers-reduced-motion` land on the workbench with Wizball loaded but paused. The workbench stays hidden during the boot and the strip does not repeat on in-app track changes.

Tickets [#43](https://github.com/charlesroper/C64_music/issues/43), [#44](https://github.com/charlesroper/C64_music/issues/44), [#45](https://github.com/charlesroper/C64_music/issues/45), [#46](https://github.com/charlesroper/C64_music/issues/46) and [#47](https://github.com/charlesroper/C64_music/issues/47) delivered the rasteriser, prewarm, shell, loader and handoff. Commits [6062f73](https://github.com/charlesroper/C64_music/commit/6062f73), [76fc552](https://github.com/charlesroper/C64_music/commit/76fc552), [d3a25e0](https://github.com/charlesroper/C64_music/commit/d3a25e0) and [1c554b1](https://github.com/charlesroper/C64_music/commit/1c554b1) carry the implementation. WebKit 27.2 and Chromium 153 verified the full boot, gate, loader, handoff and mobile layout. Playwright screenshots are in `/sdcard/Download/tmp`. The suite is 86 checks across 12 files.

### 8 November 2026: Firefox telemetry pressure becomes visible

A Firefox capture reported `missed: 0` alongside `p99 3.02ms`, `max 6.00ms` and `telemetry drops: 721`. The missed counter only caught skipped 128-frame quanta. It could not see blocks that finished over the 2.67ms budget. With an 11.8ms output buffer, a 6ms block plus scheduling jitter can still cause the pops the listener heard.

Stats for Nerds now reports late blocks twice: a cumulative `lateQuanta` total and a `lateWindow` count for the current diagnostics window. The worklet telemetry pool rose from three buffers to six. Telemetry now runs at 30Hz by default and can be raised to 62.5Hz with the new Telemetry switch. Track-load and explicit telemetry requests bypass the divider so the monitor never stalls on a missing first snapshot. The overlay also reports the selected telemetry rate.

Tests cover the divider, forced load telemetry and the late-block counters. The suite is 86 checks across 12 files.

### 8 November 2026: 30Hz telemetry default reversed

Firefox still popped with telemetry at 30Hz. Halving snapshots reduced telemetry work, but it did not change the audio path or the 16ms worst-case `process()` blocks. It also updated the monitor and scopes at half the visual rate. The experiment did not earn its place as the default.

Telemetry now defaults to 62.5Hz again. The on-screen switch is hidden, and `?telemetry=30` keeps the lighter rate available for comparison. The six-buffer pool stays. This release also tests whether the larger pool, rather than the lower rate, was what removed the telemetry drops.

The Player Engine and Workbench View accept the initial rate from the URL. The hidden switch stays in sync so it can return when low power mode needs it. Tests cover the 62.5Hz default, the 30Hz opt-in, the hidden group and the Stats fallback. The suite is 86 checks across 12 files. Issue [#50](https://github.com/charlesroper/C64_music/issues/50) carries the change.

### 8 November 2026: Stats keeps the worst spike in view

Stats for Nerds reset its `max` and late-block count every 375 `process()` calls, about one second. A 16ms block on Firefox could disappear before the listener opened the overlay or took a screenshot. The panel also printed long text lines, so values wrapped below labels on a narrow phone. It showed no audio sub-phase or main-thread frame costs, which made a late block hard to attribute.

Every windowed diagnostic now keeps a session peak until reload, including across an Audio Mode restart. The Engine Core reports process, late, missed and telemetry-drop peaks, plus window maximum and session peak for `renderAudio`, `packTelemetry`, `postMessage` and `applyGain`. The Workbench View reports frame work p50, p95, max and peak over 60 rendered frames. No per-quantum allocation was added.

The overlay is now six colour-coded groups: Context, Latency, Process, Deadlines, Telemetry and Events. Each metric is one label/value unit with `white-space: nowrap`, and groups wrap whole units. Text titles and left borders keep colour from being the only cue. Events wrap within their value because state lists can be long.

The suite rose to 86 checks. Chromium 153 at 62.5Hz recorded `process peak 4.00ms`, `render peak 4.00ms`, `late peak 2`, `missed peak 32`, `drops peak 0` and `frame peak 21.80ms`. WebKit and Firefox captures at 390px showed six groups, 38 metric units, zero misaligned label/value pairs and no horizontal overflow. The Firefox UI capture recorded `frame peak 51.00ms` with its audio context suspended, so its process fields still wait for the manual phone run. Issue [#51](https://github.com/charlesroper/C64_music/issues/51) carries the change.

### 8 November 2026: boot appears before the workbench and fades into it

Firefox painted the workbench before the Boot Sequence overlay appeared. The body attribute that hides the workbench arrived only after the module booted. On a cold load the user saw a dashboard flash before the C64 screen. The boot overlay also popped away when it completed, so the workbench appeared in one frame.

The document now ships a static boot-pending state. The body hides the app shell from first paint, and the boot overlay is visible in the HTML rather than starting hidden. The Workbench View skips rendering work while the boot covers it. Normal gate completion starts audio, removes the boot-pending state, then fades the overlay out over 2.4 seconds with pointer events disabled. Skip and reduced motion use a static immediate mode that hides the boot overlay and reveals the workbench from first paint.

Tests cover the static first-paint state, the paused render loop, the fade path and both immediate paths. WebKit 27.2, Chromium 153 and Firefox cold-load checks confirmed the boot screen is first and the workbench fades in. The suite is 86 checks across 12 files. Issues [#52](https://github.com/charlesroper/C64_music/issues/52) and [#53](https://github.com/charlesroper/C64_music/issues/53) carry the change.

### 9 November 2026: the faded CRT stays in the monitor

The boot CRT collapsed to the workbench monitor, but the Web Animations API call used the default fill mode. When the collapse finished, the frame reverted to the inline start rect. The new crossfade then exposed the jump: the CRT moved back to its old centred position and size while the workbench faded in underneath.

The frame's base style now sits at the monitor rect before the animation starts. The keyframes still move it from the centred rect to the monitor, and it rests at the monitor for the whole fade. A regression assertion checks the frame width and height at fade start. Chromium sampling confirmed the frame moves from the centred rect at 40ms to an exact monitor match at 550ms. The suite remains at 86 checks across 12 files. Follow-up to [#53](https://github.com/charlesroper/C64_music/issues/53).

### 9 November 2026: Stats explains itself

Stats for Nerds had grown to 38 metrics across six groups. The labels were accurate but cryptic to anyone who did not know the engine. A `?` button now expands the compact panel into a scrollable, near full-screen guide. Every metric keeps its label and value and gains a plain-English description underneath. The guide opens with the difference between a window and a session peak, then explains late, missed and dropped work. Compact mode is unchanged.

The help text lives beside each metric definition, so a new metric cannot ship without a description. The button uses `aria-expanded` and changes its accessible name from Explain stats to Close stats explanation. Tests cover opening, closing, hiding, scroll reset and restoring compact mode, and every group and metric has a description. WebKit, Chromium and Firefox checks passed at 360px and 390px with no horizontal overflow. The suite rose to 86 checks across 12 files. Commit [184db62](https://github.com/charlesroper/C64_music/commit/184db62) and issue [#56](https://github.com/charlesroper/C64_music/issues/56) carry the change.

### 9 November 2026: Stats help gets a frosted header

The expanded Stats guide used a plain title row. When the guide scrolled, the content showed through the header and around its top edge. The `?` and `×` toggle was a rounded rectangle with the glyph sitting off centre.

The header is now flush with the top of the panel and stays sticky. The help panel fades its own background out behind the header, so the header is a true translucent layer over the workbench: `rgba(4, 8, 12, 0.56)` over `blur(18px)`, with a hairline divider. The body below stays dark for readability. The toggle is a 36px circle with the glyph flex-centred. Compact mode is unchanged. WebKit, Chromium and Firefox checks show the header one pixel inside the panel border, a 36px circle and a centred glyph. The suite remains at 86 checks across 12 files. Commits [236a462](https://github.com/charlesroper/C64_music/commit/236a462) and [ce7e3ba](https://github.com/charlesroper/C64_music/commit/ce7e3ba) and issue [#56](https://github.com/charlesroper/C64_music/issues/56) carry the change.

### 9 November 2026: low power mode trades presentation for headroom

The workbench rendered at up to 60fps and could animate the source viewer while the music played. On a low-end phone, that presentation work competes with the audio thread. The app now has an opt-in LOW POWER switch beside AUDIO MODE.

Low power caps the workbench and scopes at 30fps, stops smooth source auto-scroll while playing, removes logo sparkle and CRT scanlines and lowers telemetry to 30Hz. Turning it off restores the base telemetry rate and effects. The Engine Core, SID emulation and audio worklet path are untouched. It is never enabled automatically.

Tests cover the default-off switch, the 30fps frame cap and 60fps restore, telemetry rate and restore, sparkle suppression and scanline control. Chromium recorded 62 monitor draws per second off, 30 on and 62 restored. `late window` stayed at 5/375 for the first two samples and fell to 2/375 after restore, `late peak` stayed at 5, the slowest audio callback stayed around 5 to 6ms and `frame peak` stayed at 28.60ms. WebKit confirmed the toggle, telemetry rate, scanline state and sparkle state. The suite rose to 86 checks across 12 files. Commit [f2fd2c0](https://github.com/charlesroper/C64_music/commit/f2fd2c0) and issue [#54](https://github.com/charlesroper/C64_music/issues/54) carry the change.

### 9 November 2026: Stats values show their health

Every Stats value used the same text colour. A 37ms process peak, a 92ms frame peak and a 12.8ms output buffer looked like ordinary readings unless the listener knew the thresholds. The overlay now colours each value green for normal, amber for under pressure and red for bad. A dot before the value repeats the state, so colour is not the only cue. Group titles keep their existing category colours and the help guide gains a three-state legend.

Thresholds cover callback percentiles, session peaks, telemetry pack and post times, gain ramps, main-thread frame work, deadline counts, telemetry drops, output latency, context state and audio backend. Cumulative totals stay neutral because they mix old and current events. Values without a defined threshold also stay neutral.

Tests assert the three states, the legend, the Firefox 12.8ms output buffer as bad and neutral cumulative totals. The suite rose to 88 checks across 12 files. Commit [a5d1a70](https://github.com/charlesroper/C64_music/commit/a5d1a70) and issue [#57](https://github.com/charlesroper/C64_music/issues/57) carry the change.

### 9 November 2026: telemetry can be stopped at the source

Telemetry snapshots ran whenever audio played. The low power mode lowered the rate to 30Hz but still sent snapshots, so there was no way to remove the audio-thread handoff for a music-only mode or an isolation capture.

The Player Engine now has an explicit telemetry enable and disable path. The Engine Core skips snapshot construction while telemetry is disabled, and the AudioWorklet processor drops any outgoing snapshot. Audio diagnostics keep flowing and the existing buffer pool stays in place. Stats shows `OFF` for the telemetry rate. `?telemetry=off` starts with snapshots disabled and locked, so opening Stats cannot re-enable them. The default 62.5Hz rate and `?telemetry=30` are unchanged.

Tests cover the worklet gate, Player Engine state, the locked override, Stats `OFF` and URL parsing. The suite rose to 94 checks across 12 files. Commit [132ac8d](https://github.com/charlesroper/C64_music/commit/132ac8d), follow-up [47c4c08](https://github.com/charlesroper/C64_music/commit/47c4c08) and issue [#62](https://github.com/charlesroper/C64_music/issues/62) carry the change.

### 9 November 2026: minimal render isolates presentation work

The Firefox audio isolation captures needed a way to remove presentation work without entering a product mode. The workbench can now be loaded with `?render=minimal`. The flag hides the centre and right panels, including the SID register strip, collapses the grid to one column, hides the mobile tabs and pauses the workbench render loop. The transport and track list stay usable. The LOW POWER switch stays off, and music-only mode remains separate.

The paused loop covers the boot handoff: boot completion clears its own pause flag but the minimal render guard still stops frames. The CSS keeps the track list visible even when a mobile tab would normally hide it.

Tests cover the flag, the `render-minimal` body class, the paused loop, track switching, the absence of the `low-power` class and phone-width CSS hiding. A headless Chromium 153 check at 375x812 found the centre, right, SID strip and tab elements hidden, the left panel visible and a 368px scroll width inside a 375px viewport. The suite rose to 97 checks across 12 files. Commit [b84b796](https://github.com/charlesroper/C64_music/commit/b84b796), follow-up [3810c23](https://github.com/charlesroper/C64_music/commit/3810c23) and issue [#63](https://github.com/charlesroper/C64_music/issues/63) carry the change.

### 9 November 2026: the minimal render check becomes repeatable

The minimal render phone-width check was a one-off manual run. `npm run check:minimal-render` now launches the pinned Chromium 153 headless shell at 360px and 390px, opens `?render=minimal`, and asserts the centre panel, right panel, SID strip and mobile tabs are hidden, the track list has rows and `scrollWidth` does not exceed `innerWidth`.

The script starts a local static server and uses the DevTools protocol, with no new dependencies. The browser verification guide records the command and expected output. Tests also cover the same state in the harness. The suite is 98 checks across 12 files. Commit [02d0dd8](https://github.com/charlesroper/C64_music/commit/02d0dd8) and issue [#72](https://github.com/charlesroper/C64_music/issues/72) carry the change.

### 9 November 2026: debug latency hints reach the context

The latency URL accepted only `interactive`. The Firefox isolation matrix needs `playback`, `balanced`, `interactive`, `0.1` and `0.2`, and the value has to reach the AudioContext without adding another switch to the header.

A latency hint policy now accepts those five values and falls back to `playback` for anything else. The chosen hint reaches the AudioContext constructor and appears in Stats, including numeric values. The Audio Mode switch stays limited to playback and interactive, and no permanent latency UI is added.

Tests cover parsing, fallback, context creation, URL boot and Stats display. The suite rose to 102 checks across 12 files. Commit [ece3c5d](https://github.com/charlesroper/C64_music/commit/ece3c5d) and issue [#64](https://github.com/charlesroper/C64_music/issues/64) carry the change.
