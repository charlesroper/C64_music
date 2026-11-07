// ============================================================================
// Telemetry Buffer
// Packs a Telemetry Snapshot into one transferable ArrayBuffer so the audio
// thread never structured-clones screen RAM, scope samples, or SID registers.
// ============================================================================

export const TELEMETRY_RAM_BYTES = 65536;
export const TELEMETRY_SCOPE_SAMPLES = 4 * 512;
export const TELEMETRY_SID_BYTES = 32;
export const TELEMETRY_BORDER_BYTES = 312;

const RAM_OFFSET = 0;
const SCOPE_OFFSET = TELEMETRY_RAM_BYTES;
const SID_OFFSET = SCOPE_OFFSET + TELEMETRY_SCOPE_SAMPLES * 4;
const BORDER_OFFSET = SID_OFFSET + TELEMETRY_SID_BYTES;
const META_OFFSET = BORDER_OFFSET + TELEMETRY_BORDER_BYTES;
const META_FLOATS = 21;

export const TELEMETRY_BUFFER_BYTES = META_OFFSET + META_FLOATS * 4;

const viewCache = new WeakMap();

function viewsFor(buffer) {
  let views = viewCache.get(buffer);
  if (!views) {
    views = {
      ram: new Uint8Array(buffer, RAM_OFFSET, TELEMETRY_RAM_BYTES),
      scopeData: new Float32Array(buffer, SCOPE_OFFSET, TELEMETRY_SCOPE_SAMPLES),
      sidRegs: new Uint8Array(buffer, SID_OFFSET, TELEMETRY_SID_BYTES),
      scanlineBorder: new Uint8Array(buffer, BORDER_OFFSET, TELEMETRY_BORDER_BYTES),
      meta: new Float32Array(buffer, META_OFFSET, META_FLOATS),
    };
    viewCache.set(buffer, views);
  }
  return views;
}

export function createTelemetrySnapshot() {
  return {
    frameCount: 0,
    cpuPc: 0,
    d418: 0,
    sidRegs: null,
    scopeData: null,
    voices: [
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
      { freq: 0, pw: 0, ctrl: 0, env: 0 },
    ],
    filter: {
      fc: 0,
      res: 0,
      rout: 0,
      mode: 0,
      vol: 0,
    },
    scanlineBorder: null,
    ram: null,
    morseIndex: -1,
  };
}

export function packTelemetry(snapshot, buffer) {
  const views = viewsFor(buffer);
  views.ram.set(snapshot.ram);
  views.scopeData.set(snapshot.scopeData);
  views.sidRegs.set(snapshot.sidRegs);
  views.scanlineBorder.set(snapshot.scanlineBorder);

  const meta = views.meta;
  meta[0] = snapshot.frameCount;
  meta[1] = snapshot.cpuPc;
  meta[2] = snapshot.d418;
  meta[3] = snapshot.morseIndex;

  let offset = 4;
  for (let v = 0; v < 3; v++) {
    const voice = snapshot.voices[v];
    meta[offset++] = voice.freq;
    meta[offset++] = voice.pw;
    meta[offset++] = voice.ctrl;
    meta[offset++] = voice.env;
  }

  meta[offset++] = snapshot.filter.fc;
  meta[offset++] = snapshot.filter.res;
  meta[offset++] = snapshot.filter.rout;
  meta[offset++] = snapshot.filter.mode;
  meta[offset] = snapshot.filter.vol;

  return buffer;
}

export function applyTelemetry(snapshot, buffer) {
  const views = viewsFor(buffer);
  const meta = views.meta;

  snapshot.frameCount = meta[0];
  snapshot.cpuPc = meta[1];
  snapshot.d418 = meta[2];
  snapshot.morseIndex = meta[3];
  snapshot.sidRegs = views.sidRegs;
  snapshot.scopeData = views.scopeData;
  snapshot.scanlineBorder = views.scanlineBorder;
  snapshot.ram = views.ram;

  let offset = 4;
  for (let v = 0; v < 3; v++) {
    const voice = snapshot.voices[v];
    voice.freq = meta[offset++];
    voice.pw = meta[offset++];
    voice.ctrl = meta[offset++];
    voice.env = meta[offset++];
  }

  snapshot.filter.fc = meta[offset++];
  snapshot.filter.res = meta[offset++];
  snapshot.filter.rout = meta[offset++];
  snapshot.filter.mode = meta[offset++];
  snapshot.filter.vol = meta[offset];

  return snapshot;
}
