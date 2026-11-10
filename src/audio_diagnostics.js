// ============================================================================
// Stats for Nerds overlay
// Toggled by the header button or ?audioDebug=1. Shows process timing, missed
// audio quanta, context state changes, and output latency on the phone.
// ============================================================================

import { TELEMETRY_HZ_DEFAULT } from "./telemetry_rate.js";

const HELP_INTRO =
  "A window is about one second. Window values reset every second. Session peaks last until reload. Use peak when a spike has already passed. The README explains the Firefox Nightly buffer setting.";

const HEALTH = {
  NORMAL: "normal",
  PRESSURE: "pressure",
  BAD: "bad",
};

const HEALTH_LABELS = [
  [HEALTH.NORMAL, "normal"],
  [HEALTH.PRESSURE, "under pressure"],
  [HEALTH.BAD, "bad"],
];

function classifyMs(microseconds, normalMaxMs, pressureMaxMs) {
  if (!Number.isFinite(microseconds)) return null;
  return classifyMilliseconds(microseconds / 1000, normalMaxMs, pressureMaxMs);
}

function classifyMilliseconds(milliseconds, normalMaxMs, pressureMaxMs) {
  if (!Number.isFinite(milliseconds)) return null;
  if (milliseconds < normalMaxMs) return HEALTH.NORMAL;
  if (milliseconds <= pressureMaxMs) return HEALTH.PRESSURE;
  return HEALTH.BAD;
}

function classifyCount(value, pressureMax) {
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return HEALTH.NORMAL;
  if (value <= pressureMax) return HEALTH.PRESSURE;
  return HEALTH.BAD;
}

function classifyAnyPositiveAsBad(value) {
  if (!Number.isFinite(value)) return null;
  return value > 0 ? HEALTH.BAD : HEALTH.NORMAL;
}

function classifyLatency(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const milliseconds = seconds * 1000;
  if (milliseconds >= 30) return HEALTH.NORMAL;
  if (milliseconds >= 15) return HEALTH.PRESSURE;
  return HEALTH.BAD;
}

function classifyContext(state) {
  if (state === "running") return HEALTH.NORMAL;
  if (state === "suspended") return HEALTH.PRESSURE;
  return HEALTH.BAD;
}

function classifyBackend(backend) {
  if (backend === "worklet") return HEALTH.NORMAL;
  if (backend === "in-thread") return HEALTH.PRESSURE;
  return HEALTH.BAD;
}

