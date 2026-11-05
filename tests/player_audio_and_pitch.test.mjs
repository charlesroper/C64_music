import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createWorkbenchPlayer,
  GAME_LOADERS,
  getSessionSourceFile,
  readWord,
  writeWord,
} from "../src/player_engine.js";
import { GAME_FILES } from "../src/tracks_catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const wasmBytes = fs.readFileSync(path.join(ROOT, "wasm/c64_engine.wasm"));
const rawSources = {};
for (const name of [
  "wizball.asm",
  "arkanoid.asm",
  "arkadrum.asm",
  "gameover.asm",
  "greenberet.asm",
  "rambload.asm",
]) {
  rawSources[name] = fs.readFileSync(path.join(ROOT, name), "latin1");
}

function makeFakeAudioContext(sampleRate = 48000) {
  return () => ({
    sampleRate,
    state: "suspended",
    destination: {},
    resume() {
      this.state = "running";
      return Promise.resolve();
    },
    createBuffer: (_ch, len, sr) => ({
      length: len,
      sampleRate: sr,
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      connect() {},
      start() {},
    }),
    createScriptProcessor: (bufferSize, inCh, outCh) => ({
      bufferSize,
      inCh,
      outCh,
      onaudioprocess: null,
      connect() {},
    }),
  });
}

async function createTestPlayer(sampleRate = 48000) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: makeFakeAudioContext(sampleRate),
    navigatorObj: { audioSession: { type: "ambient" } },
  });
}

// Measure fundamental frequency using DFT magnitude peak over [200 Hz, 1200 Hz]
function estimateFundamentalHz(samples, sampleRate, minHz = 200, maxHz = 1200) {
  const N = samples.length;
  // Remove DC mean
  let mean = 0;
  for (let i = 0; i < N; i++) mean += samples[i];
  mean /= N;

  let bestHz = 0;
  let bestMag = -1;
  // Step by 0.5 Hz for sub-Hz precision
  for (let hz = minHz; hz <= maxHz; hz += 0.5) {
    const omega = (2 * Math.PI * hz) / sampleRate;
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      // Hann window to suppress spectral leakage
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
      const x = (samples[n] - mean) * w;
      re += x * Math.cos(omega * n);
      im -= x * Math.sin(omega * n);
    }
    const mag = re * re + im * im;
    if (mag > bestMag) {
      bestMag = mag;
      bestHz = hz;
    }
  }
  return bestHz;
}

test("MOS 6581 oscillator pitch matches hardware datasheet formula across 44.1 kHz, 48 kHz, PAL, and NTSC", async () => {
  // In rambload.asm (STARTMC, lines 1233-1234), Voice 1 is programmed to:
  // $D400 = $4B, $D401 = $22 => Fn = 0x224B = 8779, Sawtooth ($21), unfiltered.
  // Independent MOS 6581 datasheet formula: f = (Fn * F_clk) / 2^24
  // PAL:  (8779 * 985248)  / 16777216 = 515.62 Hz
  // NTSC: (8779 * 1022727) / 16777216 = 535.23 Hz

  for (const { sr, ntsc, expectedHz } of [
    { sr: 44100, ntsc: false, expectedHz: 515.62 },
    { sr: 48000, ntsc: false, expectedHz: 515.62 },
    { sr: 48000, ntsc: true, expectedHz: 535.23 },
  ]) {
    const player = await createTestPlayer(sr);
    player.setHardwareOptions({ videoNtsc: ntsc });
    // Select track BEFORE play() (when default sampleRate=48000), then call play()
    // which discovers hardware sampleRate (e.g. 44100 Hz on mobile Safari).
    player.selectTrack("rambload.asm", "rambo-morse-solo", { autoPlay: false });
    player.play();

    // Find an active Morse 'dah' or 'dit' window of 2048 samples with strong amplitude
    const outL = new Float32Array(2048);
    const outR = new Float32Array(2048);
    let toneWindow = null;
    for (let block = 0; block < 20; block++) {
      player.pullAudioBlock(outL, outR);
      let rms = 0;
      for (let i = 0; i < 2048; i++) rms += outL[i] * outL[i];
      rms = Math.sqrt(rms / 2048);
      if (rms > 0.06) {
        toneWindow = new Float32Array(outL);
        break;
      }
    }

    assert.ok(toneWindow, `Expected active Morse tone window at sr=${sr}, ntsc=${ntsc}`);
    const measuredHz = estimateFundamentalHz(toneWindow, sr, 400, 650);
    assert.ok(
      Math.abs(measuredHz - expectedHz) <= 3.0,
      `Pitch mismatch at sr=${sr}, ntsc=${ntsc}: measured ${measuredHz} Hz, expected ${expectedHz} Hz`,
    );
  }
});

