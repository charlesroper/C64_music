---
status: accepted
---

# Playback as the Default Audio Mode

Default Audio Mode to `PLAYBACK`. Keep `INTERACTIVE` as a remembered opt-in.

## Context

On the Samsung Galaxy A16 test device, Chromium `INTERACTIVE` reported about 16ms of output delay and popped. Chromium `PLAYBACK` reported about 192ms and played cleanly. Firefox discards `latencyHint` and needs its own buffer preference.

`latencyHint` is advisory by specification. A browser may ignore or clamp it. Device speed is not the only factor: browser build, Android audio path, power saving, Bluetooth and CPU load all affect whether a small buffer underruns.

The two failure modes are not equal. A default that crackles damages the first impression and may make the app appear broken. A default that waits about 0.2 seconds is recoverable with one switch. The delayed source follow is also a separate problem with a separate visual fix.

## Decision

- Default to `PLAYBACK` when there is no URL override and no stored choice.
- Keep a stored `INTERACTIVE` choice interactive.
- Keep the load order: URL override, stored choice, default.
- Keep the existing storage key and the existing URL values.
- Do not add device detection or adaptive switching.
- Keep latency compensation out of this decision. Prototype it separately if the visual lead becomes a problem.

## Considered Options

- **Default to `INTERACTIVE`**: rejected. It bets on unknown device performance and makes audible crackles the first-run experience.
- **Detect the device or browser**: rejected. The signals are unreliable, and the hint can be ignored.
- **Default to playback and add compensation immediately**: rejected as a single change. The default is useful on its own; compensation needs its own prototype and measurements.

## Consequences

- New listeners get clean audio by default.
- Listeners who chose interactive keep their choice.
- The source follow leads the sound by about 0.2 seconds in playback mode. This is documented and can be addressed separately.
- The explainers and Stats help must describe playback as the default.
- The Firefox buffer workaround remains separate from the app setting.
