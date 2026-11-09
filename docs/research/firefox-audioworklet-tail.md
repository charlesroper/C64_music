# AudioWorklet tail latency on Firefox for Android

Research note for ticket #58, 9 November 2026. This note separates what the Web Audio specification, Firefox source, Bugzilla, Chromium source and GitHub Pages documentation confirm from what remains a public report. It does not propose production code.

The question is tail behaviour: the worst audio callback, the worst telemetry handoff and the worst main-thread frame, and whether those tails can explain audible pops on Firefox for Android while Chromium remains clean.

## Summary

Firefox does not implement `AudioContextOptions.latencyHint`. The current WebIDL dictionary declares only `sampleRate`, Firefox's own web-platform-tests (WPT) expectation file records the latency hint tests as failures and Bugzilla bug 2020377 remains open with an unlanded patch. The app's `"playback"` hint therefore has no effect on Firefox for Android. This is confirmed by source and Bugzilla, not inferred.

Firefox for Android runs the worklet on the shared MediaTrackGraph path. The graph asks cubeb for its minimum latency by default. With AAudio that minimum is the device's frames per burst, and the graph clamps its requested latency to at least 128 frames. The graph's request is not the same as the device callback size. In low-latency mode, cubeb asks AAudio for a buffer of two bursts, or three bursts when the burst is below 128 frames ([cubeb_aaudio.cpp](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp#1470-1488)). That can leave a small device callback buffer, even when `outputLatency` reports 12.8ms. Bugzilla has confirmed Android Web Audio underruns on this path, but no Mozilla-confirmed AudioWorklet-specific Android underrun bug was found.

The app's 37ms `postMessage` peak is a credible audio-thread stall because telemetry is posted from inside the render callback. The 12.8ms output latency and the 37ms stall are both plausible causes of the pops. The current evidence cannot separate them because the counters are not timestamped against audible events.

## 1. Firefox Android AudioWorklet scheduling and glitch reports

The Web Audio specification requires a control thread and a rendering thread. The rendering thread computes audio in response to a system-level audio callback. A load value is the callback duration divided by the callback buffer duration. An audio buffer underrun happens when that load value exceeds 1.0 ([Web Audio API, §2.2 and render quantum](https://www.w3.org/TR/webaudio/#control-thread-and-rendering-thread)). The default render quantum is 128 frames, but the system-level callback buffer can contain several quanta ([Web Audio API, render quantum size](https://www.w3.org/TR/webaudio/#render-quantum-size)).

Firefox calls `process()` from `WorkletNodeEngine::ProcessBlocksOnPorts`, which runs on the MediaTrackGraph rendering thread ([AudioWorkletNode.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#467-609)). The worklet implementation has no separate Android scheduler. Android-specific buffering sits below the graph in cubeb and AAudio.

`AudioCallbackDriver` creates the cubeb stream with a frame count from `CubebUtils::GetCubebMTGLatencyInFrames` and traces the callback against a real-time budget ([GraphDriver.cpp](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#580-605), [GraphDriver.cpp](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#908-909)). On AAudio, `cubeb_get_min_latency` returns `AAudioStream_getFramesPerBurst` ([cubeb_aaudio.cpp](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp#2135-2145)). `GraphDriver` clamps the requested latency to at least `WEBAUDIO_BLOCK_SIZE`, which is 128 frames ([GraphDriver.cpp](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#600-604)). That is the graph's latency request, not the AAudio data callback size. cubeb then sets the AAudio buffer to two or three hardware bursts ([cubeb_aaudio.cpp](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp#1470-1488)). The device callback can therefore be smaller or larger than one 128-frame render quantum.

Confirmed reports on the shared Android audio path:

* Bug 1930825, fixed in November 2024, reported crackling from a simple `OscillatorNode` on Android. Mozilla's profiler showed late AudioIPC client callbacks and a 5.3ms budget. The fix increased frames per data callback to at least 1024 on Android when the pref was not set ([Bug 1930825](https://bugzilla.mozilla.org/show_bug.cgi?id=1930825)).
* Bug 2012750, still new, reports Android noise when notes change. A Mozilla engineer measured a 23.2ms real-time budget on the AudioIPC client callback thread and suspected that the budget was too long for the work ([Bug 2012750](https://bugzilla.mozilla.org/show_bug.cgi?id=2012750)).
* Mozilla also promoted AudioIPC rendering thread priority on Android in Bug 1931080 and Bug 1982927, which confirms that callback scheduling on this path has been a real problem ([Bug 1931080](https://bugzilla.mozilla.org/show_bug.cgi?id=1931080), [Bug 1982927](https://bugzilla.mozilla.org/show_bug.cgi?id=1982927)).
* Bug 1637491 is an Android x86_64 emulator timeout in an AudioWorklet crashtest. It is a test-harness failure, not evidence of playback underruns ([Bug 1637491](https://bugzilla.mozilla.org/show_bug.cgi?id=1637491)).
* Bug 1893939 reported AudioContext crackling and ended `WORKSFORME` ([Bug 1893939](https://bugzilla.mozilla.org/show_bug.cgi?id=1893939)).

Bug 1930825's patch used an `AndroidGetAudioOutputFramesPerBuffer` helper to apply a 1024-frame floor when the preference was unset. The current `CubebUtils.cpp` instead returns `cubeb_get_min_latency` when the preference is unset ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#766-791)). This note does not record when that helper changed, so 1024 frames is not a current guarantee.

The public report closest to this app is Bug 2087144, which is `UNCONFIRMED` ([Bug 2087144](https://bugzilla.mozilla.org/show_bug.cgi?id=2087144)). It reports a Pixel 8a on Android 17 with Firefox 158. A single `OscillatorNode` crackles. AAudio uses a shared MMAP stream with a reported 96-frame burst, about 288 frames queued and `outputLatency` of about 14.8ms. The 288-frame queue is consistent with three bursts. The reporter measured repeated XRuns and found identical burst, capacity and queued frames under `latencyHint` values `"playback"`, `"interactive"` and `0`. Chrome and Brave played the same page cleanly. This is consistent with the Firefox source finding that `latencyHint` is ignored, but Mozilla has not confirmed the report or its proposed AAudio cause.

What is confirmed: the scheduling model, the small default callback path, the `latencyHint` omission and the fact that Mozilla has fixed Android Web Audio underruns in this shared path. What is only a public report: the exact XRun (device underrun) counts, the 6ms queued audio and the claim that this explains the clicks on a specific Pixel device.

## 2. Firefox latencyHint behaviour

The specification defines three categories. `"balanced"` balances latency and power, `"interactive"` requests the lowest latency without glitching and `"playback"` prioritises uninterrupted playback with the lowest power consumption. A numeric value is a number of seconds and is interpreted at the browser's discretion. The actual latency is exposed through `baseLatency` ([Web Audio API, §1.2 and §1.2.5](https://www.w3.org/TR/webaudio/#dom-audiocontextoptions-latencyhint)).

Firefox does not implement the option. `AudioContextOptions` in Firefox declares only `sampleRate` ([AudioContext.webidl](https://searchfox.org/firefox-main/source/dom/webidl/AudioContext.webidl#12-14)). WebIDL dictionary conversion ignores members that the dictionary does not declare ([WebIDL dictionaries](https://webidl.spec.whatwg.org/#idl-dictionaries)). Firefox's WPT expectation file still marks two latency hint assertions as failures: the invalid `"foo"` value should throw but does not, and the numeric hint test fails one assertion ([Firefox WPT expectations](https://searchfox.org/firefox-main/source/testing/web-platform/meta/webaudio/the-audio-api/the-audiocontext-interface/audiocontextoptions.html.ini#6-10)). Bug 2020377, `Implement AudioContextOptions latencyHint`, is open with an unlanded patch that would map the categories to callback buffer sizes and round numeric values to multiples of 128 frames ([Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377)).

Firefox's `baseLatency` is hard-coded to 0 because Gecko says it does not buffer between rendering and the audio subsystem ([AudioContext.h](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioContext.h#197-201)). `outputLatency` asks the graph for its audio output latency, which comes from `cubeb_stream_get_latency` ([AudioContext.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioContext.cpp#560-580), [GraphDriver.cpp](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#1275-1288)).

The answer to the Android part is therefore direct. `"playback"`, `"balanced"`, `"interactive"`, `0.1` and `0.2` all have no effect in current Firefox for Android. They do not throw. They do not change the callback buffer. The app's 12.8ms reading is `outputLatency`, not a latency hint result and not `baseLatency`.

## 3. media.audio_frames_per_block and related preferences

An exact [Searchfox query](https://searchfox.org/firefox-main/search?q=media.audio_frames_per_block) returns no source occurrence for `media.audio_frames_per_block` in current Firefox source. The related preference that does exist is `media.cubeb_latency_mtg_frames` (`PREF_CUBEB_LATENCY_MTG`) ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#57-61)).

`media.cubeb_latency_mtg_frames` controls the requested MediaTrackGraph callback size in frames. When a user value is present, it is read and clamped to the range 128 to 1,000,000 frames ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#271-280)). The fallback constant is 1024 frames, but that value only applies through the preference path ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#196-198)). When the preference is not set, Firefox calls `cubeb_get_min_latency`; if cubeb cannot answer, the static fallback is 512 frames ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#766-791)).

The values are not rounded to a multiple of 128 by the preference code. The graph only clamps the result to at least 128 frames ([GraphDriver.cpp](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#600-604)). The proposed `latencyHint` patch would round hints to 128-frame multiples, but that patch is not shipped ([Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377)).

A web page cannot change this preference. It is read through Firefox's privileged preferences service, and the Web Audio API exposes no preference setter. A page can request a latency hint and a sample rate, but neither reaches this preference in current Firefox. Changing it requires `about:config`, an enterprise policy or a custom build.

Related media preferences such as `media.cubeb_latency_playback_ms` control HTML media playback, not the Web Audio graph. Its default is 100ms and it is clamped to 1ms to 1000ms ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#105-106), [CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#267-270)). It is not a substitute for the Web Audio callback preference.

## 4. postMessage, transfer and garbage collection on the audio thread

The specification defines `AudioWorkletProcessor.port` as a `MessagePort` connected to the matching `AudioWorkletNode`. The port supports bidirectional messaging. The specification advises authors to close one end when the port is no longer needed so that resources can be collected ([Web Audio API, §1.32.5.2](https://www.w3.org/TR/webaudio/#AudioWorkletProcessor)).

`MessagePort.postMessage` is asynchronous. Messages are tasks on the port message queue, and the receiving event loop dispatches them later. The transfer list transfers objects rather than cloning them, and the sender can no longer use them ([HTML Standard, MessagePort](https://html.spec.whatwg.org/multipage/web-messaging.html#messageport), [HTML Standard, structured serialisation with transfer](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer)). Transferring an `ArrayBuffer` avoids cloning the payload, but it does not make the call synchronous with the receiver and it does not remove the task allocation or the wake-up cost.

The specification says the `inputs`, `outputs` and `parameters` arrays are generally reused between `process()` calls so that no memory allocation is done. New arrays are allocated when the topology changes or when part of the arrays is transferred ([Web Audio API, §1.32.5.3.1](https://www.w3.org/TR/webaudio/#AudioWorkletProcessor)). That is a design expectation, not a blanket ban on allocation. The real-time load requirement is what makes allocation and garbage collection risky.

Firefox source follows the same pattern. `AudioWorkletImpl` creates a `MessageChannel` and transfers one port to the worklet global scope ([AudioWorkletImpl.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletImpl.cpp#35-52)). `AudioWorkletNode` creates a second channel for the processor port and serialises the processor options, allowing shared memory only when the global allows it ([AudioWorkletNode.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#738-785)). `AudioWorkletGlobalScope::ConstructProcessor` deserialises the transferred port once during construction ([AudioWorkletGlobalScope.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletGlobalScope.cpp#284-360)).

`WorkletNodeEngine::CallProcess` contains an explicit comment that MediaTrackGraph control messages cannot be triggered by script and do not run until after `ProcessBlocksOnPorts()` has returned ([AudioWorkletNode.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#418-421)). Error reporting is dispatched to the main thread with `NS_DispatchToMainThread` ([AudioWorkletNode.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#190-203)). Messages from the audio thread therefore leave the audio thread as tasks, while `process()` itself runs to completion first.

`PrepareBufferArrays` states that its approach aims to minimise garbage creation while still tolerating script changes. It reuses `Float32Array` and `Array` objects unless a buffer was detached or the channel count changed ([AudioWorkletNode.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#363-415)). That reduces steady-state allocation. The Firefox source shows no blanket suppression of garbage collection on the graph thread; `JS::AutoCheckCannotGC` is used only around direct buffer access. A garbage collection can therefore still occur outside those scoped regions, and any allocation can trigger one.

For this app, the transfer design removes the 64KB structured clone described in the project history, but it does not remove the `postMessage` call itself. The worklet still builds a message wrapper, posts a task and wakes the main thread. The app's `postMessagePeakUs` measures the synchronous part of that call on the audio thread.

## 5. Chromium Android playback latency

Chromium implements all three categories. `RendererWebAudioDeviceImpl::GetOutputBufferSize` maps `"interactive"` to `AudioLatency::GetInteractiveBufferSize`, `"balanced"` to `GetRtcBufferSize`, `"playback"` to `GetHighLatencyBufferSize` and a numeric hint to `GetExactBufferSize` ([renderer_webaudiodevice_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/content/renderer/media/renderer_webaudiodevice_impl.cc)).

On Android, `GetHighLatencyBufferSize` uses the nearest power of two at or above 20ms of audio. At 48kHz that is 1024 frames, about 21.3ms ([audio_latency.cc](https://chromium.googlesource.com/chromium/src/+/main/media/base/audio_latency.cc)). `AudioManagerAndroid` passes the requested buffer size through when the latency tag is `kPlayback`. Its comment states that this provides significant power savings and reduces the potential for glitches under load ([audio_manager_android.cc](https://chromium.googlesource.com/chromium/src/+/main/media/audio/android/audio_manager_android.cc)).

The other categories are smaller. `"balanced"` uses `GetRtcBufferSize`, which on Android raises a small hardware buffer to at least 20ms. `"interactive"` uses the hardware buffer, with an LCM adjustment and a 512-frame cap when the hardware burst is below 128 frames ([audio_latency.cc](https://chromium.googlesource.com/chromium/src/+/main/media/base/audio_latency.cc)).

Chromium has its own history of Android worklet glitches on this path. Issue 40133762 is titled `AudioWorklet Audio Skips / Glitches with "playback" latency on Android Chrome`, and issue 40170401 is titled `AudioWorklet glitches after reloading a page (Pixel devices)` ([Chromium issue 40133762](https://issues.chromium.org/issues/40133762), [Chromium issue 40170401](https://issues.chromium.org/issues/40170401)). Those titles confirm that a large playback buffer does not make Chromium immune to Android worklet scheduling problems, but they do not establish a root cause.

Chromium's `baseLatency` and `latencyHint` describe Web Audio's internal buffering, not the full device latency ([Web Audio API, baseLatency](https://www.w3.org/TR/webaudio/#dom-audiocontext-baselatency)). The app's observation that Chromium plays cleanly with a far larger output buffer is consistent with the playback path using a larger buffer, but it is an observation from this app, not a controlled browser comparison.

## 6. SharedArrayBuffer and GitHub Pages

`SharedArrayBuffer` is not generally available without cross-origin isolation. The HTML Standard deletes the `SharedArrayBuffer` constructor from a realm when its agent cluster's cross-origin isolation mode is `"none"` ([HTML Standard, agent clusters](https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-cluster-formalism)). `crossOriginIsolated` depends on the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response headers ([HTML Standard, crossOriginIsolated](https://html.spec.whatwg.org/multipage/webappapis.html#dom-crossoriginisolated)).

GitHub Pages is a static hosting service. The official documentation describes it as serving HTML, CSS and JavaScript from a repository and provides no COOP or COEP setting for `github.com` Pages ([GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). Response-header configuration is documented only for GitHub Enterprise Server administrators ([GitHub Enterprise Server Pages configuration](https://docs.github.com/en/enterprise-server@3.18/admin/configuring-settings/configuring-user-applications-for-your-enterprise/configuring-github-pages-for-your-enterprise)).

A live `HEAD` request to `https://charlesroper.github.io/C64_music/` on 9 November 2026 returned `HTTP/2 200`, `server: GitHub.com` and no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` header.

COOP and COEP cannot be set through the documented GitHub Pages configuration for `github.com`, and a `_headers` file is not part of the documented Pages feature set. `SharedArrayBuffer` is therefore not viable for the deployed site as it stands. Firefox also allows shared memory objects in serialised processor options only when `IsSharedMemoryAllowed()` is true, so the supported construction path is closed without isolation ([AudioWorkletNode.cpp](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#769-785)). A service-worker COOP or COEP shim is outside documented Pages support and outside this note.

## 7. Confirmed facts and unverified reports

Confirmed by specification or browser source:

* The render quantum is 128 frames by default. The system callback can contain several quanta, and underrun occurs when rendering takes longer than the callback buffer duration ([Web Audio API](https://www.w3.org/TR/webaudio/#render-quantum-size)).
* Firefox does not declare `latencyHint` in `AudioContextOptions`. The value is ignored, and Bug 2020377 is open with an unlanded implementation ([AudioContext.webidl](https://searchfox.org/firefox-main/source/dom/webidl/AudioContext.webidl#12-14), [Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377)).
* Firefox `baseLatency` is 0. `outputLatency` comes from the graph and `cubeb_stream_get_latency` ([AudioContext.h](https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioContext.h#197-201), [GraphDriver.cpp](https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#1275-1288)).
* Firefox asks cubeb for minimum latency when `media.cubeb_latency_mtg_frames` is unset. On AAudio that minimum is the device burst, and the graph clamps to at least 128 frames ([CubebUtils.cpp](https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp#766-791), [cubeb_aaudio.cpp](https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp)).
* Mozilla fixed Android Web Audio crackling in Bug 1930825 by increasing frames per callback, and is still investigating Android callback-budget noise in Bug 2012750 ([Bug 1930825](https://bugzilla.mozilla.org/show_bug.cgi?id=1930825), [Bug 2012750](https://bugzilla.mozilla.org/show_bug.cgi?id=2012750)).
* Chromium maps `"playback"` to a high-latency buffer, about 1024 frames at 48kHz, and Android passes that requested size through for playback ([renderer_webaudiodevice_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/content/renderer/media/renderer_webaudiodevice_impl.cc), [audio_latency.cc](https://chromium.googlesource.com/chromium/src/+/main/media/base/audio_latency.cc), [audio_manager_android.cc](https://chromium.googlesource.com/chromium/src/+/main/media/audio/android/audio_manager_android.cc)).
* GitHub Pages for `github.com` is static hosting with no documented COOP or COEP setting. The deployed site returned no such headers ([GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), live check on 9 November 2026).

Unverified or app-local:

* Bug 2087144 is `UNCONFIRMED`. Its XRun counts, 6ms queued audio and claim that AAudio explains the clicks are a public report, not a Mozilla finding ([Bug 2087144](https://bugzilla.mozilla.org/show_bug.cgi?id=2087144)).
* The app's listening impression that Firefox pops and Chromium is clean is not a controlled comparison. The browsers may use different sample rates, buffer sizes and device modes.
* The link between the 37ms `postMessage` peak and an audible pop is an inference from matching maxima. The app does not timestamp pops against process or message peaks.
* The app's `late` counter is not a device XRun count. It only says a callback took longer than 2.67ms.

## 8. Assessment of this app's evidence

The 12.8ms figure is the app's reported `outputLatency`. It is not Firefox `baseLatency`, which is always 0, and it is not the MediaTrackGraph latency request. At the AAudio layer, cubeb sets the device buffer to two or three hardware bursts, so the effective callback can differ from the 128-frame quantum. The app's 2.67ms budget is the duration of one 128-frame quantum at 48kHz, not the output buffer duration. If the 12.8ms reading came from a different diagnostic field, the comparison in this section changes, but the app reports this value from `AudioContext.outputLatency`.

The app figures in this section come from the user's Firefox phone Stats capture on 9 November 2026. They are app measurements, not a controlled benchmark.

The process distribution is not the main worry. The median is 0.03ms, p95 is 1.02ms and p99 is 2.02ms. The p99 leaves only 0.65ms of headroom against the 2.67ms quantum budget, but it is still below budget. The 4ms maximum is over budget, and the 37ms session peak is far over budget. The tail, not the median, is the relevant signal.

The 37ms process peak and the 37ms `postMessage` peak are equal. Because `sendTelemetry` runs inside the render callback, a 37ms `postMessage` would also appear as a 37ms process block. That makes the telemetry handoff a credible audio-thread stall. The app already transfers the telemetry buffer, so the peak is not explained by structured-cloning the 64KB payload. It points to allocation, garbage collection or scheduling around the call. It is not proof: the equality may be a coincidence between two session maxima, and the peak may come from a one-off startup or track-load event rather than steady playback.

The deadline counters are mixed. Two late callbacks out of 375 is 0.53%, and a late peak of 11 in one window shows clustering. `late` means a callback took longer than 2.67ms. It does not mean the device missed a buffer. `missed` counts skipped 128-frame quanta from `currentFrame` deltas. Neither counter is a device XRun count, and Firefox does not expose XRuns to web content.

The telemetry drops are consistent with main-thread backpressure. There are 53 drops in total, 0 in the current window and a peak of 13 in one window. A six-buffer pool at 62.5Hz holds about 96ms of snapshots. A 92ms main-thread frame plus scheduling delay can exhaust that pool. The worklet drops telemetry rather than miss an audio deadline, so these drops do not by themselves prove audio underrun. They do show that the main thread sometimes stops recycling buffers for about the length of a long frame.

The main-thread frame numbers are poor. A p95 of 17ms misses a 60Hz frame budget. A 59ms maximum and a 92ms session peak are long tasks. They can delay telemetry recycling, canvas work and UI response, but a correctly isolated worklet should continue rendering audio while the main thread is busy. If audio pops correlate with these frames, the coupling is more likely through the message channel or system scheduling than through direct audio rendering.

Chromium playing cleanly with a much larger output buffer is the strongest comparative clue. It points to the Firefox output path, not to the SID emulation being uniquely expensive. But the comparison is not controlled: the two browsers may use different sample rates, buffer sizes, resampling paths and device modes.

The current evidence cannot distinguish these possibilities:

1. Firefox for Android underruns because its callback buffer is small and AAudio scheduling is irregular.
2. The audio thread stalls for 37ms inside telemetry `postMessage`, causing a missed buffer.
3. The 37ms peak is a one-off startup or track-load event and the audible pops come from steady-state scheduling.
4. Main-thread long frames cause telemetry backpressure and correlate with pops, without causing them.
5. The app's p99 render cost is close enough to the quantum budget that it contributes under thermal or CPU pressure.

The counters do not record when the 37ms peak occurred, when the late blocks occurred or when the listener heard a pop. That missing timestamp correlation is the main gap.

## 9. Isolation experiments, in test order

Run these in order. Each one should record `baseLatency`, `outputLatency`, process percentiles, late and missed counts and, where possible, Android AAudio XRuns before and after the listening window.

1. **Telemetry off.** Disable the telemetry path completely, not the 30Hz option. Keep the same render, track and latency mode. If pops stop and the 37ms process peak disappears, the telemetry handoff is implicated. If pops continue, the output path is implicated. This is the cheapest and most discriminating experiment.

2. **Minimal app worklet.** Use a worklet that outputs a constant or a simple oscillator with no WASM, no SID emulation and no telemetry. Keep the same `AudioContext`, sample rate and device. This is stronger than the `?render=minimal` debug flag, which hides the workbench panels but keeps the full WASM and SID engine and, unless `?telemetry=off` is also set, telemetry. If the bare worklet is clean, the app's render or telemetry load matters. If it still pops, Firefox for Android's output path is the cause. This separates app work from browser buffering.

3. **Latency hint matrix.** Create fresh contexts with `"playback"`, `"balanced"`, `"interactive"`, `0.1` and `0.2`. Record `baseLatency` and `outputLatency` for each. Current source predicts that all five produce the same result. If they do, the hint is confirmed as a no-op and cannot be used as a mitigation. If they differ, the source model is incomplete and the result is important.

4. **Main-thread stress.** Block the main thread for about 100ms while audio plays, or run a heavy canvas or source-scroll workload. If audio glitches only during the block, investigate message-channel or system coupling. If audio stays clean, main-thread jank is not the audio cause, even if it is real.

Secondary checks: on a test build where `media.cubeb_latency_mtg_frames` can be changed, set it to 1024 or 2048 and restart. Rising `adb shell dumpsys media.aaudio` XRuns during a pop confirm a device underrun rather than an app-level late counter. Also compare forcing `sampleRate: 48000` with omitting it, because resampling adds CPU cost.

## 10. Hypotheses, in test order

1. **Firefox for Android's output path runs small AAudio buffers with irregular scheduling.** Firefox asks cubeb for minimum latency, AAudio returns the device burst, and cubeb sets the device buffer to two or three bursts. The graph clamps its requested latency to 128 frames, but that is not the effective device callback size. `latencyHint` does not raise the buffer because Firefox does not implement it. Chromium's larger playback buffer is clean. The 12.8ms `outputLatency` and the 37ms peak are both compatible with this hypothesis.

2. **The telemetry `postMessage` stalls the audio thread.** The 37ms post peak equals the 37ms process peak, and the call runs inside the render callback. This is a credible second hypothesis and the easiest to test. Transferring the buffer removes the large clone but not the message task, wake-up or any allocation around it.

3. **The app's render cost contributes at the margin.** A p99 of 2.02ms against a 2.67ms quantum budget leaves little headroom, and the 4ms maximum is over budget. This is unlikely to explain a 37ms stall on its own, but it makes the system less tolerant of scheduling jitter and thermal throttling.

4. **Main-thread long frames cause telemetry backpressure.** The 92ms peak can exhaust the six-buffer pool, and the drops show that recycling sometimes stops. This is a real performance problem, but it is not proof of audio underrun because the worklet drops telemetry instead of missing a deadline.

5. **The `"playback"` hint is not working.** This is not a cause of the pops. It is the reason the app's current mitigation does nothing on Firefox. The default hint should not be treated as a stability control until Bug 2020377 lands or the app changes the buffer through another supported mechanism.

The evidence cannot distinguish the output path from the telemetry stall. It also cannot distinguish a steady-state underrun from a startup or track-load spike. A timestamped event log that pairs each audible pop with the nearest process, postMessage and frame peaks would settle the question. Until then, telemetry off and the minimal app worklet are the two experiments that matter most.

## References

* Web Audio API, W3C Recommendation: https://www.w3.org/TR/webaudio/.
* Web Audio API, control thread and rendering thread: https://www.w3.org/TR/webaudio/#control-thread-and-rendering-thread.
* Web Audio API, render quantum size: https://www.w3.org/TR/webaudio/#render-quantum-size.
* Web Audio API, AudioContextOptions latencyHint: https://www.w3.org/TR/webaudio/#dom-audiocontextoptions-latencyhint.
* Web Audio API, AudioContextLatencyCategory: https://www.w3.org/TR/webaudio/#enumdef-audiocontextlatencycategory.
* Web Audio API, AudioWorkletProcessor: https://www.w3.org/TR/webaudio/#AudioWorkletProcessor.
* Web Audio API, AudioWorkletProcessor instantiation: https://www.w3.org/TR/webaudio/#AudioWorkletProcessor-instantiation.
* WebIDL, dictionaries: https://webidl.spec.whatwg.org/#idl-dictionaries.
* HTML Standard, MessagePort: https://html.spec.whatwg.org/multipage/web-messaging.html#messageport.
* HTML Standard, MessagePort.postMessage: https://html.spec.whatwg.org/multipage/web-messaging.html#dom-messageport-postmessage.
* HTML Standard, ports and garbage collection: https://html.spec.whatwg.org/multipage/web-messaging.html#ports-and-garbage-collection.
* HTML Standard, structured serialisation with transfer: https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer.
* HTML Standard, crossOriginIsolated: https://html.spec.whatwg.org/multipage/webappapis.html#dom-crossoriginisolated.
* HTML Standard, agent clusters and cross-origin isolation: https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-cluster-formalism.
* Firefox AudioContext WebIDL: https://searchfox.org/firefox-main/source/dom/webidl/AudioContext.webidl#12-14.
* Firefox AudioContext baseLatency: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioContext.h#197-201.
* Firefox AudioContext outputLatency: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioContext.cpp#560-580.
* Firefox AudioWorkletNode process and ports: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#467-609.
* Firefox AudioWorkletNode buffer reuse: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#363-415.
* Firefox AudioWorkletNode port creation: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletNode.cpp#738-785.
* Firefox AudioWorkletImpl message channel: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletImpl.cpp#35-52.
* Firefox AudioWorkletGlobalScope processor construction: https://searchfox.org/firefox-main/source/dom/media/webaudio/AudioWorkletGlobalScope.cpp#284-360.
* Firefox CubebUtils preferences and latency: https://searchfox.org/firefox-main/source/dom/media/CubebUtils.cpp.
* Firefox GraphDriver callback setup: https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#580-605.
* Firefox GraphDriver output latency: https://searchfox.org/firefox-main/source/dom/media/GraphDriver.cpp#1275-1288.
* Firefox cubeb AAudio backend: https://searchfox.org/firefox-main/source/media/libcubeb/src/cubeb_aaudio.cpp.
* Firefox WPT expectations for latencyHint: https://searchfox.org/firefox-main/source/testing/web-platform/meta/webaudio/the-audio-api/the-audiocontext-interface/audiocontextoptions.html.ini#6-10.
* Web Platform Tests, AudioContextOptions: https://github.com/web-platform-tests/wpt/blob/master/webaudio/the-audio-api/the-audiocontext-interface/audiocontextoptions.html.
* Mozilla Bug 2020377, implement latencyHint: https://bugzilla.mozilla.org/show_bug.cgi?id=2020377.
* Mozilla Bug 1930825, Android oscillator crackling: https://bugzilla.mozilla.org/show_bug.cgi?id=1930825.
* Mozilla Bug 2012750, Android noise and callback budget: https://bugzilla.mozilla.org/show_bug.cgi?id=2012750.
* Mozilla Bug 1931080, promote AudioIPC rendering thread priority on Android: https://bugzilla.mozilla.org/show_bug.cgi?id=1931080.
* Mozilla Bug 1982927, update audio_thread_priority for Android: https://bugzilla.mozilla.org/show_bug.cgi?id=1982927.
* Mozilla Bug 1637491, Android AudioWorklet test timeout: https://bugzilla.mozilla.org/show_bug.cgi?id=1637491.
* Mozilla Bug 1893939, AudioContext crackling: https://bugzilla.mozilla.org/show_bug.cgi?id=1893939.
* Mozilla Bug 2087144, unconfirmed Pixel 8a AAudio report: https://bugzilla.mozilla.org/show_bug.cgi?id=2087144.
* Mozilla Bug 1644847, allocation in AudioWorkletProcessor.process(): https://bugzilla.mozilla.org/show_bug.cgi?id=1644847.
* Chromium WebAudioLatencyHint: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/public/platform/web_audio_latency_hint.h.
* Chromium RendererWebAudioDeviceImpl: https://chromium.googlesource.com/chromium/src/+/main/content/renderer/media/renderer_webaudiodevice_impl.cc.
* Chromium AudioLatency buffer sizing: https://chromium.googlesource.com/chromium/src/+/main/media/base/audio_latency.cc.
* Chromium Android AudioManager: https://chromium.googlesource.com/chromium/src/+/main/media/audio/android/audio_manager_android.cc.
* Chromium Blink AudioDestination: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/audio/audio_destination.cc.
* Chromium issue 40133762, AudioWorklet Audio Skips / Glitches with "playback" latency on Android Chrome: https://issues.chromium.org/issues/40133762.
* Chromium issue 40170401, AudioWorklet glitches after reloading a page (Pixel devices): https://issues.chromium.org/issues/40170401.
* Chromium issue 40103372, WebAudio high latency on Android: https://issues.chromium.org/issues/40103372.
* Chromium issue 40125311, round-trip latency: https://issues.chromium.org/issues/40125311.
* GitHub Pages overview: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages.
* GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits.
* GitHub Enterprise Server Pages response headers: https://docs.github.com/en/enterprise-server@3.18/admin/configuring-settings/configuring-user-applications-for-your-enterprise/configuring-github-pages-for-your-enterprise.
* Live GitHub Pages response headers, checked 9 November 2026: https://charlesroper.github.io/C64_music/.