test("$D418 Digi-Drum synthesizer and 4-bit PCM samples produce isolated audio and respect digiBoost", async () => {
  const player = await createTestPlayer(48000);
  // arkd-title-drums-only mutes all 3 SID voices (0x07), leaving only $D418 percussion
  player.selectTrack("arkadrum.asm", "arkd-title-drums-only", { autoPlay: true });

  const outL = new Float32Array(2048);
  const outR = new Float32Array(2048);
  let peak = 0;
  for (let b = 0; b < 24; b++) {
    player.pullAudioBlock(outL, outR);
    for (let i = 0; i < 2048; i++) {
      const a = Math.abs(outL[i]);
      if (a > peak) peak = a;
    }
  }
  assert.ok(peak > 0.15, `Expected strong $D418 digi-drum signal, got peak=${peak}`);

  // Setting digiBoost to 0 must silence the isolated $D418 DAC channel
  player.setHardwareOptions({ digiBoost: 0.0 });
  // Flush 2 blocks for AC-coupling state to settle
  player.pullAudioBlock(outL, outR);
  player.pullAudioBlock(outL, outR);

  let mutedPeak = 0;
  for (let b = 0; b < 6; b++) {
    player.pullAudioBlock(outL, outR);
    for (let i = 0; i < 2048; i++) {
      const a = Math.abs(outL[i]);
      if (a > mutedPeak) mutedPeak = a;
    }
  }
  assert.ok(
    mutedPeak < 0.02,
    `Expected $D418 digi-drums to silence when digiBoost=0, got ${mutedPeak}`,
  );
});

test("pause and channel mute controls silence output deterministically", async () => {
  const player = await createTestPlayer(48000);
  player.selectTrack("wizball.asm", "wiz-title", { autoPlay: true });

  const outL = new Float32Array(2048);
  const outR = new Float32Array(2048);
  // Warm up 6 blocks
  for (let i = 0; i < 6; i++) player.pullAudioBlock(outL, outR);

  player.pause();
  outL.fill(1);
  outR.fill(1);
  player.pullAudioBlock(outL, outR);
  assert.equal(Math.max(...outL.map(Math.abs)), 0, "Paused player must output exact zero");
  assert.equal(Math.max(...outR.map(Math.abs)), 0, "Paused player must output exact zero");

  // Resume and mute all 4 channels (V1, V2, V3, Digi = 0x0F)
  player.play();
  player.setHardwareOptions({ muteMask: 0x0f });
  player.pullAudioBlock(outL, outR);
  player.pullAudioBlock(outL, outR);
  const maxMuted = Math.max(...outL.map(Math.abs));
  assert.ok(maxMuted < 0.005, `All-channels-muted output must be silent, got ${maxMuted}`);
});

