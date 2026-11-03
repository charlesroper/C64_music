# Idle Render Throttling and DOM Write Guards

Throttle display refresh to 60 Hz, bypass rendering when idle or hidden, and eliminate redundant DOM updates.

## Context

The workbench animation loop repainted the 384x272 C64 monitor canvas (about 104,000 pixels), four oscilloscope canvases, and roughly 27 telemetry DOM elements on every `requestAnimationFrame` tick. The loop lacked `document.hidden` detection, frame count comparisons, and refresh rate clamping. On 120 Hz displays, the loop ran twice as often as Galway's 50 Hz PAL audio routines required. Even when paused or backgrounded, the tab continuously redrew static canvas pixels and re-parsed identical Morse stream spans.

Additionally, rebuilding the SID register hex skeleton (`renderSidHexStripSkeleton`) set cached cell references to null without invalidating the parent telemetry container check, leaving subsequent frame updates writing to detached DOM nodes.

## Decision

1. **Document Visibility Guard**:
   Skip all canvas drawing and DOM writes when `document.hidden` is true, while keeping the `requestAnimationFrame` callback scheduled. Listen for `visibilitychange` to invalidate cached telemetry states and immediately render the first visible frame.

2. **Idle Playback Bypass**:
   When `state.player.getState().isPlaying` is false and the frame count has not changed since the previous render, take an early return idle path. This eliminates all canvas drawing (C64 screen `putImageData`, voice and filter scope strokes) and DOM updates while paused.

3. **Display Clamping**:
   Throttle `requestAnimationFrame` execution to a maximum of 60 Hz by tracking frame timestamps and skipping intermediate ticks on high-refresh (120 Hz or 144 Hz) displays.

4. **Telemetry and Morse Change Guards**:
   Guard every telemetry element (`tel-frame`, `tel-pc`, `tel-d418`, `seq-pc`, voice attributes, filter fields, SID registers, and active voice classes) with previous-value comparisons. Re-render the Morse banner only when the decoded character index (`MWK >> 1`) advances.

5. **Skeleton Cache Reconnection**:
   Update `getDom()` to verify node connectivity via `isNodeConnected` and recreate cached cell references whenever `sidCells` is null. When `renderSidHexStripSkeleton()` rebuilds the DOM elements, reset `lastSidRegs` to force the newly mounted cells to update on the next frame.

## Consequences

Idle CPU consumption drops to near zero when paused or backgrounded. Redundant DOM mutations are eliminated across consecutive identical frames. 120 Hz displays no longer execute duplicate canvas draws for 50 Hz PAL content.
