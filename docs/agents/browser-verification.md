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
7. Click Stats for Nerds to show process timing, late blocks, missed quanta, telemetry drops, context state, telemetry rate and latency. `lateQuanta` counts blocks over the 2.67ms quantum budget; `lateWindow` shows the current diagnostics window. Session peaks persist until reload. The overlay groups Context, Latency, Process, Deadlines, Telemetry and Events; each metric is one label/value unit, and the Process group includes audio sub-phase and main-thread frame peaks. Click `?` to expand plain-English descriptions for every group and metric. Confirm the guide scrolls, closes back to compact mode, and does not overflow at phone widths. Add `?audioDebug=1` to open the same overlay on load. Playback latency is the default. Toggle Audio Mode to `INTERACTIVE` for the lower-latency hint, or add `?latency=interactive` to start there. Debug captures also accept `?latency=balanced`, `?latency=0.1` and `?latency=0.2`; invalid values fall back to `playback`. The Audio Mode switch stays limited to playback and interactive. Telemetry runs at 62.5Hz by default; add `?telemetry=30` for the lighter rate. The Telemetry switch is hidden. Add `?telemetry=off` to stop snapshots entirely. Audio diagnostics continue, Stats shows `OFF`, and opening Stats must not re-enable snapshots while the override is active.
8. For the Boot Sequence, load without `?skipBoot=1`. Confirm the full-screen power-on, exact BASIC screen, typed `LOAD""`, PRESS PLAY ON TAPE gate, tape loader, tape sound, `READY.`, CRT collapse and Wizball playback. The boot screen must be visible from first paint with no workbench flash. Normal completion starts audio and fades the boot overlay into the workbench over 2.4 seconds. The collapsed CRT must stay aligned with the monitor through the fade. Skip and reduced motion must hide the boot screen and reveal the workbench from first paint. Check the gate hint, skip path and reduced-motion path. Copy Playwright screenshots to `/sdcard/Download/tmp`.
9. Toggle **LOW POWER** near Audio Mode. Confirm the workbench and scopes cap at 30fps, source follow stops animating, sparkle and scanlines stop, telemetry shows 30Hz and turning it off restores the base rate and effects. Chromium default behaviour must be unchanged.
10. Add `?render=minimal` to hide the centre and right panels and pause the workbench render loop. Confirm the transport and track list still work, no `low-power` class is applied and the page fits a 375px viewport without horizontal overflow. Use this flag for the Firefox isolation captures. Run `npm run check:minimal-render` for a repeatable Chromium 153 check at 360px and 390px. It asserts the centre panel, right panel, SID strip and mobile tabs are hidden, the track list is visible and `scrollWidth` does not exceed `innerWidth`. Expected output is two `PASS` lines.

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