test("all 73 catalog tracks and arcade SFX across all 6 .asm files produce valid AC-oscillating audio without NaN, clipping, or DC lock", async () => {
  const player = await createTestPlayer(48000);
  const outL = new Float32Array(4096);
  const outR = new Float32Array(4096);

  let verifiedCount = 0;
  for (const game of GAME_FILES) {
    for (const track of game.tracks) {
      player.selectTrack(game.id, track.id, { autoPlay: true });

      let sum = 0;
      let sumSq = 0;
      let peak = 0;
      let totalSamples = 0;
      const blocks = 24; // ~2.0 seconds at 48 kHz

      for (let b = 0; b < blocks; b++) {
        player.pullAudioBlock(outL, outR);
        for (let i = 0; i < 4096; i++) {
          const sL = outL[i];
          const sR = outR[i];
          assert.ok(
            Number.isFinite(sL) && Number.isFinite(sR),
            `Non-finite sample in ${game.id}/${track.id}`,
          );
          const a = Math.abs(sL);
          if (a > peak) peak = a;
          sum += sL;
          sumSq += sL * sL;
          totalSamples++;
        }
      }

      const mean = sum / totalSamples;
      const variance = Math.max(0, sumSq / totalSamples - mean * mean);
      const acStdDev = Math.sqrt(variance);

      assert.ok(
        peak > 0.01 && peak <= 1.05,
        `Track ${game.id}/${track.id} peak out of bounds: ${peak}`,
      );
      assert.ok(
        Math.abs(mean) < 0.15,
        `Track ${game.id}/${track.id} has excessive DC offset: ${mean}`,
      );
      assert.ok(
        acStdDev > 0.002,
        `Track ${game.id}/${track.id} lacks AC oscillation (acStdDev=${acStdDev})`,
      );
      verifiedCount++;
    }
  }

  assert.equal(verifiedCount, 73);
});

test("track catalog metadata integrity: unique IDs, valid duration hints, authentic keys, and no em-dashes", () => {
  const allIds = new Set();
  let totalTracks = 0;

  for (const game of GAME_FILES) {
    assert.ok(game.id && game.title, `Game missing id or title`);
    assert.ok(!/\u2014/.test(game.title), `Game title contains em-dash: ${game.title}`);
    assert.ok(!/\u2014/.test(game.summary), `Game summary contains em-dash`);

    for (const track of game.tracks) {
      totalTracks++;
      assert.ok(!allIds.has(track.id), `Duplicate track ID: ${track.id}`);
      allIds.add(track.id);

      assert.ok(track.name && track.name.length > 0, `Track ${track.id} has empty name`);
      assert.ok(
        track.category === "music" || track.category === "sfx",
        `Invalid category on ${track.id}`,
      );
      assert.ok(
        track.description && track.description.length > 0,
        `Track ${track.id} has empty description`,
      );

      assert.ok(!/\u2014/.test(track.name), `Track name contains em-dash: ${track.name}`);
      assert.ok(
        !/\u2014/.test(track.description),
        `Track description contains em-dash: ${track.description}`,
      );

      assert.ok(
        track.durationHint === "Loops" ||
          /^[0-9]+:[0-9]{2}(\s*\/\s*Loop)?$/.test(track.durationHint),
        `Track ${track.id} has invalid durationHint: "${track.durationHint}"`,
      );
    }
  }

  assert.equal(totalTracks, 73);

  // Wizball specific verification
  const wiz = GAME_FILES.find((g) => g.id === "wizball.asm");
  assert.ok(wiz, "wizball.asm not found in catalog");
  const filth = wiz.tracks.find((t) => t.id === "wiz-filth");
  assert.ok(filth, "wiz-filth not found");
  assert.equal(filth.key, "B");
  assert.equal(filth.durationHint, "0:05");

  const keys = wiz.tracks.map((t) => t.key).sort();
  assert.deepEqual(keys, ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]);
});

