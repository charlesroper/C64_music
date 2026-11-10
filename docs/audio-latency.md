# Audio delay and clean playback

This page explains why audio sometimes pops and how to make playback clean in Chromium and Firefox on Android. It assumes no prior knowledge of audio buffers.

## What the buffer does

Audio plays in small slices. The browser keeps a queue of slices ready so the audio thread can recover from a short delay. That queue is the buffer.

A small buffer gives low delay. The phone must refill it often. If the phone is late, the queue empties and you hear a pop.

A large buffer gives the phone more time. The queue is less likely to empty. The trade-off is that you hear the sound later.

## What `out` means in Stats

`out` is the total delay between the app producing a sound and the speaker playing it. It includes the browser buffer and the phone audio pipeline.

`out` is not the callback buffer size. A 4096-frame Firefox batch is about 85ms of audio, but Stats can report `out` around 190ms because the phone adds more buffering.

## Measured results

Measurements come from a Samsung Galaxy A16 using Firefox Nightly and Chromium 153. Results vary by device, Android version and browser build. A faster device may play cleanly with a smaller buffer.

| Browser and mode | `out` | Result |
| --- | --- | --- |
| Chromium playback | about 192ms | clean |
| Chromium interactive | about 16ms | pops |
| Firefox default | about 11ms | pops |
| Firefox, 2048-frame buffer | about 11ms | pops |
| Firefox, 4096-frame buffer | about 190ms | clean |

The pattern is consistent. On the test device, about 190ms is clean and about 11ms to 16ms pops, in both browsers.

## Chromium

The app defaults to **AUDIO MODE** `INTERACTIVE`. It lowers the delay to about 16ms and keeps the source follow closer to the sound. It popped on the test device. Switch to `PLAYBACK` when you want clean audio.

`PLAYBACK` uses a large buffer. It reports about 192ms and played cleanly in testing. That is the safer choice on a low-end device, and the app remembers your choice.

Switching Audio Mode restarts the current track.

## Firefox

Firefox ignores the Audio Mode switch. `latencyHint` is not in Firefox's WebIDL, so the browser discards it. MediaTrackGraph asks the audio backend for minimum latency. The app cannot request a larger buffer through Web Audio.

On Android, the audio backend has a hard mode switch at 4,000 frames. A requested buffer of 4,000 frames or less stays in low-latency mode. The buffer does not grow with the request. A value above 4,000 frames selects the deep-buffer path.

That is why `2048` did nothing and `4096` worked on the test device. `4096` crosses the threshold.

### Firefox Beta and Nightly

1. Open `about:config`.
2. Tap the **+** button.
3. Add `media.cubeb_latency_mtg_frames` as a **Number**.
4. Set the value to `4096`.
5. Force-stop Firefox and reopen it.
6. Open the app and Stats. Confirm `out` is around 190ms.
7. Play for two minutes and listen for pops.

A value of `2048` did not help in testing. `out` stayed around 11ms and the pops remained.

After you add the preference, search for `mtg` in `about:config` to confirm it is there.

### Firefox stable

`about:config` is hidden in Stable. The same editor may open at `chrome://geckoview/content/config.xhtml`. This route is unsupported and can change between builds. Test it before relying on it. If it does not open, use Chromium playback or install Firefox Beta or Nightly.

Firefox is adding `latencyHint` support in [Bug 2020377](https://bugzilla.mozilla.org/show_bug.cgi?id=2020377). When it lands, `PLAYBACK` may work on Firefox without this preference. It has not landed yet.

The [Firefox latencyHint research](research/firefox-audiocontext-latencyhint.md) records the source links for the WebIDL, MediaTrackGraph, Android threshold and `about:config` findings.

## What the setting means

`media.cubeb_latency_mtg_frames` is Firefox's internal audio batch size.

| Part | Meaning |
| --- | --- |
| `media` | Firefox's media system. |
| `cubeb` | Firefox's audio backend. The layer that talks to Android audio. |
| `latency` | Delay. How long sound waits before it is played. |
| `mtg` | MediaTrackGraph. Firefox's internal audio graph that schedules Web Audio work. |
| `frames` | Slices of sound, not milliseconds. |

At 48kHz:

- 48 frames last 1ms.
- 128 frames last about 2.67ms. That is one Web Audio quantum.
- 2048 frames last about 43ms.
- 4096 frames last about 85ms.

The preference is hidden by default. Firefox does not list it until you add it.

The app cannot set this preference. It is a browser setting.

## Why late blocks are not always audible

Stats calls a callback late when it takes longer than 2.67ms. With a small buffer, a late callback can empty the queue and pop. With a large buffer, the phone has time to recover.

That is why a clean 4096-frame run can still show late blocks. In testing, the 4096-frame run showed `late total 87` and `late peak 6`, with no audible pops. The late counter measures missed headroom, not whether you heard a pop.

## The trade-off

Clean playback on the test device needs a large buffer. The cost is about 190ms of output delay.

That delay is noticeable when the source viewer follows a voice. The highlight leads the sound by roughly the same amount. For music listening, clean playback is usually the better choice.

If you need low latency, Chromium `INTERACTIVE` gives about 16ms, with pops on low-end devices. Firefox default is about 11ms, also with pops.

## If pops continue

- Close CPU-heavy apps before listening.
- Disable battery saver.
- Try Chromium `PLAYBACK` to confirm the app path is clean.
- If Firefox with `4096` still pops, the device cannot keep up even with the deep-buffer path.

## Related documentation

- `README.md` gives the short setup steps.
- `docs/agents/browser-verification.md` gives the test procedure.
- `docs/research/firefox-audioworklet-tail.md` records the browser research and the empirical result.
- `docs/research/firefox-audiocontext-latencyhint.md` records the sourced `latencyHint`, MediaTrackGraph and Android threshold research.
