# Galway 2664 Domain Glossary

Commodore 64 6502-SID music workbench and live assembly player for Martin Galway's Ocean Software audio routines (1985-1987).

## Core Concepts

**Player Engine**:
The audio and emulation module that assembles Galway's 6502 routines, manages Commodore 64 memory layout, executes WebAssembly emulation cycles, and renders audio blocks into Web Audio.
_Avoid_: Audio service, emulator backend

**Telemetry Snapshot**:
A reusable, pre-allocated snapshot of Commodore 64 engine state refreshed on each frame, containing cycle counts, program counter locations, SID registers, voice channels, filter state, oscilloscope buffers, and screen RAM.
_Avoid_: Frame state, telemetry DTO, debug data

**Workbench View**:
The presentation layer responsible for rendering oscilloscope canvases, the PETSCII CRT monitor, assembly source line tracking, and interactive controls without direct knowledge of emulator ABI internals.
_Avoid_: UI container, frontend app

**Track Session**:
A track configuration descriptor defining the active game, tune, source file, drum routine availability, and program counter symbols.
_Avoid_: Song selection, track model
