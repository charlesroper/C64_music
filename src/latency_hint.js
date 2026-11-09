// ============================================================================
// Latency hint policy
// Accept the stable modes plus the debug-only numeric hints 0.1 and 0.2.
// ============================================================================

const NUMERIC_HINTS = new Set([0.1, 0.2]);

export function resolveLatencyHint(value) {
  if (value === "playback" || value === "balanced" || value === "interactive") return value;
  const numeric = Number(value);
  if (NUMERIC_HINTS.has(numeric)) return numeric;
  return "playback";
}
