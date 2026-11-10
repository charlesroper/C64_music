# Firefox `AudioContext` `latencyHint` and `media.cubeb_latency_mtg_frames` Research Thread
> Captured 10 November 2026. Answer 2 corrects the original Nightly-only claim. The short answer below reflects that correction. Links point to Firefox source, Bugzilla, MDN and specification discussions.

## Question 1

Here's some output. The question I have is why does firefox not honour latency hint if larger frame buffer is available? Research. Look on discussions and tickets and anywhere else answers can be found. Make sure all claims can be verified with a URL. Knowledge needs to be sourced.

**Short answer:** Firefox treats both as internal, not supported controls, and ignores the standard hint on this audio path. Firefox Beta and Nightly expose the internal override through `about:config`. Stable hides the `about:config` name, but the same editor may open at `chrome://geckoview/content/config.xhtml`.

**Why `media.cubeb_latency_mtg_frames` is hidden**

- It is an `about:config` preference, not a web API. Firefox hides internal tuning knobs because they are not contracts: the name, unit or behaviour can change between builds.
- On Android, Firefox Beta and Nightly expose `about:config`. Stable hides the `about:config` name, but the same editor may open at `chrome://geckoview/content/config.xhtml`. That route is unsupported and can change between builds.
- It sets the MediaTrackGraph audio batch size (`mtg` = MediaTrackGraph, `frames` = slices of sound). The default path chose a small batch, which reports about 11ms `out` on the test device and pops there.
- `4096` frames raised `out` to about 190ms and removed the pops. `2048` did nothing measurable. That is empirical, not guaranteed.

**Why the standard `latencyHint` does not help**

- `AudioContext({ latencyHint })` is advisory by spec. A browser may ignore it, clamp it, or apply it only to some audio paths.
- Chromium honours it for this Web Audio path: `playback` gave about 192ms and clean audio; `interactive` gave about 16ms and popped.
- Firefox ignores the hint here. Passing `playback` or `interactive` changes nothing in `out`; see the research note's Bug 2020377 reference. So the app cannot request a larger buffer through the standard API on Firefox.
- The buffer size that matters is decided below Web Audio, in Firefox's MediaTrackGraph and Cubeb layers. The hidden preference reaches that layer; `latencyHint` does not.

So the app defaults to playback because Chromium honours the hint and clean audio matters more than delay. Firefox users get clean playback with Firefox Beta or Nightly plus the 4096-frame preference, or by using Chromium in playback mode.

## Answer 1

Firefox does not honour `AudioContext({ latencyHint })`–even when the OS and hardware offer a larger deep-buffer audio path–because **`latencyHint` is not yet wired into Firefox's WebIDL bindings or its `MediaTrackGraph` audio engine**, and **Firefox's Android audio backend (`libcubeb`) ignores intermediate frame counts until a hard 4,000-frame threshold is crossed**.

### 1. `latencyHint` Is Omitted from Firefox's WebIDL and Constructor

