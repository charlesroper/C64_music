// ============================================================================
// Telemetry rate policy
// Default to 62.5Hz and accept 30Hz as the explicit low-rate opt-in.
// ============================================================================

export const TELEMETRY_HZ_DEFAULT = 62.5;
export const TELEMETRY_HZ_LOW = 30;

export function resolveTelemetryHz(value) {
  return Number(value) === TELEMETRY_HZ_LOW ? TELEMETRY_HZ_LOW : TELEMETRY_HZ_DEFAULT;
}

export function telemetryDividerForHz(value) {
  return resolveTelemetryHz(value) === TELEMETRY_HZ_LOW ? 2 : 1;
}
