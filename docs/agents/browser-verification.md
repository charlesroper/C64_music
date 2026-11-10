# Browser Verification

How to check the workbench in a browser on this development machine. The machine is Debian under PRoot on Android, so browser support depends on the engine build, not only on the app.

This page is the single source of truth. [README.md](../../README.md), [NARRATIVE.md](../../NARRATIVE.md) and the ADRs point here instead of repeating the matrix. The [audio latency guide](../audio-latency.md) explains the listener-facing trade-off, and the [Firefox latencyHint research](../research/firefox-audiocontext-latencyhint.md) records the source links.

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
7. Click Stats for Nerds to show process timing, late blocks, missed quanta, telemetry drops, context state, telemetry rate and latency. `lateQuanta` counts blocks over the 2.67ms quantum budget; `lateWindow` shows the current diagnostics window. Session peaks persist until reload. The overlay groups Context, Latency, Process, Deadlines, Telemetry and Events; each metric is one label/value unit, and the Process group includes audio sub-phase and main-thread frame peaks. Click `?` to expand plain-English descriptions for every group and metric. Confirm the latency mode help has an **Audio delay help** link to the audio latency guide, the guide scrolls, closes back to compact mode, and does not overflow at phone widths. Add `?audioDebug=1` to open the same overlay on load. Audio Mode defaults to `PLAYBACK` for clean audio. Toggle it to `INTERACTIVE` for lower delay, or add `?latency=interactive` to override the stored choice for one load. Chromium playback is about 192ms and clean; Chromium interactive is about 16ms and can pop on low-end devices. Firefox ignores the hint, so `out` does not change. The choice is stored in `localStorage` under `galway2664.audioMode.v1`, and a URL override does not overwrite it. Confirm the SID chip and Audio Mode short summaries and help buttons are visible, that the stored choice survives a reload, and that `?latency=interactive` changes the mode for that load only. Telemetry runs at a fixed 62.5Hz. The `30Hz` option and stop-snapshot debug flags are removed, and Stats always shows the rate.
8. For the Boot Sequence, load without `?skipBoot=1`. Confirm the full-screen power-on, exact BASIC screen, typed `LOAD""`, PRESS PLAY ON TAPE gate, tape loader, tape sound, `READY.`, CRT collapse and Wizball playback. The boot screen must be visible from first paint with no workbench flash. Normal completion starts audio and fades the boot overlay into the workbench over 2.4 seconds. The collapsed CRT must stay aligned with the monitor through the fade. Skip and reduced motion must hide the boot screen and reveal the workbench from first paint. Check the gate hint, skip path and reduced-motion path. Copy Playwright screenshots to `/sdcard/Download/tmp`.
9. Open the SID chip and Audio Mode help panels at 360px, 390px, 820px, 1280x600 and 1440x900. Confirm the phone view is a bottom sheet, the wider view anchors near the trigger and clamps to the viewport, opening one panel closes the other, and there is no horizontal overflow. Check Tab, Enter or Space, the Audio delay link, Escape with focus return, outside tap and reduced motion. Run `npm run check:help-popovers` for the repeatable Chromium 153 matrix.

### Firefox audio buffer check

Firefox Beta and Nightly expose `about:config`. Stable hides the `about:config` name, but the same editor may open at `chrome://geckoview/content/config.xhtml`. That route is unsupported and can change between builds.

1. Open Firefox Beta or Nightly.
2. Open `about:config`.
3. Tap **+**.
4. Add `media.cubeb_latency_mtg_frames` as a **Number**.
5. Set the value to `4096`.
6. Force-stop Firefox and reopen it.
7. Open the app and Stats. Confirm `out` is around 190ms.
8. Play for two minutes and listen for pops.

A value of `2048` did not help on the test device. `out` stayed around 11ms and the pops remained. Android's audio backend switches to the deep-buffer path above 4,000 frames, so `2048` stays in low-latency mode and the buffer does not grow.

Firefox is adding `latencyHint` support in [Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377). It has not landed yet. The [research note](../research/firefox-audiocontext-latencyhint.md) records the source links.

Expected audio results:

| Browser and mode | `out` | Result |
| --- | --- | --- |
| Chromium playback | about 192ms | clean |
| Chromium interactive | about 16ms | pops |
| Firefox default | about 11ms | pops |
| Firefox, 2048-frame buffer | about 11ms | pops |
| Firefox, 4096-frame buffer | about 190ms | clean |

Measurements come from a Samsung Galaxy A16 using Firefox Nightly and Chromium 153. Results vary by device, Android version and browser build. See [Audio delay and clean playback](../audio-latency.md) for the plain-English explanation.

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
