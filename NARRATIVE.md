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

### Browser audio (`src/player_engine.js`)

The player picks up the audio hardware's sample rate (44.1kHz or 48kHz) and tells the emulator. On phones, it unlocks audio inside the first tap, because browsers block sound otherwise. It also keeps the Web Audio processing node fed with a silent looping buffer, which some WebKit browsers need to keep running.

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

`npm test` runs 23 automated checks across four test files:

* **Pitch.** Fourier analysis confirms that generated tones match the datasheet pitch formula at 44.1kHz and 48kHz, in PAL and NTSC.
* **Catalogue.** All 73 tunes and sound effects across the six source files render audio without invalid values, clipping or a stuck output level.
* **Metadata.** All 73 tracks carry non-empty descriptions, valid duration hints, authentic keys and unique identifiers.
* **Drums.** The `$D418` drum routines produce sound, and the volume control for them works.
* **Mobile and audio unlock.** The page loads, unlocks audio on the first tap even during asset download, and starts playback cleanly.
* **Versioning and deployment.** The CalVer release identifier renders beside the title in both the header and document head, validated against same-day increments (`scripts/bump_version.mjs`), with automated deployments pushed directly to GitHub Pages (`scripts/deploy.mjs`).
* **Code style.** Biome checks JavaScript, JSON, CSS and HTML before every deployment. The first formatting pass sits in its own commit, recorded in `.git-blame-ignore-revs`, so history stays readable.
* **Responsive layouts.** The interface scrolls vertically and sizes elements correctly across mobile (375x812) and laptop (1024x768, 1100x700) viewports.
* **Character ROM and logo.** All 256 character codes produce authentic 8x8 glyphs with readable letters and punctuation, and the white Galway 2664 brand logo sparkles through valid VIC-II colours.
* **Telemetry and controls.** Section 4 telemetry values render with tabular numbers to prevent jitter, control checkboxes synchronise on boot with Follow Voice off by default, interactive chips select the voice to follow, and the bottom SID register strip groups voices responsively with active sound lights.
* **Smooth code tracking.** The assembly viewer uses adaptive requestAnimationFrame timing to follow fast 16th notes without lag, pre-positions large leaps near their targets and yields immediately on user gestures.
* **Source editor safety.** Reassembly surfaces syntax errors in the status badge and preserves text, and unsaved edits survive track changes.
* **Modal keyboard isolation.** Keyboard shortcuts ignore modal dialogs and preserve native button activation.
* **Track-aware drum following.** Drum sequencer tracking enables only on songs with percussion, reads through the seqPC symbol, and preserves user follow state across track switches.
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
