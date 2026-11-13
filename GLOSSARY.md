# Galway 2664 Domain Glossary

Commodore 64 6502-SID music workbench and live assembly player for Martin Galway's Ocean Software audio routines (1985-87).

## Core Concepts

**Player Engine**:
The main-thread module that assembles Galway's 6502 routines, owns Audio Mode resolution and browser audio lifecycle, holds playback and hardware state and sends commands to the Engine Core.
_Avoid_: Audio service, emulator backend

**Engine Core**:
The module that owns the WebAssembly emulator, runs Loader Adapters, renders audio, and fills Telemetry Snapshots, either on the real-time audio thread or in-thread for tests.
_Avoid_: Worklet engine, audio backend, processor

**Track Load**:
The act of resetting the emulator and running a Loader Adapter for a new track, during which the emulator clock is frozen and the tune starts at frame 0 once it completes.
_Avoid_: Track switch, game change, reload

**Telemetry Snapshot**:
A reusable, pre-allocated snapshot of Commodore 64 engine state refreshed on each frame, containing cycle counts, program counter locations, SID registers, voice channels, filter state, oscilloscope buffers, and screen RAM.
_Avoid_: Frame state, telemetry DTO, debug data

**Session Peak**:
The worst value seen for a windowed diagnostic since the page loaded. It survives diagnostics windows and audio-context restarts until reload.
_Avoid_: all-time max, historical maximum

**Frame Work**:
The main-thread time spent inside one rendered Workbench View frame, from telemetry fetch through canvas and DOM updates.
_Avoid_: frame time, render time

**Workbench View**:
The presentation layer responsible for rendering oscilloscope canvases, the PETSCII CRT monitor, assembly source line tracking, and interactive controls without direct knowledge of emulator ABI internals.
_Avoid_: UI container, frontend app

**Track Session**:
A track configuration descriptor defining the active game, tune, source file, drum routine availability, and program counter symbols.
_Avoid_: Song selection, track model

**Boot Sequence**:
The full-screen CRT startup that simulates a Commodore 64 power-on, BASIC screen and tape load before handing off to the workbench with a named Load Target.
_Avoid_: Intro, splash screen, loading overlay

**Boot Pending State**:
The static document state that hides the app shell and shows the Boot Sequence before module execution.
_Avoid_: loading state, splash flag

**Load Target**:
The Galway software selected by the Boot Sequence. Wizball is the only target exposed in the first version.
_Avoid_: Boot game, startup track

**Press Play Gate**:
The user gesture in the Boot Sequence that unlocks browser audio and starts the tape load.
_Avoid_: Autoplay prompt, start button

**Loader Adapter**:
A dedicated game-specific loader function responsible for initializing Commodore 64 memory, custom raster routines, jump tables, and CPU registers for one Galway audio routine before driver execution begins.
_Avoid_: Boot branch, track init script

**Source Index**:
An index structure bound to an assembled source module providing O(1) address-to-line resolution, symbol-to-line location, and text search across original assembly source lines.
_Avoid_: Line lookup table, symbol resolver

**Idle Render Path**:
The presentation loop guard that bypasses C64 monitor pixel transfers, oscilloscope drawing, and telemetry DOM writes when playback is paused, the document is backgrounded, or the Boot Sequence covers the workbench, while capping unthrottled display refresh at 60 Hz.
_Avoid_: Tick stopper, frame skipper

**Output Latency**:
The total delay between the app producing a sound and the speaker playing it, reported as `out` in Stats. It includes browser and device buffering.
_Avoid_: Buffer size, callback time

**Callback Buffer**:
The queue of audio the browser keeps ready so the audio thread can recover from a short delay without an audible gap. A small buffer lowers delay but can pop. A large buffer is safer but delayed.
_Avoid_: Output latency, cache

**MediaTrackGraph**:
Firefox's internal graph that schedules Web Audio work. Its abbreviation `mtg` appears in the `media.cubeb_latency_mtg_frames` preference.
_Avoid_: Mixer, audio graph

**Cubeb**:
Firefox's audio backend, the layer that talks to Android audio.
_Avoid_: Audio driver, sound API

**Deep-Buffer Path**:
Android's power-saving audio path, selected when the requested stream buffer is above 4,000 frames. It adds about 190ms of delay and is less likely to underrun.
_Avoid_: Power-save mode, big buffer

**Audio Frame**:
One slice of audio. At 48kHz, 48 frames last 1ms and 128 frames last about 2.67ms.
_Avoid_: Sample, packet

**Playback Mode**:
The large-buffer audio mode and the default. It reported about 192ms output latency and clean playback in testing. It is the reliable choice for clean audio.
_Avoid_: High latency mode, safe mode

**Interactive Mode**:
The lower-latency audio mode, opt-in. It reported about 16ms output latency and popped in testing. Firefox ignores the hint.
_Avoid_: Low latency mode, fast mode

**Stored Audio Mode**:
The listener's remembered choice, kept in `localStorage` under `galway2664.audioMode.v1`. A URL override applies to one load and does not replace it.
_Avoid_: Audio cookie, preference file

**Seam**:
A place where program behaviour can be altered without editing code in that place (from Michael Feathers). In this repository, it is the interface location where two modules meet, such as `createWorkbenchView` accepting a player implementation so automated UI test suites can drive presentation using `createFakePlayer` without compiling WebAssembly or initializing Web Audio.
_Avoid_: Boundary, abstraction layer, hook