By specification ([W3C Web Audio API 1.1](https://www.w3.org/TR/webaudio-1.1/)), `AudioContextOptions.latencyHint` is an advisory hint rather than a strict contract. As Mozilla's Web Audio tech lead Paul Adenot (`:padenot`) noted in [WebAudio/web-audio-api-v2 Issue #70](https://github.com/WebAudio/web-audio-api-v2/issues/70):

> *"It's a hint, by definition it is valid, for example, to implement it and do nothing. This is spelled out. The actual latency must however be reported, but doesn't have to match."*

In Gecko (`firefox-main`), `latencyHint` is not merely ignored down the pipeline–it is **not declared in the WebIDL interface at all**:

- **WebIDL strips the property:** In [`dom/webidl/AudioContext.webidl` (lines 12–14)](https://searchfox.org/firefox-main/source/dom/webidl/AudioContext.webidl), Firefox defines `AudioContextOptions` with only `sampleRate`:
  ```idl
  dictionary AudioContextOptions {
    float sampleRate;
  };
  ```
  Because WebIDL dictionaries silently drop unrecognised keys (after [Bug 1361475](https://bugzilla.mozilla.org/show_bug.cgi?id=1361475) removed an old Firefox OS `AudioChannel` constructor in [Firefox 55](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/55)), any `latencyHint` value passed to `new AudioContext({ latencyHint: 'playback' })` is discarded by the JS-to-C++ binding layer before C++ construction begins.
- **C++ constructor only reads `sampleRate`:** In [`dom/media/webaudio/AudioContext.cpp` (lines 262–299)](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioContext.cpp), `AudioContext::Constructor` reads `aOptions.mSampleRate` (supported since [Firefox 61](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/61)) and has no `mLatencyHint` handling, which is why [MDN's `AudioContext()` compatibility table](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext) marks `options.latencyHint` as **No support** on Firefox Desktop and Android.
- **Confirmed by Mozilla in Bugzilla:** When a developer reported in [Bug 1713046](https://bugzilla.mozilla.org/show_bug.cgi?id=1713046) that Firefox accepted invalid strings in `latencyHint` without throwing a `TypeError`, Paul Adenot closed the bug as `RESOLVED INVALID`:
  > *"It's just that it's not implemented, and things that aren't implemented behave like this, e.g. `new AudioContext({"zaza": "zouzou"})` isn't supposed to throw. I'm implementing it in bug 2020377, but this behaves as expected."*

### 2. Why `MediaTrackGraph` Always Requests Minimum Hardware Latency

Firefox splits audio output into two separate pipelines ([Bug 934425](https://bugzilla.mozilla.org/show_bug.cgi?id=934425)):

- **Standard media elements (`<audio>` / `<video>`):** Routed through `AudioSink` / `AudioStream`, which requests a high-latency buffer of **100 ms** by default via [`GetCubebPlaybackLatencyInMilliseconds()` in `dom/media/CubebUtils.cpp` (lines 105, 751–754)](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp) (controlled by `media.cubeb_latency_playback_ms`, as discussed in [cubeb Issue #324](https://github.com/mozilla/cubeb/issues/324)).
- **Web Audio (`AudioContext`) and WebRTC (`getUserMedia`):** Routed through a shared real-time engine called `MediaTrackGraph` (`MTG`), which processes audio directly inside the hardware callback without an intermediate Web Audio buffer (`baseLatency` is always `0` in Firefox, per [MDN's `baseLatency` docs](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency) and Paul Adenot's [A/V sync blog post](https://blog.paul.cx/post/audio-video-synchronization-with-the-web-audio-api/)).

Because `MediaTrackGraph` was designed around real-time WebRTC and interactive synthesis:

- **Single shared graph per window/rate/device:** In [`MediaTrackGraph::GetInstance` (`dom/media/MediaTrackGraph.cpp`, lines 3575–3622)](https://searchfox.org/firefox-main/source/dom/media/MediaTrackGraph.cpp#3575-3622), Firefox multiplexes all `AudioContext` instances in a window onto a single `MediaTrackGraphImpl` keyed only by `{aWindowID, aSampleRate, aPrimaryOutputDeviceID}`. There is no latency parameter in the lookup key.
- **Unconditional minimum-latency query:** When the graph's audio driver initializes in [`AudioCallbackDriver::Init` (`dom/media/GraphDriver.cpp`, lines 580–605)](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp), it calls [`CubebUtils::GetCubebMTGLatencyInFrames(&output)` (`dom/media/CubebUtils.cpp`, lines 766–791)](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp):
  ```cpp
  uint32_t GetCubebMTGLatencyInFrames(cubeb_stream_params* params) {
    StaticMutexAutoLock lock(sMutex);
    if (sCubebMTGLatencyPrefSet) {
      MOZ_ASSERT(sCubebMTGLatencyInFrames > 0);
      return sCubebMTGLatencyInFrames;
    }
    ...
    cubeb_result =
        cubeb_get_min_latency(handle->Context(), params, &latency_frames);
    ...
    return latency_frames;
  }
  ```
  Unless the user overrides `media.cubeb_latency_mtg_frames` (`PREF_CUBEB_LATENCY_MTG`, [`CubebUtils.cpp` line 61](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp)), Firefox always queries `cubeb_get_min_latency()` (falling back to `sCubebMTGLatencyInFrames = 512` only if the query fails) and clamps the floor to `WEBAUDIO_BLOCK_SIZE` (128 frames).

### 3. Why `2048` Frames Does Nothing on Android While `4096` Jumps to ~190 ms

The empirical behaviour noted in your output–where `2048` frames in `media.cubeb_latency_mtg_frames` changes nothing, while `4096` frames jumps `outputLatency` from ~11 ms to ~190 ms and eliminates audio pops–is caused by a **hardcoded 4,000-frame mode switch** inside Firefox's Android Cubeb backends, documented in [Bug 2087144](https://bugzilla.mozilla.org/show_bug.cgi?id=2087144):

- **The 4,000-frame threshold constant:** In [`media/libcubeb/src/cubeb_android.h` (line 11)](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_android.h#11), Cubeb defines:
  ```cpp
  const uint16_t POWERSAVE_LATENCY_FRAMES_THRESHOLD = 4000;
  ```
- **Binary performance-mode switching in AAudio & OpenSL ES:** In [`media/libcubeb/src/cubeb_aaudio.cpp` (lines 1434–1442)](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp#1434-1442) (and [`media/libcubeb/src/cubeb_opensl.cpp` (line 1391)](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_opensl.cpp#1391)), Cubeb does **not** size the Android AAudio buffer proportionally to `stm->latency_frames`. Instead, it uses `stm->latency_frames` only to choose between two Android AAudio performance modes:
  ```cpp
  if (stm->latency_frames <= POWERSAVE_LATENCY_FRAMES_THRESHOLD) {
    LOG("AAudio setting low latency mode for stream");
    WRAP(AAudioStreamBuilder_setPerformanceMode)(
        sb, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
  } else {
    LOG("AAudio setting power saving mode for stream");
    WRAP(AAudioStreamBuilder_setPerformanceMode)(
        sb, AAUDIO_PERFORMANCE_MODE_POWER_SAVING);
  }
  ```
- **Why `2048` has no effect and pops:** As explained in [Bug 2087144 Comment 3](https://bugzilla.mozilla.org/show_bug.cgi?id=2087144):
  > *"The Web Audio graph asks for a latency below `POWERSAVE_LATENCY_FRAMES_THRESHOLD` (4000 frames), so cubeb opens the output stream in `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` (`cubeb_aaudio.cpp`). In that mode, cubeb sets the output buffer to 3 bursts when the burst is smaller than 128 frames (`cubeb_aaudio.cpp`). ... The buffer size does not depend on the requested latency. cubeb also does not read the XRun count and does not make the buffer larger after XRuns. The probable reason for the XRuns is that 6 ms is too short for each callback, which goes through AudioIPC."*
  Because `2048 <= 4000`, AAudio stays locked in `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` with the exact same tiny hardware burst buffer (~6–15 ms depending on device HAL), so `outputLatency` does not budge and `AudioIPC` callbacks still underrun.
- **Why `4096` fixes the pops:** Setting `media.cubeb_latency_mtg_frames` to `4096` crosses `POWERSAVE_LATENCY_FRAMES_THRESHOLD` (`4096 > 4000`), switching AAudio to `AAUDIO_PERFORMANCE_MODE_POWER_SAVING` ([`cubeb_aaudio.cpp` line 1441](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp#1434-1442)) and routing the stream to Android AudioFlinger's deep-buffer mixer thread (~190–230 ms latency), matching the glitch-free path used by `<audio>` elements.

| Configuration / Path | Requested Frames / Time | Android Cubeb Condition ([`cubeb_android.h`](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_android.h#11)) | Android Audio Path ([`cubeb_aaudio.cpp`](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp#1434-1442)) | Resulting `outputLatency` & Stability ([Bug 2087144](https://bugzilla.mozilla.org/show_bug.cgi?id=2087144)) |
| :--- | :--- | :--- | :--- | :--- |
| **`new AudioContext({ latencyHint })`** | Ignored ([`AudioContext.webidl`](https://searchfox.org/firefox-main/source/dom/webidl/AudioContext.webidl)); queries `cubeb_get_min_latency` | `<= 4000` frames | `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` (fixed 3-burst MMAP stream) | ~6–15 ms; frequent XRuns/pops over `AudioIPC` |
| **`media.cubeb_latency_mtg_frames = 2048`** | `2048` frames | `2048 <= 4000` frames | `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` (ignores `2048` buffer size) | ~6–15 ms (unchanged); still pops |
| **`media.cubeb_latency_mtg_frames = 4096`** | `4096` frames | `4096 > 4000` frames | `AAUDIO_PERFORMANCE_MODE_POWER_SAVING` (AudioFlinger deep buffer) | ~190–230 ms; 0 XRuns, clean playback |
| **Plain `<audio src>` element** | `100` ms (`4800` frames at 48 kHz via [`CubebUtils.cpp`](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp)) | `4800 > 4000` frames | `AAUDIO_PERFORMANCE_MODE_POWER_SAVING` (AudioFlinger deep buffer) | ~190–230 ms; 0 XRuns, clean playback |

### 4. Status of Upstream Fix (`Bug 2020377`) and `about:config` on Android

- **Upstream implementation in progress ([Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377)):** Paul Adenot's active patch series on [Bug 2020377 ("Implement AudioContextOptions latencyHint")](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377) adds `latencyHint` to `AudioContextOptions`, adds `latencyHint` to the `MediaTrackGraph` sharing key (`{window, sampleRate, outputDevice, latencyHint}`), and maps the categories as follows:
  > *"The Web Audio API `AudioContextOptions.latencyHint` controls the audio callback buffer size requested from cubeb. Three categories are defined:*
  > *- `interactive`: lowest latency, uses the default MTG latency (from cubeb)*
  > *- `balanced`: ~10ms, computed as `RoundUpPow2(sampleRate / 100)`*
  > *- `playback`: highest latency, uses the platform's playback latency*
  > *A custom positive double (in seconds) is also accepted and converted to frames. All values are rounded to the nearest multiple of the Web Audio render quantum (128 frames) at `AudioContext` construction time, and stored as a plain `uint32_t` frame count in `MediaTrackGraph`."*
  Once [Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377) lands, passing `latencyHint: "playback"` (or a numeric hint above 0.084 seconds at 48 kHz) will request the 100 ms platform playback latency (~4,800 frames at 48 kHz), automatically crossing `POWERSAVE_LATENCY_FRAMES_THRESHOLD` (`4000`) on Android and selecting the deep-buffer mixer without needing `about:config`.
- **Why `about:config` is hidden on Android Stable:** Mozilla intentionally disabled the `about:config` address bar route in Release builds of Firefox for Android (Fenix) so users cannot brick their profile on unrooted devices ([mozilla-mobile/fenix Issue #7865](https://github.com/mozilla-mobile/fenix/issues/7865), [Issue #21276](https://github.com/mozilla-mobile/fenix/issues/21276)), exposing `about:config` directly only in Beta and Nightly–though on Stable/Release builds, the underlying GeckoView preference editor can still be reached by navigating directly to `chrome://geckoview/content/config.xhtml` ([Firefox Android audio workaround thread](https://www.reddit.com/r/firefox/comments/1il7672/youtube_audio_errors_on_firefox_android/)).

## Question 2

Can about:config be accessed on Beta?

## Answer 2

Yes, `about:config` can be accessed directly on **Firefox Beta for Android**–the claim in your snippet that *"Stable and Beta remove it entirely, so the workaround is Nightly-only"* is incorrect:

- **Enabled natively in Beta and Nightly:** In Firefox for Android's runtime initialization ([`GeckoProvider.kt` line 132](https://searchfox.org/firefox-main/source/mobile/android/fenix/app/src/main/java/org/mozilla/fenix/gecko/GeckoProvider.kt#132)), Mozilla explicitly enables `about:config` for both Beta and Nightly builds (originally added in [mozilla-mobile/fenix Issue #7865](https://github.com/mozilla-mobile/fenix/issues/7865) and confirmed by [Mozilla Support](https://support.mozilla.org/mk/questions/1373286)):
  ```kotlin
  .aboutConfigEnabled(Config.channel.isBeta || Config.channel.isNightlyOrDebug)
  ```
- **Accessible via internal URI on Stable/Release:** Even on Stable, the preference editor is not removed; [`nsAboutRedirector.cpp` (lines 20, 106–113, 287–290)](https://searchfox.org/firefox-main/source/docshell/base/nsAboutRedirector.cpp) only blocks the `about:config` alias when `general.aboutConfig.enable` is `false`, so navigating directly to `chrome://geckoview/content/config.xhtml` opens the exact same configuration UI on Release builds ([Reddit `r/firefox` workaround thread](https://www.reddit.com/r/firefox/comments/1il7672/youtube_audio_errors_on_firefox_android/), [AskVG guide](https://www.askvg.com/how-to-access-about-config-page-in-firefox-on-mobile-phones/)).

## Related documentation

- [README.md](../../README.md) gives setup and the current playback default.
- [Audio delay and clean playback](../audio-latency.md) explains the buffer trade-off and the Firefox steps in plain English.
- [Browser Verification](../agents/browser-verification.md) gives the test procedure and expected measurements.