const GROUPS = [
  {
    id: "context",
    title: "CONTEXT",
    description: "What browser and audio setup is running.",
    items: [
      ["backend", "backend", "Audio engine in use. Worklet is normal playback."],
      ["ctx", "ctx", "Browser audio state. Running means sound can play."],
      ["rate", "rate", "Audio sample rate in Hz."],
      [
        "telemetry",
        "telemetry",
        "How often screen and scope updates arrive. OFF means snapshots are stopped.",
      ],
    ],
    health: {
      backend: (diagnostics) => classifyBackend(diagnostics.backend),
      ctx: (diagnostics) => classifyContext(diagnostics.contextState),
    },
  },
  {
    id: "latency",
    title: "LATENCY",
    description:
      "Output delay and buffer hints. A larger buffer is safer but adds delay. Chromium playback and Firefox Nightly with a 4096-frame buffer are the clean options in testing.",
    items: [
      [
        "mode",
        "mode",
        "Browser buffer hint. Interactive is the default and lowers delay, but can pop on low-end devices. Playback uses a larger buffer and is safer. Firefox ignores this hint.",
      ],
      ["base", "base", "Browser-reported base latency. Firefox usually reports 0ms."],
      [
        "out",
        "out",
        "Total delay before you hear sound, not the callback buffer. Chromium playback is about 192ms, Chromium interactive about 16ms, Firefox default about 11ms. Low values can pop. Firefox Nightly with a 4096-frame buffer is about 190ms and clean.",
      ],
    ],
    health: {
      out: (diagnostics) => classifyLatency(diagnostics.outputLatency),
    },
  },
  {
    id: "process",
    title: "PROCESS (ms)",
    description: "How long audio callbacks and main-thread frames take.",
    items: [
      ["p50", "p50", "Half of audio callbacks were faster than this."],
      ["p95", "p95", "95% of audio callbacks were faster. A near-worst case."],
      ["p99", "p99", "99% of audio callbacks were faster. The worst 1%."],
      ["max", "max", "Slowest audio callback in the current window."],
      ["peak", "peak", "Slowest audio callback since page load."],
      ["budget", "budget", "Time available for one callback, about 2.67ms."],
      [
        "renderMax",
        "render max",
        "Audio rendering time in the current window. Includes telemetry copy.",
      ],
      [
        "renderPeak",
        "render peak",
        "Slowest audio rendering since page load. Includes telemetry copy.",
      ],
      ["packMax", "pack max", "Telemetry copy time in the current window."],
      ["packPeak", "pack peak", "Slowest telemetry copy since page load."],
      ["postMax", "post max", "Telemetry handoff time in the current window."],
      ["postPeak", "post peak", "Slowest telemetry handoff since page load."],
      ["gainMax", "gain max", "Volume ramp time in the current window."],
      ["gainPeak", "gain peak", "Slowest volume ramp since page load."],
      ["frameP50", "frame p50", "Half of rendered frames did less main-thread work."],
      ["frameP95", "frame p95", "95% of rendered frames did less main-thread work."],
      ["frameMax", "frame max", "Slowest rendered frame in the current frame window."],
      ["framePeak", "frame peak", "Slowest rendered frame since page load."],
      ["frameCalls", "frames", "Rendered frames in the current frame window. 60 means full."],
    ],
    health: {
      p50: (diagnostics) => classifyMs(diagnostics.p50Us, 0.5, 1.5),
      p95: (diagnostics) => classifyMs(diagnostics.p95Us, 1, 2.67),
      p99: (diagnostics) => classifyMs(diagnostics.p99Us, 1.5, 2.67),
      max: (diagnostics) => classifyMs(diagnostics.maxUs, 2.67, 5),
      peak: (diagnostics) => classifyMs(diagnostics.processPeakUs, 5, 10),
      packMax: (diagnostics) => classifyMs(diagnostics.packTelemetryMaxUs, 0.5, 2),
      packPeak: (diagnostics) => classifyMs(diagnostics.packTelemetryPeakUs, 1, 4),
      postMax: (diagnostics) => classifyMs(diagnostics.postMessageMaxUs, 0.5, 2),
      postPeak: (diagnostics) => classifyMs(diagnostics.postMessagePeakUs, 1, 4),
      gainMax: (diagnostics) => classifyMs(diagnostics.applyGainMaxUs, 0.25, 1),
      gainPeak: (diagnostics) => classifyMs(diagnostics.applyGainPeakUs, 0.25, 1),
      frameP50: (diagnostics) => classifyMilliseconds(diagnostics.frameP50Ms, 4, 8),
      frameP95: (diagnostics) => classifyMilliseconds(diagnostics.frameP95Ms, 8, 16),
      frameMax: (diagnostics) => classifyMilliseconds(diagnostics.frameMaxMs, 16, 33),
      framePeak: (diagnostics) => classifyMilliseconds(diagnostics.framePeakMs, 33, 50),
    },
  },
  {
    id: "deadlines",
    title: "DEADLINES",
    description: "Audio work that missed its deadline.",
    items: [
      ["lateTotal", "late total", "Audio callbacks over budget since page load."],
      [
        "lateWindow",
        "late window",
        "Over-budget callbacks in the current window, out of the callback count.",
      ],
      ["latePeak", "late peak", "Worst window count since page load."],
      ["missedTotal", "missed total", "Whole audio blocks skipped since page load."],
      ["missedWindow", "missed window", "Whole audio blocks skipped in the current window."],
      ["missedPeak", "missed peak", "Worst skipped-block count in a window since page load."],
    ],
    health: {
      lateWindow: (diagnostics) => classifyCount(diagnostics.lateWindow, 2),
      latePeak: (diagnostics) => classifyCount(diagnostics.latePeakWindow, 5),
      missedWindow: (diagnostics) => classifyAnyPositiveAsBad(diagnostics.missedWindow),
      missedPeak: (diagnostics) => classifyAnyPositiveAsBad(diagnostics.missedPeakWindow),
    },
  },
  {
    id: "telemetry",
    title: "TELEMETRY",
    description: "Health of the screen and scope update stream.",
    items: [
      [
        "dropsTotal",
        "drops total",
        "Telemetry snapshots dropped since page load. Audio is unaffected.",
      ],
      ["dropsWindow", "drops window", "Telemetry snapshots dropped in the current window."],
      [
        "dropsPeak",
        "drops peak",
        "Worst dropped telemetry snapshot count in a window since page load.",
      ],
      ["volume", "volume", "Current output gain. 1.00 is full volume."],
      ["playing", "playing", "Whether playback is requested."],
    ],
    health: {
      dropsWindow: (diagnostics) => classifyCount(diagnostics.telemetryDropWindow, 3),
      dropsPeak: (diagnostics) => classifyCount(diagnostics.telemetryDropPeakWindow, 5),
    },
  },
  {
    id: "events",
    title: "EVENTS",
    description: "Recent audio-context state changes.",
    items: [["events", "events", "Recent audio-context state changes."]],
  },
];

