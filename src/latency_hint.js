// ============================================================================
// Latency hint policy
// Accept the stable modes plus the debug-only numeric hints 0.1 and 0.2.
// ============================================================================

export function resolveLatencyHint(value) {
  if (value === "playback" || value === "balanced" || value === "interactive") return value;
  if (value === "0.1" || value === 0.1) return 0.1;
  if (value === "0.2" || value === 0.2) return 0.2;
  return "playback";
}
