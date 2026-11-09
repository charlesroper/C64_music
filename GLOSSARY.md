# Galway 2664 Domain Glossary

Commodore 64 6502-SID music workbench and live assembly player for Martin Galway's Ocean Software audio routines (1985-1987).

## Core Concepts

**Player Engine**:
The main-thread module that assembles Galway's 6502 routines, holds playback and hardware state, and sends commands to the Engine Core.
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

**Low Power Mode**:
An opt-in presentation mode that caps workbench rendering at 30fps, stops smooth source scrolling, disables sparkle and scanlines, and lowers telemetry to 30Hz while leaving the Engine Core and audio path unchanged.
_Avoid_: performance mode, eco mode

**Seam**:
A place where program behaviour can be altered without editing code in that place (from Michael Feathers). In this repository, it is the interface location where two modules meet, such as `createWorkbenchView` accepting a player implementation so automated UI test suites can drive presentation using `createFakePlayer` without compiling WebAssembly or initializing Web Audio.
_Avoid_: Boundary, abstraction layer, hook
