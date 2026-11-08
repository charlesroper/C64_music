import { createC64ScreenRenderer } from "./c64_screen.js";

const SCREEN_COLS = 40;
const CURSOR_CHAR = 0xa0;
const DEFAULT_TARGET = {
  gameId: "wizball.asm",
  trackId: "wiz-title",
  title: "WIZBALL",
};

export const BOOT_PHASES = {
  IDLE: "idle",
  POWER_ON: "power-on",
  BASIC: "basic",
  TYPING: "typing",
  GATE: "gate",
  LOADING: "loading",
  READY: "ready",
  COLLAPSING: "collapsing",
  COMPLETE: "complete",
};

const PHASE_TEXT = {
  [BOOT_PHASES.POWER_ON]: "Commodore 64 power on",
  [BOOT_PHASES.BASIC]: "Commodore 64 BASIC V2 ready",
  [BOOT_PHASES.TYPING]: "Typing the load command",
  [BOOT_PHASES.GATE]: "Press play on tape to start Wizball",
  [BOOT_PHASES.LOADING]: "Loading Wizball",
  [BOOT_PHASES.READY]: "Wizball ready",
  [BOOT_PHASES.COLLAPSING]: "Starting the workbench",
  [BOOT_PHASES.COMPLETE]: "Boot complete",
};

function writeText(screenRam, colorRam, row, col, text, color) {
  const base = row * SCREEN_COLS + col;
  for (let i = 0; i < text.length && col + i < SCREEN_COLS; i++) {
    screenRam[base + i] = text.charCodeAt(i);
    colorRam[base + i] = color;
  }
}

function clearText(screenRam, colorRam, row, col, count, color) {
  const base = row * SCREEN_COLS + col;
  for (let i = 0; i < count && col + i < SCREEN_COLS; i++) {
    screenRam[base + i] = 0x20;
    colorRam[base + i] = color;
  }
}

