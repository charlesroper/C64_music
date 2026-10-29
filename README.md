# Martin Galway's C64 Music: Audio Workbench and Assembly Sources

[Live Web Player](https://charlesroper.github.io/C64_music/) | [The Story: History, Architecture and Assembly](NARRATIVE.md) | [Martin Galway's Original Repository](https://github.com/MartinGalway/C64_music)

This repository contains Martin Galway's original Commodore 64 audio driver assembly source code from Ocean Software (1985 to 1987), together with an interactive web player and live in-browser cross-assembler.

Instead of playing pre-recorded audio files, the web application compiles Galway's raw 6502 source text in your browser and executes it clock by clock inside a custom WebAssembly emulation core. You can listen to all 73 catalogued tracks and sound effects, inspect hardware telemetry and oscilloscopes, trace Galway's program counter through the score in real time, and edit and reassemble the original code.

For the full story of Galway's technical innovations, the historical context, and the architecture behind the emulation, read [NARRATIVE.md](NARRATIVE.md) or click **THE STORY** in the web interface.

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
* `arkadrum.asm` (January 1987): Real-time algorithmic drum synthesis output through the SID master volume register (`$D418`).
* `gameover.asm` (July 1987): Rock drum accompaniment streamed from 4-bit digitized PCM samples.
* `greenberet.asm` (November 1985): Arcade conversion title theme and loading jingles.
* `rambload.asm` (November 1985): The loader music featuring Galway's secret Morse code transmitter broadcasting the development team's names.
* `ocean_assembler_directives.txt`: Galway's notes explaining the syntax and directives used by Ocean's in-house 6502 cross-assembler (`DFS`, `DFB`, `DFW`, `DFM`, `ADD`, `SUB`, `EQU`).

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

The test suite validates pitch accuracy, audio waveform stability, drum synthesis, mobile layouts, and narrative factual fidelity. It runs on Node.js using its built-in test runner (`node:test`) and requires zero external dependencies.

Run the test suite from the repository root:
```bash
npm test
```

The test runner executes 12 automated checks across four test files:
* `tests/player_audio_and_pitch.test.mjs`: Uses Hann-windowed Discrete Fourier Transforms (DFT) to confirm that synthesized tones match the MOS 6581 datasheet pitch formula across 44.1kHz, 48kHz, PAL and NTSC configurations. Verifies that all 73 catalogued tracks and sound effects produce valid alternating current (AC) output without clipping or DC lock. Tests `$D418` algorithmic and sampled drum synthesis.
* `tests/spa_boot_and_play.test.mjs`: Tests AudioContext gesture unlocks and verifies that audio starts cleanly even when playback is triggered before assets finish downloading.
* `tests/mobile_ui_layout.test.mjs`: Evaluates the CSS media-query cascade across desktop and mobile viewports, verifying vertical scrolling, touch target dimensions (>= 36px), and single-column layout transitions.
* `tests/narrative.test.mjs`: Validates the custom markdown renderer, confirms that all quotations in [NARRATIVE.md](NARRATIVE.md) match Galway's sources verbatim, and checks cited line numbers and equates against the original assembly files.

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

The application is structured into four focused layers:

1. **In-browser cross-assembler (`src/ocean_assembler.js`)**: A JavaScript assembler that parses Galway's raw source text, handles Ocean's custom directives (`DFS`, `DFB`, `DFW`, `DFM`, `ADD`, `SUB`, `EQU`), performs two-pass symbol resolution, and generates a binary memory image along with line-to-address source maps in under 20 milliseconds.
2. **Cycle-accurate emulation core (`src/wasm/c64_engine.c`)**: A freestanding C core compiled to WebAssembly that emulates the MOS 6510 CPU, VIC-II raster timer (63 cycles per line on PAL, 65 on NTSC), and the MOS 6581/8580 SID synthesizer. It includes a 2x-oversampled Chamberlin state-variable filter, a 15Hz high-pass AC-coupling filter matching the C64 motherboard output capacitor, and a cubic soft saturation curve (`soft_saturate`) to prevent harsh clipping.
3. **Web Audio driver (`src/player_engine.js`)**: Coordinates audio sample rate negotiation (44.1kHz or 48kHz), synchronizes the WebAssembly clock divider, routes stereo audio through a ScriptProcessorNode with a silent looping buffer, and manages mobile WebKit autoplay unlocks.
4. **Studio workbench interface (`src/app.js`, `src/styles.css`, `index.html`)**: Provides the CRT memory display (`$0400`), border profiler raster bars (`$D020`), 4-channel oscilloscopes, live code disassembly tracking voice program counters (`PC0` to `PC2`), and the in-app narrative modal overlay rendered by `src/markdown.js`.

---

## License and credits

* **Original music and 6502 assembly code**: Copyright (C) Martin Galway. Preserved and published under fair reference and educational study.
* **Web emulator, assembler, and workbench interface**: MIT License. See [LICENSE](LICENSE) for details.
