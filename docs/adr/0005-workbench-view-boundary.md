# Workbench View Boundary

Mount the workbench view behind one interface and separate asset loading from presentation.

## Context

Importing `src/app.js` previously triggered immediate side effects. The module executed `initWorkbench()` unconditionally at file evaluation time, executing network asset fetches, compiling WebAssembly, creating the audio player, and attaching DOM handlers across more than 100 elements. Automated UI test suites had to mock global network, window, and audio APIs before importing the file, and could not mount or test rendering without running a complete engine boot cycle.

## Decision

Extract presentation, telemetry visualization, and UI event listeners into `src/workbench_view.js` behind `createWorkbenchView({ document, root, player, assets, elements, onFirstInteraction })`. Move asset fetching, WebAssembly compilation, and player creation into `bootWorkbench` in `src/app.js`, and browser startup into `src/main.js`.

The workbench view exposes a focused interface:
- `renderSession(session)`: Updates catalogue selection, track metadata, and on-screen assembly source.
- `renderTelemetry(telemetry)`: Refreshes CRT monitor, voice scopes, register cells, and line follow highlights.
- `renderSource(sourceFile)`: Formats and displays assembly source lines using pre-cached DOM nodes.
- `setPlaying(isPlaying)`: Synchronizes play/pause button state and status LED indicator.
- `destroy()`: Cancels animation frames, smooth scrolling, and removes attached global listeners.

Element lookups move behind a unified element registry. Automated UI tests drive the view directly using `createFakePlayer` and harness element maps without triggering network fetches or WebAssembly compilation. First-tap mobile audio unlocking is preserved via the `onFirstInteraction` callback.

## Consequences

Importing `src/workbench_view.js` and `src/app.js` produces zero top-level side effects. Browser bootstrapping is decoupled from presentation logic, allowing UI tests to mount and exercise view behaviors deterministically in milliseconds.
