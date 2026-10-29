# Martin Galway's C64 Audio: History, Architecture and Assembly

[Repository](https://github.com/charlesroper/C64_music) | [Martin Galway's Original Source Code](https://github.com/MartinGalway/C64_music) | [Live Web Player](https://charlesroper.github.io/C64_music/)

---

## 1. What this project is

This project is an interactive web player for Martin Galway's Commodore 64 game music, built directly from his original 1985 to 1987 assembly language source code.

Instead of playing recorded audio files such as MP3s, the web application runs Galway's original 6502 code in your browser. It assembles the text files on the fly and executes them inside a software simulation of the Commodore 64 hardware.

The project was put together through vibe coding, pairing human listening and direction with Google's Gemini models (Argon and Flash) inside the Antigravity development environment. The AI assisted with reverse-engineering the assembly directives, writing the WebAssembly sound core in C, and tuning the emulated analogue filters against the original hardware behaviour.

---

## 2. Martin Galway and the Commodore 64

In the mid-1980s, Martin Galway composed music for Ocean Software in Manchester. His soundtracks for games such as Wizball, Arkanoid, Rambo: First Blood Part II, Green Beret and Game Over became benchmarks for what 8-bit home computers could achieve.

The Commodore 64 relied on the MOS 6581 Sound Interface Device (SID), designed by Bob Yannes in 1981. The chip had three sound channels and an analogue filter. It did not have digital sample playback, musical instrument software or graphical audio tools.

Composing for the machine meant writing assembly code by hand. Musicians calculated numerical pitch values, programmed hardware registers directly, and timed musical events against the computer's television raster beam. Audio routines had to share the processor with the game itself, fitting into a few kilobytes of memory without slowing down graphic updates.

In 2026, Galway released his original assembly source files to the public:
* `wizball.asm` (April 1987).
* `arkanoid.asm` (February 1987).
* `arkadrum.asm` (January 1987).
* `gameover.asm` (July 1987).
* `greenberet.asm` (November 1985).
* `rambload.asm` (November 1985).
* `ocean_assembler_directives.txt` (Galway's notes on Ocean's in-house assembler).

---

## 3. The workbench interface

The web application reconstructs Galway's development setup through five connected components:

1. **In-browser cross-assembler**: Compiles Galway's raw source text into 6502 machine code directly in the browser within 20 milliseconds, resolving Ocean Software's custom directives.
2. **Cycle-accurate emulator**: Written in C and compiled to WebAssembly, this simulates the MOS 6510 processor, VIC-II video chip timing, and the MOS 6581 sound chip clock by clock.
3. **CRT telemetry screen**: Recreates the Commodore 64 memory display at `$0400` in the computer's original text font, framed by border raster bars (`$D020`) that show processor usage.
4. **Hardware oscilloscopes**: Four live oscilloscopes track the three sound channels and the global filter or digital-to-analogue converter, displaying pitch, envelope, and waveform states.
5. **Live source viewer and editor**: Shows the assembly source as it plays, with indicators following each voice's position in the score. The code can be edited and reassembled in real time.

---

## 4. Galway's technical innovations

Examining the source code reveals several practical solutions to the Commodore 64's hardware constraints.

### The 200 Hz fractional raster clock
Most Commodore 64 music routines were tied to the European PAL television refresh rate of 50 Hz, running once every 20 milliseconds. This frame rate limited the speed of note transitions and arpeggios.

In `wizball.asm` (lines 608 to 624), Galway used a routine named `DREFRESH` that polled the video chip's scanline counter (`$D011` and `$D012`) at four points during each frame:
* Line 32.
* Line 110 (78 lines later).
* Line 188 (78 lines later).
* Line 266 (78 lines later, line 10 with the high bit set in `$D011`).

This produced four update ticks per frame, running the audio driver at 200 Hz.

To manage tempo changes across tracks, Galway implemented a 16-bit fractional accumulator in `WAITCLOCKb`:
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
On each 200 Hz tick, the 16-bit speed word `Refsp` is added to `CREFSP`. The audio routine updates only when the high byte changes:
* `Refsp = $0100`: Updates on every tick (200 Hz), used for the fast tempo of the Wizball title track.
* `Refsp = $0080`: Updates every two ticks (100 Hz), used in Arkanoid.
* `Refsp = $0040`: Updates every four ticks (50 Hz), used in Filth Raid.
* `Refsp = $0001`: Slow-motion inspection mode, which Galway mapped to the asterisk key on his keyboard.

In the Wizball title track, routine `TS00` plays four-note arpeggios with note durations as short as six ticks (30 milliseconds per note).

### Digital drums on an analogue chip
The MOS 6581 sound chip did not support sampled audio playback. It provided only three analogue synthesis channels with triangle, sawtooth, pulse and noise waveforms.

Galway added percussion by repurposing the chip's master volume register at `$D418`. Bits 0 to 3 control global volume in 16 steps (0 to 15). By writing values to these bits at audio frequencies, the volume control functioned as an informal 4-bit digital-to-analogue converter (DAC).

Galway used two approaches:
1. **Algorithmic synthesis (`arkadrum.asm`)**: In Arkanoid, while a 50 Hz interrupt handled melodic voices, the main execution loop continuously called `PLEY`. This routine generated drum waveforms mathematically in processor registers and sent the values to `$D418`.
2. **Sampled 4-bit audio (`gameover.asm`)**: In Game Over, Galway stored digitized recordings of bass drums, snares and cowbells in memory. Each byte contained two 4-bit samples. The playback driver unpacked the upper nibble, wrote it to `$D418`, delayed for a calculated number of processor cycles, unpacked the lower nibble, and wrote that to `$D418`.

### The secret Morse code transmitter in Rambo: First Blood Part II
In `rambload.asm` (lines 1232 to 1258), the loading music contains a routine named `STARTMC`:
```assembly
STARTMC        LDA #$A0:STA $D406       ; Voice 1 Attack/Decay
               LDX #$4B:STX $D400       ; Voice 1 Frequency Lo ($4B)
               LDY #$22:STY $D401       ; Voice 1 Frequency Hi ($22) -> 515.6 Hz
               LDX #MCREFR              ; Point music refresh vector
               LDY ^MCREFR              ; to Morse code handler
               STX MUS+1
               STY MUS+2
```
About one second into the track, Channel 0 redirects execution to this handler. Voice 1 is set to an unfiltered sawtooth wave at 515.6 Hz (PAL) or 535.2 Hz (NTSC). It reads a character table at `Secret`:
```assembly
Secret         DFB 2*"B",2*"I",2*"L",2*"L"
               DFB 2*"B",2*"A",2*"R",2*"N"
               DFB 2*"A"
               DFB 2*"D",2*"A",2*"V",2*"I"
               DFB 2*"D",2*"C",2*"O",2*"L"
               DFB 2*"L",2*"I",2*"E",2*"R"
               DFB 2*"M",2*"A",2*"R",2*"T"
               DFB 2*"I",2*"N",2*"G",2*"A"
               DFB 2*"L",2*"W",2*"A",2*"Y"
               DFB 2*"T",2*"O",2*"N",2*"Y"
               DFB 2*"P",2*"O",2*"M",2*"F"
               DFB 2*"R",2*"E",2*"T"
               DFB 2*"S",2*"T",2*"E",2*"V"
               DFB 2*"E",2*"W",2*"A",2*"H"
               DFB 2*"I",2*"D"
               DFB 0
```
This spells out the development team:
`BILL BARNA, DAVID COLLIER, MARTIN GALWAY, TONY POMFRET, STEVE WAHID`

The routine converts the letters into dits and dahs using a compact lookup table (`CodeTab`), transmitting the credits in Morse code over the music before restoring normal playback.

### Border raster bars ($D020) and memory telemetry ($0400)
To monitor processor load without debugging hardware, Galway used the screen border as an execution timer.

In `wizball.asm` (lines 580 to 594):
```assembly
REFRESH        PHP 
               INC ClkAdd
               PLP 
               BEQ xit
               INC BDR          ; Increment $D020 (white border)
               JSR FILTER
               ... (music code) ...
xit            DEC BDR          ; Decrement $D020 (black border)
               RTS 
```
Changing the border color to white at the start of the music routine and resetting it to black at the end produced a visible horizontal band on the television screen. The height of this band showed how many scanlines the sound driver consumed.

Galway also directed telemetry data to screen memory at `$0400` (lines 750 to 840):
* Row 0: Program counters (`PC0` to `PC2`), channel clocks (`CLOCK0` to `CLOCK2`), and speed registers.
* Row 1: Running time in minutes, seconds, and frames (`00-57-12`).
* Rows 3, 6, 9: Channel datablocks (`D0`, `D1`, `D2`).
* Rows 15, 17, 19: Instrument soundblocks (`S0`, `S1`, `S2`).
* Rows 12, 21: Filter envelopes and cutoff values.

In `wizball.asm` (line 418), Galway configured the display color:
```assembly
DREFCOLOUR     EQU 15 ; Desired colour for display refreshes
```
Color 15 is light grey on the Commodore 64, against a black background (color 0). The monitor interface reflects this monochrome choice.

### Bytecode virtual machine
Galway encoded musical scores as a stream of bytecode instructions rather than raw note lists. Each sound channel had a 16-bit program counter (`PC0` to `PC2`):
* Bytes below `$C0`: Note pitches, with bit `$60` selecting whether the duration was stored in the byte or looked up from a rhythm table.
* Bytes from `$C0` upward: Commands dispatched through tables `vt0` to `vt2`:
  * `For` and `Next`: Looping constructs for repeating phrases.
  * `Call` and `Ret`: Reusable musical subroutines.
  * `FLoad` and `Freq`: Instrument envelope and vibrato table assignments.
  * `Filter`: Dynamic cutoff and resonance changes.
  * `Code`: Direct jumps to arbitrary 6502 assembly routines, such as the Morse code handler.

---

## 5. Architecture and web implementation

Running Galway's 1980s source code in a modern browser required three distinct layers:

### 1. In-browser cross-assembler (`src/ocean_assembler.js`)
The assembler compiles Galway's source files in JavaScript without external dependencies. It supports the directives documented in `ocean_assembler_directives.txt`:
* `ORG` and `ENT`: Memory placement and execution entry addresses.
* `DFS`: Space allocation, with optional fill bytes (`DFS 24, $DD`).
* `DFB`, `DFW`, `DFL`, `DFH`: Byte, word, low-byte and high-byte data declarations.
* `DFM`: PETSCII character string definitions.
* `ADD` and `SUB`: Ocean shorthand combining `CLC`/`ADC` and `SEC`/`SBC`.
* `EQU`: Label equates and arithmetic expressions.

The assembler runs a two-pass symbol resolution, generating memory images and line-to-address maps in under 20 milliseconds.

### 2. WebAssembly emulation core (`src/wasm/c64_engine.c`)
The emulation engine is written in C and compiled to a 25 KB WebAssembly binary:
* **MOS 6510 CPU**: Full instruction decoding with exact cycle counts, decimal mode arithmetic, and undocumented opcodes required by Galway's drivers (such as `$2C` bit test skips).
* **VIC-II raster timing**: Raster counter updates running at 63 cycles per line (PAL) or 65 cycles per line (NTSC).
* **MOS 6581/8580 sound generator**: 24-bit phase accumulators, logarithmic ADSR envelope generators, 23-bit Galois noise shift registers, and combined waveform models.

### 3. Analogue filter and motherboard modeling
The MOS 6581 filter had non-linear characteristics resulting from field-effect transistor (FET) resistance. The WebAssembly engine uses a 2x-oversampled Chamberlin state-variable filter to approximate these curves.

Narrow-pulse waveforms (such as those in the Wizball weapon selection sound) generate significant direct current (DC) offset. On a physical Commodore 64, the audio signal passes from pin 27 of the SID through an electrolytic capacitor (`C13`, 10 microfarads) before reaching the output jack. The engine models this 15 Hz high-pass filter, followed by a soft cubic saturation curve (`soft_saturate`) to prevent harsh clipping during resonant filter sweeps.

### 4. Web Audio and responsive interface
* **AudioContext compatibility**: Supports both 44.1 kHz and 48 kHz hardware sample rates, adjusting the WebAssembly clock divider through `wasm_set_sample_rate()`.
* **Mobile audio initialization**: Manages mobile browser autoplay restrictions by unlocking audio on user gestures before external assets finish downloading.
* **Layout**: Adapts between a desktop three-column layout and a single-column mobile view with accessible touch targets and dedicated panel switching.

---

## 6. Galway's source comments

Galway's source files contain informal comments that illustrate his working methods and humor.

From `ocean_assembler_directives.txt`:
> *"DFM: 'Define Message'. This is where you would put text into your program like 'Hello Mum' or 'I Love Gary Bracey.' Or something more useful & relevant to your program lol."*
>
> *"ADD: Packages a CLC with an ADC to save you some typing."*
>
> *"SUB: Packages an SEC with an SBC to save you some typing."*
>
> *"$DD: a common random/magic number I used which would not crop up as a result of code running... so I could assume it was untouched RAM."*

From `wizball.asm`:
> *"GAP EQU 15*512-SIZE ; I've currently got 7.5K to play with."*
>
> *";^^^^^^^^^^^^^^^ This is the end of the source file... (or is it?) ^^^^^^^^^^^^"*

From `gameover.asm`:
> *"Design, code, music & arrangements by Martin Galway. (C) MARTIN GALWAY 18:15 Thursday 9th July 1987."*

---

## 7. Automated test suite

The engine is verified through Node.js test suites (`npm test`):
* **Pitch accuracy**: Hann-windowed Discrete Fourier Transform (DFT) tests verify that generated frequencies match MOS 6581 specifications across 44.1 kHz, 48 kHz, PAL and NTSC configurations.
* **Catalog verification**: All 73 tracks and sound effects across the six source files are tested for valid alternating current (AC) output and bounded amplitudes.
* **Interface layout**: Tests verify that mobile styles maintain touch targets, allow vertical scrolling, and arrange the hardware controls cleanly.