test("player engine encapsulates telemetry snapshot, reuses buffers, and removes wasm from interface", async () => {
  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, {});
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: makeFakeAudioContext(48000),
  });

  // 1. player.wasm is hidden
  assert.equal(player.wasm, undefined, "player.wasm must not be exposed on the public interface");

  // 2. getTelemetry returns pre-allocated snapshot structure
  const snap1 = player.getTelemetry();
  assert.ok(snap1, "Expected telemetry snapshot");
  assert.equal(typeof snap1.frameCount, "number");
  assert.equal(typeof snap1.cpuPc, "number");
  assert.equal(typeof snap1.d418, "number");
  assert.ok(snap1.sidRegs instanceof Uint8Array);
  assert.equal(snap1.sidRegs.length, 32);
  assert.ok(snap1.scopeData instanceof Float32Array);
  assert.equal(snap1.scopeData.length, 2048);
  assert.ok(snap1.scanlineBorder instanceof Uint8Array);
  assert.equal(snap1.scanlineBorder.length, 312);
  assert.ok(snap1.ram instanceof Uint8Array);
  assert.equal(snap1.ram.length, 65536);
  assert.equal(snap1.voices.length, 3);
  assert.equal(typeof snap1.filter.fc, "number");
  assert.equal(typeof snap1.filter.vol, "number");

  // 3. Buffer and snapshot reuse (zero per-frame allocations)
  const snap2 = player.getTelemetry();
  assert.equal(snap1, snap2, "getTelemetry must return the same reusable snapshot instance");
  assert.equal(snap1.sidRegs, snap2.sidRegs, "sidRegs buffer must be reused");
  assert.equal(snap1.scopeData, snap2.scopeData, "scopeData buffer must be reused");
  assert.equal(snap1.scanlineBorder, snap2.scanlineBorder, "scanlineBorder buffer must be reused");
  assert.equal(snap1.ram, snap2.ram, "ram view buffer must be reused");

  // 4. Switching to rambload updates morseIndex and live screen RAM
  player.selectTrack("rambload.asm", "rambo-loader");
  const snapRambo = player.getTelemetry();
  assert.ok(snapRambo.morseIndex >= 0, "rambload track must populate morseIndex");
  assert.equal(snapRambo.ram[0x0400 + 1 * 40 + 2], "R".charCodeAt(0));
});

test("game loader adapters initialize expected entry points, cycle budgets, and register states", async () => {
  // 1. GAME_LOADERS contains table entries for all 6 game IDs
  const loaderKeys = Object.keys(GAME_LOADERS).sort();
  assert.deepEqual(loaderKeys, [
    "arkadrum.asm",
    "arkanoid.asm",
    "gameover.asm",
    "greenberet.asm",
    "rambload.asm",
    "wizball.asm",
  ]);

  // 2. Shared 16-bit word helpers
  const testRam = new Uint8Array(16);
  writeWord(testRam, 4, 0x1234);
  assert.equal(testRam[4], 0x34);
  assert.equal(testRam[5], 0x12);
  assert.equal(readWord(testRam, 4), 0x1234);

  // 3. Test each loader sets expected entry point (PC) and state
  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, {});
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: makeFakeAudioContext(48000),
  });

  const wasm = instance.exports;
  const ram = player.getRamView();

  // Wizball: DLoop
  const wizAsm = player.getAssembled("wizball.asm");
  GAME_LOADERS["wizball.asm"]({ wasm, ram, track: { key: "A" }, asm: wizAsm });
  assert.equal(wasm.wasm_get_cpu_pc(), wizAsm.symbols.DLoop);

  // Arkanoid: DLoop
  const arkAsm = player.getAssembled("arkanoid.asm");
  GAME_LOADERS["arkanoid.asm"]({ wasm, ram, track: { key: "G" }, asm: arkAsm });
  assert.equal(wasm.wasm_get_cpu_pc(), arkAsm.symbols.DLoop);

  // Arkadrum: MAIN
  const drmAsm = player.getAssembled("arkadrum.asm");
  GAME_LOADERS["arkadrum.asm"]({
    wasm,
    ram,
    track: { withDrums: true, riff: "TITLEDATA", riffClk: 2, tuneY: 61 },
    asm: drmAsm,
    getAssembled: player.getAssembled,
  });
  assert.equal(wasm.wasm_get_cpu_pc(), drmAsm.symbols.MAIN);

  // GameOver (withDrums): Start
  const goAsm = player.getAssembled("gameover.asm");
  GAME_LOADERS["gameover.asm"]({ wasm, ram, track: { withDrums: true }, asm: goAsm });
  assert.equal(wasm.wasm_get_cpu_pc(), goAsm.symbols.Start);

  // GameOver (without drums): DLoop
  GAME_LOADERS["gameover.asm"]({ wasm, ram, track: { withDrums: false, key: "A" }, asm: goAsm });
  assert.equal(wasm.wasm_get_cpu_pc(), goAsm.symbols.DLoop);

  // Green Beret: START
  const gbAsm = player.getAssembled("greenberet.asm");
  GAME_LOADERS["greenberet.asm"]({ wasm, ram, track: { key: "A" }, asm: gbAsm });
  assert.equal(wasm.wasm_get_cpu_pc(), gbAsm.symbols.START);

  // Rambo: START
  const ramAsm = player.getAssembled("rambload.asm");
  GAME_LOADERS["rambload.asm"]({ wasm, ram, track: {}, asm: ramAsm });
  assert.equal(wasm.wasm_get_cpu_pc(), ramAsm.symbols.START);
});

