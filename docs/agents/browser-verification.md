# Browser Verification

How to check the workbench in a browser on this development machine. The machine is Debian under PRoot on Android, so browser support depends on the engine build, not only on the app.

This page is the single source of truth. `README.md`, `NARRATIVE.md`, and the ADRs point here instead of repeating the matrix.

## Engine matrix

Tested on 6 November 2026 with Playwright 1.65.0 and 1.63.0.

| Engine | Build | Boot and DOM | Worklet module | Worklet `process()` ticks | AudioContext |
| --- | --- | --- | --- | --- | --- |
| WebKit | 27.2 | yes | yes | yes | running |
| Chromium | 153.0.8010.12, revision 1243 | yes | yes | yes | running |
| Chromium | 156.0.8078.4, revision 1248 | no, SIGTRAP | no | no | dead |
| Chromium | 158.0.8127.18, revision 1254 | no, SIGTRAP | no | no | dead |
| Firefox | 159.0 | yes | yes | no | suspended |

The worklet probes loaded an HTTP module, a blob URL, and a data URL. All three loaded in WebKit, Chromium 153, and Firefox. WebKit and Chromium 153 then ran about 500 `process()` calls in 1.5 seconds. Firefox created the node but never ran it because the context stayed suspended.

No engine produces audible output here. The sandbox has no audio device. A real phone remains the final audio gate.

## Install

```bash
npx playwright install webkit firefox
npx playwright install-deps webkit firefox
npx playwright@1.63.0 install chromium-headless-shell
```

Playwright 1.65 ships Chromium 158, which crashes. Keep 1.65 for Firefox and WebKit, then point Chromium at the 153 build:

```js
const { chromium } = require("playwright-core");

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell"
});
```

Resolve the path from Playwright 1.63.0 when the cache layout changes:

```js
const pw163 = require("/path/to/playwright-1.63.0");
console.log(pw163.chromium.executablePath());
```

Alternatively, pin the whole test project to Playwright 1.63.0.

## Contract

The checks below use the app's own browser contract. They do not depend on Playwright beyond launching a page.

1. Serve the repository over HTTP. Open it from `http://127.0.0.1:<port>/`, never from `file://`.
2. Wait for `window.__workbenchState.player`. Boot is complete when this object exists and `#play-label` is not `LOADING...`.
3. For UI checks, assert against the mounted DOM. Track rows use `.track-item`. Source rows use `.asm-line`. The C64 monitor is `#c64-monitor-canvas`.
4. For engine audio, call `player.pullAudioBlock(left, right)` with two `Float32Array` buffers. Playback must be active first. A valid track yields nonzero samples. A peak above 0.1 is the current sanity threshold.
5. For worklet checks, call `audioContext.audioWorklet.addModule(url)`, create an `AudioWorkletNode`, connect it through a near-silent gain to `destination`, and count `process()` ticks posted over the node port.
6. For the real app, the first tap starts the worklet. `player.getState().audioBackend` changes to `"worklet"` when the processor owns audio. `player.getTelemetry().frameCount` must advance while the page plays.
7. Click Stats for Nerds to show process timing, late blocks, missed quanta, telemetry drops, context state, telemetry rate and latency. `lateQuanta` counts blocks over the 2.67ms quantum budget; `lateWindow` shows the current diagnostics window. Add `?audioDebug=1` to open the same overlay on load. Playback latency is the default. Toggle Audio Mode to `INTERACTIVE` for the lower-latency hint, or add `?latency=interactive` to start there. Telemetry runs at 62.5Hz by default; add `?telemetry=30` for the lighter rate. The Telemetry switch is hidden.
8. For the Boot Sequence, load without `?skipBoot=1`. Confirm the full-screen power-on, exact BASIC screen, typed `LOAD""`, PRESS PLAY ON TAPE gate, tape loader, tape sound, `READY.`, CRT collapse and Wizball playback. Check the gate hint, skip path and reduced-motion path. Copy Playwright screenshots to `/sdcard/Download/tmp`.

Minimal worklet probe:

```js
class Probe extends AudioWorkletProcessor {
  process() {
    this.port.postMessage("tick");
    return true;
  }
}
registerProcessor("probe", Probe);
```

## Engine guidance

- **WebKit**: use for full headless verification, including the worklet pipeline.
- **Chromium 153**: use when a Chromium result is required. Pin the build as shown above.
- **Firefox**: use for boot, DOM, layout, and track switching. Do not use it to judge audio thread behaviour.
- **Chromium 156 and later**: do not use in this sandbox until the SIGTRAP regression is fixed.

## Resource limits

The host has 3.4 GB of RAM. Run one browser at a time. Close each browser after its check. Firefox and Chromium both survive normal UI and worklet probes, but memory pressure can kill a run during long audio experiments.
