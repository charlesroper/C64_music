import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTelemetry,
  createTelemetrySnapshot,
  packTelemetry,
  TELEMETRY_BUFFER_BYTES,
} from "../src/telemetry_buffer.js";

function makeSnapshot(seed) {
  const snapshot = createTelemetrySnapshot();
  snapshot.ram = new Uint8Array(65536);
  snapshot.scopeData = new Float32Array(2048);
  snapshot.sidRegs = new Uint8Array(32);
  snapshot.scanlineBorder = new Uint8Array(312);

  for (let i = 0; i < snapshot.ram.length; i++) snapshot.ram[i] = (i + seed) & 0xff;
  for (let i = 0; i < snapshot.scopeData.length; i++) snapshot.scopeData[i] = (i + seed) / 1000;
  for (let i = 0; i < snapshot.sidRegs.length; i++) snapshot.sidRegs[i] = (i + seed) & 0xff;
  for (let i = 0; i < snapshot.scanlineBorder.length; i++) {
    snapshot.scanlineBorder[i] = (i + seed) & 0xff;
  }

  snapshot.frameCount = 1000 + seed;
  snapshot.cpuPc = 0x1234 + seed;
  snapshot.d418 = 7;
  snapshot.morseIndex = 3 + seed;
  snapshot.voices[0] = { freq: 100 + seed, pw: 200, ctrl: 3, env: 4 };
  snapshot.voices[1] = { freq: 101 + seed, pw: 201, ctrl: 2, env: 5 };
  snapshot.voices[2] = { freq: 102 + seed, pw: 202, ctrl: 1, env: 6 };
  snapshot.filter = { fc: 300 + seed, res: 2, rout: 3, mode: 4, vol: 5 };
  return snapshot;
}

test("telemetry buffer round-trips screen RAM, scope, SID registers, voices, and filter", () => {
  const source = makeSnapshot(11);
  const buffer = new ArrayBuffer(TELEMETRY_BUFFER_BYTES);
  const header = packTelemetry(source, buffer);

  assert.equal(buffer.byteLength, TELEMETRY_BUFFER_BYTES);
  assert.equal(header.ram, undefined);
  assert.equal(header.frameCount, 1011);

  const restored = createTelemetrySnapshot();
  applyTelemetry(restored, header, buffer);

  assert.equal(restored.frameCount, 1011);
  assert.equal(restored.cpuPc, 0x123f);
  assert.equal(restored.ram.length, 65536);
  assert.equal(restored.ram[0], 11);
  assert.equal(restored.ram[65535], (65535 + 11) & 0xff);
  assert.equal(restored.scopeData.length, 2048);
  assert.ok(Math.abs(restored.scopeData[100] - 111 / 1000) < 1e-6);
  assert.equal(restored.sidRegs[3], 14);
  assert.equal(restored.scanlineBorder[5], 16);
  assert.equal(restored.voices[0].freq, 111);
  assert.equal(restored.voices[2].env, 6);
  assert.equal(restored.filter.fc, 311);
});

test("telemetry buffer reuse overwrites every field without stale data", () => {
  const first = makeSnapshot(1);
  const second = makeSnapshot(200);
  const buffer = new ArrayBuffer(TELEMETRY_BUFFER_BYTES);

  const firstHeader = packTelemetry(first, buffer);
  const restored = createTelemetrySnapshot();
  applyTelemetry(restored, firstHeader, buffer);
  assert.equal(restored.ram[10], 11);
  assert.equal(restored.frameCount, 1001);

  const secondHeader = packTelemetry(second, buffer);
  applyTelemetry(restored, secondHeader, buffer);
  assert.equal(restored.ram[10], 210);
  assert.equal(restored.frameCount, 1200);
  assert.equal(restored.voices[0].freq, 300);
  assert.equal(restored.filter.fc, 500);
});