test("player engine lazily assembles sources on demand per game", async () => {
  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, {});
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: makeFakeAudioContext(48000),
  });

  // 1. Initial construction only assembles active game (wizball.asm)
  assert.deepEqual(Object.keys(player.getAssembledCache()), ["wizball.asm"]);

  // 2. Selecting arkadrum assembles both arkadrum.asm and arkanoid.asm dependency
  player.selectTrack("arkadrum.asm", "arkd-title");
  assert.deepEqual(
    Object.keys(player.getAssembledCache()).sort(),
    ["arkadrum.asm", "arkanoid.asm", "wizball.asm"].sort(),
  );

  // 3. Other sources remain unassembled until demanded
  assert.equal(player.getAssembledCache()["greenberet.asm"], undefined);
  assert.equal(player.getAssembledCache()["gameover.asm"], undefined);
  assert.equal(player.getAssembledCache()["rambload.asm"], undefined);

  // 4. Selecting greenberet assembles greenberet.asm
  player.selectTrack("greenberet.asm", "gb-title");
  assert.ok(player.getAssembledCache()["greenberet.asm"]);
});

test("track session descriptor returns complete session for each game and track", async () => {
  const mod = await WebAssembly.compile(wasmBytes);
  const instance = await WebAssembly.instantiate(mod, {});
  const player = createWorkbenchPlayer({
    wasm: instance.exports,
    rawSources,
    createAudioContext: makeFakeAudioContext(48000),
  });

  let totalVerified = 0;
  for (const game of GAME_FILES) {
    for (const track of game.tracks) {
      const session = player.selectTrack(game.id, track.id);
      totalVerified++;

      assert.equal(session.game.id, game.id);
      assert.equal(session.track.id, track.id);

      // Primary source file: arkadrum uses arkanoid.asm for 3 SID voices
      const expectedSource = game.id === "arkadrum.asm" ? "arkanoid.asm" : game.id;
      assert.equal(session.sourceFile, expectedSource);

      // Drum availability
      const pcSyms = game.architecture?.pcSymbols || [];
      const hasDrums = Boolean(
        pcSyms.includes("seqPC") && (track.withDrums || track.drumsSolo || track.drumMode),
      );
      assert.equal(session.drum.available, hasDrums);
      assert.equal(session.drum.symbol, hasDrums ? "seqPC" : null);
      assert.equal(session.drum.sourceFile, game.id === "arkadrum.asm" ? "arkadrum.asm" : game.id);

      // getSessionSourceFile helper
      assert.equal(getSessionSourceFile(session, 0), expectedSource);
      assert.equal(getSessionSourceFile(session, 1), expectedSource);
      assert.equal(getSessionSourceFile(session, 2), expectedSource);
      if (hasDrums) {
        assert.equal(
          getSessionSourceFile(session, "seq"),
          game.id === "arkadrum.asm" ? "arkadrum.asm" : game.id,
        );
      } else {
        assert.equal(getSessionSourceFile(session, "seq"), expectedSource);
      }

      // Morse capability
      const hasMorse = game.id === "rambload.asm" || track.mode === "morse_solo";
      assert.equal(session.morse.available, hasMorse);
    }
  }

  assert.equal(totalVerified, 73);
});
