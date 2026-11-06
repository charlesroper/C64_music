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

export const TELEMETRY_BUFFER_BYTES = BORDER_OFFSET + TELEMETRY_BORDER_BYTES;

const viewCache = new WeakMap();

function viewsFor(buffer) {
  let views = viewCache.get(buffer);
  if (!views) {
    views = {
      ram: new Uint8Array(buffer, RAM_OFFSET, TELEMETRY_RAM_BYTES),
      scopeData: new Float32Array(buffer, SCOPE_OFFSET, TELEMETRY_SCOPE_SAMPLES),
      sidRegs: new Uint8Array(buffer, SID_OFFSET, TELEMETRY_SID_BYTES),
      scanlineBorder: new Uint8Array(buffer, BORDER_OFFSET, TELEMETRY_BORDER_BYTES),
    };
    viewCache.set(buffer, views);
  }
  return views;
}

export function createTelemetryHeader() {
  return {
    frameCount: 0,
    cpuPc: 0,
    d418: 0,
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
    morseIndex: -1,
  };
}

export function createTelemetrySnapshot() {
  return {
    ...createTelemetryHeader(),
    sidRegs: null,
    scopeData: null,
    scanlineBorder: null,
    ram: null,
  };
}

export function packTelemetry(snapshot, buffer, header = createTelemetryHeader()) {
  const views = viewsFor(buffer);
  views.ram.set(snapshot.ram);
  views.scopeData.set(snapshot.scopeData);
  views.sidRegs.set(snapshot.sidRegs);
  views.scanlineBorder.set(snapshot.scanlineBorder);

  header.frameCount = snapshot.frameCount;
  header.cpuPc = snapshot.cpuPc;
  header.d418 = snapshot.d418;
  header.morseIndex = snapshot.morseIndex;

  for (let v = 0; v < 3; v++) {
    const source = snapshot.voices[v];
    const target = header.voices[v];
    target.freq = source.freq;
    target.pw = source.pw;
    target.ctrl = source.ctrl;
    target.env = source.env;
  }

  header.filter.fc = snapshot.filter.fc;
  header.filter.res = snapshot.filter.res;
  header.filter.rout = snapshot.filter.rout;
  header.filter.mode = snapshot.filter.mode;
  header.filter.vol = snapshot.filter.vol;

  return header;
}

export function applyTelemetry(snapshot, header, buffer) {
  const views = viewsFor(buffer);
  snapshot.frameCount = header.frameCount;
  snapshot.cpuPc = header.cpuPc;
  snapshot.d418 = header.d418;
  snapshot.morseIndex = header.morseIndex;
  snapshot.sidRegs = views.sidRegs;
  snapshot.scopeData = views.scopeData;
  snapshot.scanlineBorder = views.scanlineBorder;
  snapshot.ram = views.ram;

  for (let v = 0; v < 3; v++) {
    const source = header.voices[v];
    const target = snapshot.voices[v];
    target.freq = source.freq;
    target.pw = source.pw;
    target.ctrl = source.ctrl;
    target.env = source.env;
  }

  snapshot.filter.fc = header.filter.fc;
  snapshot.filter.res = header.filter.res;
  snapshot.filter.rout = header.filter.rout;
  snapshot.filter.mode = header.filter.mode;
  snapshot.filter.vol = header.filter.vol;

  return snapshot;
}