function formatMs(microseconds) {
  if (typeof microseconds !== "number" || !Number.isFinite(microseconds)) return "-";
  return (microseconds / 1000).toFixed(2);
}

function formatMilliseconds(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) return "-";
  return milliseconds.toFixed(2);
}

function formatLatency(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "-";
  return `${(seconds * 1000).toFixed(1)}ms`;
}

function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return String(value);
}

function formatEvents(events) {
  if (!events || events.length === 0) return "none";
  return events
    .slice(-4)
    .map((event) => event.state)
    .join(" -> ");
}

function buildHealth(diagnostics) {
  const health = {};
  for (const group of GROUPS) {
    for (const [key, classify] of Object.entries(group.health || {})) {
      health[`${group.id}:${key}`] = classify(diagnostics);
    }
  }
  return health;
}

function buildValues(diagnostics) {
  const processCalls = diagnostics.processCalls;
  const lateWindow = diagnostics.lateWindow ?? 0;
  return {
    "context:backend": diagnostics.backend || "-",
    "context:ctx": diagnostics.contextState || "-",
    "context:rate": diagnostics.sampleRate || "-",
    "context:telemetry":
      diagnostics.telemetryEnabled === false
        ? "OFF"
        : `${diagnostics.telemetryHz ?? TELEMETRY_HZ_DEFAULT}Hz`,
    "latency:mode":
      diagnostics.latencyHint !== undefined && diagnostics.latencyHint !== null
        ? String(diagnostics.latencyHint)
        : "-",
    "latency:base": formatLatency(diagnostics.baseLatency),
    "latency:out": formatLatency(diagnostics.outputLatency),
    "process:p50": formatMs(diagnostics.p50Us),
    "process:p95": formatMs(diagnostics.p95Us),
    "process:p99": formatMs(diagnostics.p99Us),
    "process:max": formatMs(diagnostics.maxUs),
    "process:peak": formatMs(diagnostics.processPeakUs),
    "process:budget": formatMs(diagnostics.budgetUs),
    "process:renderMax": formatMs(diagnostics.renderAudioMaxUs),
    "process:renderPeak": formatMs(diagnostics.renderAudioPeakUs),
    "process:packMax": formatMs(diagnostics.packTelemetryMaxUs),
    "process:packPeak": formatMs(diagnostics.packTelemetryPeakUs),
    "process:postMax": formatMs(diagnostics.postMessageMaxUs),
    "process:postPeak": formatMs(diagnostics.postMessagePeakUs),
    "process:gainMax": formatMs(diagnostics.applyGainMaxUs),
    "process:gainPeak": formatMs(diagnostics.applyGainPeakUs),
    "process:frameP50": formatMilliseconds(diagnostics.frameP50Ms),
    "process:frameP95": formatMilliseconds(diagnostics.frameP95Ms),
    "process:frameMax": formatMilliseconds(diagnostics.frameMaxMs),
    "process:framePeak": formatMilliseconds(diagnostics.framePeakMs),
    "process:frameCalls": formatCount(diagnostics.frameCalls),
    "deadlines:lateTotal": formatCount(diagnostics.lateQuanta),
    "deadlines:lateWindow":
      processCalls === undefined
        ? formatCount(lateWindow)
        : `${formatCount(lateWindow)}/${formatCount(processCalls)}`,
    "deadlines:latePeak": formatCount(diagnostics.latePeakWindow),
    "deadlines:missedTotal": formatCount(diagnostics.missedQuanta),
    "deadlines:missedWindow": formatCount(diagnostics.missedWindow),
    "deadlines:missedPeak": formatCount(diagnostics.missedPeakWindow),
    "telemetry:dropsTotal": formatCount(diagnostics.telemetryDrops),
    "telemetry:dropsWindow": formatCount(diagnostics.telemetryDropWindow),
    "telemetry:dropsPeak": formatCount(diagnostics.telemetryDropPeakWindow),
    "telemetry:volume":
      typeof diagnostics.gain === "number" && Number.isFinite(diagnostics.gain)
        ? diagnostics.gain.toFixed(2)
        : "-",
    "telemetry:playing": diagnostics.playing ? "yes" : "no",
    "events:events": formatEvents(diagnostics.contextEvents),
  };
}

