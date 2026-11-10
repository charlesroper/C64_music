// ============================================================================
// Latency hint policy
// Accept only the two product modes. A URL override wins for one load, then
// the stored choice, then the playback default.
// ============================================================================

export const AUDIO_MODE_DEFAULT = "playback";
export const AUDIO_MODE_STORAGE_KEY = "galway2664.audioMode.v1";

export function normalizeAudioMode(value) {
  if (value === "playback" || value === "interactive") return value;
  return null;
}

export function resolveLatencyHint(value) {
  return normalizeAudioMode(value) ?? AUDIO_MODE_DEFAULT;
}

export function readStoredAudioMode(win) {
  try {
    return normalizeAudioMode(win?.localStorage?.getItem(AUDIO_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredAudioMode(win, mode) {
  const normalized = normalizeAudioMode(mode);
  if (!normalized) return false;
  try {
    const storage = win?.localStorage;
    if (!storage) return false;
    storage.setItem(AUDIO_MODE_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function resolveAudioMode({ override = null, window: win = null } = {}) {
  return normalizeAudioMode(override) ?? readStoredAudioMode(win) ?? AUDIO_MODE_DEFAULT;
}
