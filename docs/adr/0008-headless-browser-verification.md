---
status: accepted
---

# Headless Browser Verification Matrix

Headless verification in the PRoot development sandbox uses WebKit 27.2 or Chromium 153. WebKit and Chromium 153 load AudioWorklet modules, run `process()` ticks, and keep the `AudioContext` running. Chromium 156 and later crash at startup with SIGTRAP in this environment. Firefox 159 boots the app and loads worklet modules, but its `AudioContext` stays suspended, so it is a UI harness only.

This supersedes the verification note in ADR-0007. The earlier conclusion, that AudioWorklet loading was unavailable under PRoot, was caused by the Chromium build under test, not by PRoot.

## Considered Options

- **Keep testing with the latest Chromium**: rejected. Chromium 156 revision 1248 and Chromium 158 revision 1254 die with exit 133 before a page is created.
- **Use Firefox for everything**: rejected. The app boots and worklet modules load, but the audio context never leaves `suspended`, so `process()` never ticks.
- **Build a custom Chromium**: rejected. WebKit already provides a clean headless check, and Chromium 153 remains available from Playwright.
- **Verify only in `npm test` and on a phone**: rejected. The worklet pipeline can be checked headlessly with WebKit, which shortens the feedback loop for issue #37.

## Consequences

- Headless WebKit is the primary end-to-end check for the AudioWorklet pipeline.
- Chromium is pinned to Playwright 1.63.0 or to an explicit `executablePath`. The latest Playwright may still drive Firefox and WebKit.
- Firefox remains useful for DOM, layout, and boot checks.
- No engine produces audible output in this sandbox. A manual listen on a real phone remains the final audio gate.
- The engine matrix and commands live in `docs/agents/browser-verification.md`.