function createDiagnosticsLayout(doc) {
  const element = doc.createElement("section");
  element.id = "audio-diagnostics";
  element.classList.add("audio-diagnostics");

  const header = doc.createElement("div");
  header.classList.add("diag-header");

  const title = doc.createElement("h2");
  title.classList.add("diag-title");
  title.textContent = "STATS FOR NERDS";
  header.appendChild(title);

  const helpButton = doc.createElement("button");
  helpButton.classList.add("diag-help-toggle");
  helpButton.type = "button";
  helpButton.textContent = "?";
  helpButton.setAttribute("aria-label", "Explain stats");
  helpButton.setAttribute("aria-expanded", "false");
  header.appendChild(helpButton);

  element.appendChild(header);

  const body = doc.createElement("div");
  body.classList.add("diag-body");
  element.appendChild(body);

  const intro = doc.createElement("p");
  intro.classList.add("diag-help-intro");
  intro.textContent = HELP_INTRO;
  body.appendChild(intro);

  const legend = doc.createElement("div");
  legend.classList.add("diag-health-legend");
  for (const [health, label] of HEALTH_LABELS) {
    const item = doc.createElement("span");
    item.classList.add("diag-health-legend-item");
    item.dataset.health = health;
    item.textContent = label;
    legend.appendChild(item);
  }
  body.appendChild(legend);

  const valueNodes = new Map();
  for (const group of GROUPS) {
    const groupEl = doc.createElement("div");
    groupEl.classList.add("diag-group", `diag-group--${group.id}`);

    const groupTitle = doc.createElement("div");
    groupTitle.classList.add("diag-group-title");
    groupTitle.textContent = group.title;
    groupEl.appendChild(groupTitle);

    const groupDescription = doc.createElement("p");
    groupDescription.classList.add("diag-group-description");
    groupDescription.textContent = group.description;
    groupEl.appendChild(groupDescription);

    for (const [key, label, help] of group.items) {
      const item = doc.createElement("span");
      item.classList.add("diag-item");

      const labelEl = doc.createElement("span");
      labelEl.classList.add("diag-label");
      labelEl.textContent = label;

      const valueEl = doc.createElement("span");
      valueEl.classList.add("diag-value");
      valueEl.dataset.metric = `${group.id}:${key}`;
      valueEl.textContent = "-";

      const helpEl = doc.createElement("span");
      helpEl.classList.add("diag-help");
      helpEl.textContent = help;

      item.appendChild(labelEl);
      item.appendChild(valueEl);
      item.appendChild(helpEl);
      groupEl.appendChild(item);
      valueNodes.set(`${group.id}:${key}`, valueEl);
    }

    body.appendChild(groupEl);
  }

  return { element, valueNodes, helpButton };
}

export function createAudioDiagnosticsOverlay({
  document: doc,
  player,
  window: win,
  getFrameDiagnostics = null,
}) {
  if (!doc || !player) return null;
  const params = new URLSearchParams(win?.location?.search || "");
  let visible = params.get("audioDebug") === "1";
  let helpOpen = false;

  const { element, valueNodes, helpButton } = createDiagnosticsLayout(doc);
  element.classList.toggle("hidden", !visible);
  doc.body.appendChild(element);

  function setHelp(open) {
    const next = Boolean(open);
    if (helpOpen === next) return;
    helpOpen = next;
    element.classList.toggle("is-help", helpOpen);
    if (helpOpen) element.scrollTop = 0;
    helpButton.textContent = helpOpen ? "×" : "?";
    helpButton.setAttribute("aria-label", helpOpen ? "Close stats explanation" : "Explain stats");
    helpButton.setAttribute("aria-expanded", String(helpOpen));
  }

  helpButton.addEventListener("click", () => setHelp(!helpOpen));

  let timer = null;

  function refresh() {
    const diagnostics = player.getAudioDiagnostics() || {};
    const frameDiagnostics = getFrameDiagnostics?.() || {};
    const combined = { ...diagnostics, ...frameDiagnostics };
    const values = buildValues(combined);
    const health = buildHealth(combined);
    for (const [key, node] of valueNodes) {
      const next = values[key] ?? "-";
      if (node.textContent !== next) node.textContent = next;
      const state = health[key];
      if (state) {
        if (node.dataset.health !== state) node.dataset.health = state;
      } else if (node.dataset.health !== undefined) {
        delete node.dataset.health;
      }
    }
  }

  function stopTimer() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function startTimer() {
    if (timer !== null) return;
    refresh();
    timer = setInterval(refresh, 500);
  }

  function show() {
    visible = true;
    element.classList.remove("hidden");
    startTimer();
    return true;
  }

  function hide() {
    setHelp(false);
    visible = false;
    element.classList.add("hidden");
    stopTimer();
    return false;
  }

  function toggle() {
    return visible ? hide() : show();
  }

  // Populate the values immediately so a visible overlay never shows placeholders.
  refresh();
  if (visible) startTimer();

  return {
    element,
    show,
    hide,
    toggle,
    isVisible: () => visible,
    stop() {
      stopTimer();
      if (typeof element.remove === "function") element.remove();
    },
  };
}