export function createBootSequence({
  document: doc,
  target = DEFAULT_TARGET,
  reducedMotion = false,
  skip = false,
  tapeSound = null,
  onPhase = () => {},
  onGate = () => {},
  onComplete = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (id) => clearInterval(id),
  animationDuration = 500,
} = {}) {
  if (!doc) return null;

  const overlay = doc.getElementById("boot-sequence");
  const frame = doc.getElementById("boot-frame");
  const canvas = doc.getElementById("boot-canvas");
  const hint = doc.getElementById("boot-hint");
  const live = doc.getElementById("boot-live");
  const monitor = doc.getElementById("c64-monitor-canvas");
  if (!overlay || !frame || !canvas) return null;

  const renderer = createC64ScreenRenderer(canvas);
  const screenRam = new Uint8Array(1000);
  const colorRam = new Uint8Array(1000);
  const border = new Uint8Array(312);
  const timers = new Set();
  let cursorTimer = null;
  let cursorVisible = true;
  let cursorRow = 6;
  let cursorCol = 0;
  let pendingCompletion = null;
  let loadScheduled = false;
  let loaderTimer = null;
  let loaderTick = 0;
  let loaderMinimumElapsed = false;

  const state = {
    phase: BOOT_PHASES.IDLE,
    ready: false,
    gateActive: false,
    completed: false,
    autoPlay: false,
    reason: null,
  };

  function setPhase(phase) {
    state.phase = phase;
    if (live) live.textContent = PHASE_TEXT[phase] || "";
    onPhase(phase);
  }

  function later(fn, ms) {
    const id = schedule(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function clearTimers() {
    for (const id of timers) cancel(id);
    timers.clear();
  }

  function startBlink() {
    if (cursorTimer !== null) return;
    cursorTimer = setIntervalFn(() => {
      if (state.completed) return;
      cursorVisible = !cursorVisible;
      render();
    }, 500);
  }

  function stopBlink() {
    if (cursorTimer === null) return;
    clearIntervalFn(cursorTimer);
    cursorTimer = null;
  }

  function render(background = 6) {
    if (!renderer) return;
    const cursorIndex = cursorRow * SCREEN_COLS + cursorCol;
    const showCursor =
      cursorVisible &&
      (state.phase === BOOT_PHASES.BASIC ||
        state.phase === BOOT_PHASES.TYPING ||
        state.phase === BOOT_PHASES.GATE);
    let previous = 0;
    if (showCursor) {
      previous = screenRam[cursorIndex];
      screenRam[cursorIndex] = CURSOR_CHAR;
    }
    renderer.render({ screenRam, colorRam, border, background });
    if (showCursor) screenRam[cursorIndex] = previous;
  }

  function resetScreen(textColor, background, borderColor) {
    screenRam.fill(0x20);
    colorRam.fill(textColor);
    border.fill(borderColor);
    render(background);
  }

  function drawBasicScreen() {
    resetScreen(14, 6, 14);
    writeText(screenRam, colorRam, 1, 4, "**** COMMODORE 64 BASIC V2 ****", 14);
    writeText(screenRam, colorRam, 3, 1, "64K RAM SYSTEM  38911 BASIC BYTES FREE", 14);
    writeText(screenRam, colorRam, 5, 0, "READY.", 14);
    cursorRow = 6;
    cursorCol = 0;
    render(6);
  }

  function writeCentered(row, text, color) {
    const col = Math.max(0, Math.floor((SCREEN_COLS - text.length) / 2));
    writeText(screenRam, colorRam, row, col, text, color);
  }

  function drawLoaderScreen() {
    const progress = Math.min(1, (loaderTick + 1) / 20);
    screenRam.fill(0x20);
    colorRam.fill(14);
    border.fill(0);

    for (let line = 0; line < border.length; line++) {
      border[line] = [0, 6, 14, 3, 7][(line + loaderTick) % 5];
    }

    writeCentered(2, "GALWAY 2664", 7);
    writeCentered(4, "WIZBALL", 14);
    writeCentered(6, "MARTIN GALWAY", 14);
    writeCentered(7, "OCEAN SOFTWARE", 14);
    writeCentered(10, "LOADING", 7);
    writeCentered(12, `BLOCK ${String(loaderTick * 5).padStart(3, "0")}`, 3);

    const barLength = Math.round(progress * 30);
    for (let i = 0; i < barLength; i++) {
      screenRam[14 * SCREEN_COLS + 5 + i] = 0xa0;
      colorRam[14 * SCREEN_COLS + 5 + i] = 13;
    }
    render(0);
  }

  function startLoader() {
    loaderTick = 0;
    drawLoaderScreen();
    if (loaderTimer !== null) clearIntervalFn(loaderTimer);
    loaderTimer = setIntervalFn(() => {
      if (state.completed || state.phase !== BOOT_PHASES.LOADING) return;
      loaderTick++;
      drawLoaderScreen();
    }, 120);
    later(() => {
      loaderMinimumElapsed = true;
      maybeFinishLoad();
    }, 2400);
  }

  function stopLoader() {
    if (loaderTimer !== null) {
      clearIntervalFn(loaderTimer);
      loaderTimer = null;
    }
  }

  function typeLoadCommand(index) {
    if (state.completed) return;
    const command = 'LOAD""';
    if (index < command.length) {
      writeText(screenRam, colorRam, 6, index, command[index], 14);
      cursorRow = 6;
      cursorCol = index + 1;
      render(6);
      later(() => typeLoadCommand(index + 1), 80);
      return;
    }
    later(showGate, 300);
  }

  function showGate() {
    if (state.completed) return;
    clearText(screenRam, colorRam, 7, 0, 40, 14);
    writeText(screenRam, colorRam, 7, 0, "PRESS PLAY ON TAPE", 14);
    cursorRow = 7;
    cursorCol = 18;
    setPhase(BOOT_PHASES.GATE);
    render(6);
    later(() => {
      if (state.phase !== BOOT_PHASES.GATE || state.completed) return;
      hint?.classList.remove("hidden");
      if (live) live.textContent = "Press play on tape. Click or press any key to start.";
    }, 600);
  }

  function hideHint() {
    hint?.classList.add("hidden");
  }

  function maybeFinishLoad() {
    if (!state.gateActive || state.phase !== BOOT_PHASES.LOADING || !state.ready) return;
    if (!loaderMinimumElapsed || loadScheduled) return;
    loadScheduled = true;
    later(finishLoad, 300);
  }

  function activateGate() {
    if (state.gateActive || state.completed) return;
    state.gateActive = true;
    hideHint();
    setPhase(BOOT_PHASES.LOADING);
    loadScheduled = false;
    loaderMinimumElapsed = false;
    try {
      onGate({ target });
    } catch (_) {}
    if (tapeSound && typeof tapeSound.start === "function") tapeSound.start();
    startLoader();
    maybeFinishLoad();
  }

  function finishLoad() {
    if (state.completed) return;
    loadScheduled = false;
    stopLoader();
    if (tapeSound && typeof tapeSound.stop === "function") tapeSound.stop();
    resetScreen(14, 6, 14);
    writeCentered(12, "READY.", 14);
    setPhase(BOOT_PHASES.READY);
    render(6);
    later(collapse, 500);
  }

  function collapse() {
    if (state.completed) return;
    setPhase(BOOT_PHASES.COLLAPSING);
    stopBlink();
    const targetRect = monitor?.getBoundingClientRect?.();
    if (targetRect && typeof frame.animate === "function") {
      const start = frame.getBoundingClientRect();
      frame.style.position = "fixed";
      frame.style.left = `${start.left}px`;
      frame.style.top = `${start.top}px`;
      frame.style.width = `${start.width}px`;
      frame.style.height = `${start.height}px`;
      frame.style.margin = "0";
      const animation = frame.animate(
        [
          {
            left: `${start.left}px`,
            top: `${start.top}px`,
            width: `${start.width}px`,
            height: `${start.height}px`,
          },
          {
            left: `${targetRect.left}px`,
            top: `${targetRect.top}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
          },
        ],
        { duration: animationDuration, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
      Promise.resolve(animation.finished).then(
        () => complete({ autoPlay: true, reason: "gate" }),
        () => complete({ autoPlay: true, reason: "gate" }),
      );
      return;
    }
    later(() => complete({ autoPlay: true, reason: "gate" }), 0);
  }

  function complete({ autoPlay, reason }) {
    if (state.completed) return;
    state.completed = true;
    state.autoPlay = Boolean(autoPlay);
    state.reason = reason;
    clearTimers();
    stopBlink();
    stopLoader();
    if (tapeSound && typeof tapeSound.stop === "function") tapeSound.stop();
    removeInputListeners();
    hideHint();
    setPhase(BOOT_PHASES.COMPLETE);
    try {
      onComplete({ target, autoPlay: state.autoPlay, reason });
    } finally {
      overlay.classList.add("hidden");
      delete doc.body.dataset.bootState;
    }
  }

  function requestComplete({ autoPlay, reason }) {
    if (state.completed) return;
    if (autoPlay && !state.ready) {
      pendingCompletion = { autoPlay, reason };
      setPhase(BOOT_PHASES.LOADING);
      writeText(screenRam, colorRam, 8, 0, "LOADING...", 14);
      render(6);
      return;
    }
    complete({ autoPlay, reason });
  }

  function handleInput(event) {
    if (state.completed) return;
    event.preventDefault?.();
    if (state.phase === BOOT_PHASES.GATE) {
      activateGate();
      return;
    }
    requestComplete({ autoPlay: true, reason: "skip" });
  }

  function removeInputListeners() {
    if (typeof doc.removeEventListener !== "function") return;
    doc.removeEventListener("pointerdown", handleInput, true);
    doc.removeEventListener("keydown", handleInput, true);
  }

  function start() {
    if (state.phase !== BOOT_PHASES.IDLE) return;
    if (reducedMotion || skip) {
      complete({ autoPlay: false, reason: reducedMotion ? "reduced-motion" : "skip" });
      return;
    }

    overlay.classList.remove("hidden");
    doc.body.dataset.bootState = "booting";
    if (typeof doc.addEventListener === "function") {
      doc.addEventListener("pointerdown", handleInput, true);
      doc.addEventListener("keydown", handleInput, true);
    }
    setPhase(BOOT_PHASES.POWER_ON);
    resetScreen(14, 14, 14);
    later(() => {
      drawBasicScreen();
      setPhase(BOOT_PHASES.BASIC);
      startBlink();
      later(() => {
        setPhase(BOOT_PHASES.TYPING);
        typeLoadCommand(0);
      }, 600);
    }, 120);
  }

  function skipBoot(options = {}) {
    requestComplete({ autoPlay: options.autoPlay ?? true, reason: options.reason || "skip" });
  }

  function setReady() {
    state.ready = true;
    if (pendingCompletion) {
      const pending = pendingCompletion;
      pendingCompletion = null;
      complete(pending);
      return;
    }
    maybeFinishLoad();
  }

  function destroy() {
    if (state.completed) return;
    state.completed = true;
    clearTimers();
    stopBlink();
    stopLoader();
    if (tapeSound && typeof tapeSound.stop === "function") tapeSound.stop();
    removeInputListeners();
    hideHint();
    overlay.classList.add("hidden");
    delete doc.body.dataset.bootState;
  }

  return {
    start,
    skip: skipBoot,
    setReady,
    destroy,
    getState: () => ({ ...state }),
  };
}
