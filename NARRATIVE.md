# Galway 2664: history, architecture and source code

[This repository](https://github.com/charlesroper/C64_music) | [Martin Galway's original source](https://github.com/MartinGalway/C64_music) | [Live player](https://charlesroper.github.io/C64_music/)

---

## 1. What this project is

Galway 2664 is a web workbench for Martin Galway's Commodore 64 game music. The name nods to Martin Galway releasing his source code on GitHub in 2026 and writing the music for the Commodore 64, echoing four-digit chip numbers like the MOS 6502 processor and 6581 SID. It is built from the source code he wrote for Ocean Software in 1985 to 1987.

The player does not play recordings. Galway wrote his music as program text for the Commodore 64's processor. This player turns that text into machine code in your browser, then runs it on a software copy of the computer's processor and sound chip. What you hear is the original program making the sound.

Galway published the source files in 2026. They include the music and sound effects for Wizball, Arkanoid, Rambo: First Blood Part II, Green Beret and Game Over, plus his notes on the assembler Ocean used.

This page describes what he built and how the player works. The first sections need no technical background. The later ones go into the code.

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

* **Header, logo and version.** The top banner displays the white Galway 2664 logo rendered with authentic Commodore 64 PETSCII character ROM glyphs, featuring a retro light reflection sparkle cycling valid VIC-II colours, the WebAssembly engine status light, and the subtle CalVer release pill, formatted cleanly across desktop and mobile screens.
* **Tune list and transport controls.** Choose a tune, pause, restart or fast-forward.
* **Oscilloscopes.** Live traces for the three voices and the master volume channel.
* **Monitor.** A copy of the text display that Galway's program draws into screen memory, rendered with authentic C64 character glyphs and a border that shows processor load.
* **Source viewer.** Galway's assembly source, with markers that follow each voice through the score using adaptive smooth scrolling that keeps pace with fast 16th notes and eases large leaps without lagging. Interactive chips let you select which voice (V1, V2, V3, or DRM) to follow in real time with an optional Follow Voice toggle. For hybrid pieces like Arkanoid Digi-Drums, selecting DRM tracks the drum sequencer in arkadrum.asm while selecting voices switches to arkanoid.asm. At the bottom, a responsive SID register strip ($D400-$D418) displays live hex values in four color-coded voice and filter groups that illuminate when voices sound. You can also edit the source and rerun it.
* **Hardware options.** Switch between the two SID chip models, PAL and NTSC timing, and the strength of the drum sounds.

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

At the start of its music update, `REFRESH` in `wizball.asm` increments the border colour register, `BDR` (`$D020`). At the end it decrements it:

```assembly
REFRESH        PHP
               INC ClkAdd
               PLP
               BEQ xit
               INC BDR
               JSR FILTER
xit            DEC BDR
               RTS
```

The listing omits the voice routines between `JSR FILTER` and `xit`. While the music code runs, the border has a different colour, so the height of that band on screen is proportional to the time spent. The same program writes status text, such as voice pointers, clocks and filter values, into screen memory at `$0400`.

`DREFCOLOUR EQU 15` in `wizball.asm` (line 418) sets that display to light grey on black, which is why the Wizball monitor in this player is grey. The Arkanoid and Game Over files set `DREFCOLOUR` to 0.

### A bytecode score

Each voice has a 16-bit pointer (`PC0`, `PC1`, `PC2`) into its own score. Values from `$C0` (`COM`) upward are commands, dispatched through the jump tables `vt0`, `vt1` and `vt2`. Lower values are notes, with `$5F` (`Rest`) as a rest. The commands, defined as offsets from `COM` in `wizball.asm`, include:

* `Call` and `Ret` for reusable phrases.
* `For` and `Next` for loops.
* `Filter` for the SID filter.
* `Code` for a jump to arbitrary machine code, as the Morse routine uses.
* Others, such as `FLoad`, `Freq`, `Transp` and `Master`, which this page does not describe.

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
* **Laptop and tablet.** On medium-width screens (821px to 1200px) or shorter viewports, the monitor and tune controls sit side by side while the assembly source spans the full width below, preserving natural vertical scrolling.
* **Mobile.** On narrow screens, a single column provides dedicated tabs for the monitor, tunes and source, with the brand header neatly framing the Galway 2664 logo and version.
* **Adaptive code viewer.** Assembly tracking uses requestAnimationFrame interpolation tailored to step distance: 90ms ease-out curves track rapid 16th notes cleanly without lag, while large jumps across hundreds of lines pre-position near the target and ease the final 40 pixels over 70ms to prevent visual disorientation. Touch or mouse scrolling instantly cancels active transitions.
* **Character display and logo.** Screen memory at `$0400` and the Galway 2664 header logo render with authentic 8x8 glyphs for all 256 PETSCII characters (`src/c64_charset.js`), supporting both uppercase and lowercase text. The white logo glints with a retro light sparkle effect cycling valid Commodore 64 palette colours on click or every 10 seconds.

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

The player was built by vibe coding with Gemini (Argon and Flash) in Google's Antigravity, with a human listening, testing on a phone and directing changes. The assembler, emulator and interface were written that way. Errors are likely, and corrections are welcome.

`npm test` runs 20 automated checks across four test files:

* **Pitch.** Fourier analysis confirms that generated tones match the datasheet pitch formula at 44.1kHz and 48kHz, in PAL and NTSC.
* **Catalogue.** All 73 tunes and sound effects across the six source files render audio without invalid values, clipping or a stuck output level.
* **Metadata.** All 73 tracks carry non-empty descriptions, valid duration hints, authentic keys and unique identifiers.
* **Drums.** The `$D418` drum routines produce sound, and the volume control for them works.
* **Mobile and audio unlock.** The page loads, unlocks audio on the first tap even during asset download, and starts playback cleanly.
* **Versioning and deployment.** The CalVer release identifier renders beside the title in both the header and document head, validated against same-day increments (`scripts/bump_version.mjs`), with automated deployments pushed directly to GitHub Pages (`scripts/deploy.mjs`).
* **Responsive layouts.** The interface maintains vertical scrolling and proper element sizing across mobile (375x812) and laptop (1024x768, 1100x700) viewports.
* **Character ROM and logo.** All 256 character codes produce authentic 8x8 glyphs with readable letters and punctuation, and the white Galway 2664 brand logo features a retro reflection sparkle cycling valid VIC-II colours.
* **Telemetry and controls.** Section 4 telemetry values render with tabular numbers to prevent jitter, control checkboxes synchronize on boot with Follow Voice off by default, interactive chips select the voice to follow, and the bottom SID register strip groups voices responsively with active sound lights.
* **Smooth code tracking.** The assembly viewer uses adaptive requestAnimationFrame timing to follow fast 16th notes without lag, pre-positions large leaps near destination targets, and yields immediately on user gestures.
* **Factual fidelity.** All quotations and technical references match Galway's original source files and equates verbatim.

These checks show that the player behaves consistently. They do not prove it is identical to a real Commodore 64.
