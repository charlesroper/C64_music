// ============================================================================
// Stats for Nerds overlay
// Toggled by the header button or ?audioDebug=1. Shows process timing, missed
// audio quanta, context state changes, and output latency on the phone.
// ============================================================================

import { TELEMETRY_HZ_DEFAULT } from "./telemetry_rate.js";

const GROUPS = [
  {
    id: "context",
    title: "CONTEXT",
    items: [
      ["backend", "backend"],
      ["ctx", "ctx"],
      ["rate", "rate"],
      ["telemetry", "telemetry"],
    ],
  },
  {
    id: "latency",
    title: "LATENCY",
    items: [
      ["mode", "mode"],
      ["base", "base"],
      ["out", "out"],
    ],
  },
  {
    id: "process",
    title: "PROCESS (ms)",
    items: [
      ["p50", "p50"],
      ["p95", "p95"],
      ["p99", "p99"],
      ["max", "max"],
      ["peak", "peak"],
      ["budget", "budget"],
      ["renderMax", "render max"],
      ["renderPeak", "render peak"],
      ["packMax", "pack max"],
      ["packPeak", "pack peak"],
      ["postMax", "post max"],
      ["postPeak", "post peak"],
      ["gainMax", "gain max"],
      ["gainPeak", "gain peak"],
      ["frameP50", "frame p50"],
      ["frameP95", "frame p95"],
      ["frameMax", "frame max"],
      ["framePeak", "frame peak"],
      ["frameCalls", "frames"],
    ],
  },
  {
    id: "deadlines",
    title: "DEADLINES",
    items: [
      ["lateTotal", "late total"],
      ["lateWindow", "late window"],
      ["latePeak", "late peak"],
      ["missedTotal", "missed total"],
      ["missedWindow", "missed window"],
      ["missedPeak", "missed peak"],
    ],
  },
  {
    id: "telemetry",
    title: "TELEMETRY",
    items: [
      ["dropsTotal", "drops total"],
      ["dropsWindow", "drops window"],
      ["dropsPeak", "drops peak"],
      ["volume", "volume"],
      ["playing", "playing"],
    ],
  },
  {
    id: "events",
    title: "EVENTS",
    items: [["events", "events"]],
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

function buildValues(diagnostics) {
  const processCalls = diagnostics.processCalls;
  const lateWindow = diagnostics.lateWindow ?? 0;
  return {
    "context:backend": diagnostics.backend || "-",
    "context:ctx": diagnostics.contextState || "-",
    "context:rate": diagnostics.sampleRate || "-",
    "context:telemetry": `${diagnostics.telemetryHz ?? TELEMETRY_HZ_DEFAULT}Hz`,
    "latency:mode": diagnostics.latencyHint || "-",
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

  const title = doc.createElement("h2");
  title.classList.add("diag-title");
  title.textContent = "STATS FOR NERDS";
  element.appendChild(title);

  const valueNodes = new Map();
  for (const group of GROUPS) {
    const groupEl = doc.createElement("div");
    groupEl.classList.add("diag-group", `diag-group--${group.id}`);

    const groupTitle = doc.createElement("div");
    groupTitle.classList.add("diag-group-title");
    groupTitle.textContent = group.title;
    groupEl.appendChild(groupTitle);

    for (const [key, label] of group.items) {
      const item = doc.createElement("span");
      item.classList.add("diag-item");

      const labelEl = doc.createElement("span");
      labelEl.classList.add("diag-label");
      labelEl.textContent = label;

      const valueEl = doc.createElement("span");
      valueEl.classList.add("diag-value");
      valueEl.dataset.metric = `${group.id}:${key}`;
      valueEl.textContent = "-";

      item.appendChild(labelEl);
      item.appendChild(valueEl);
      groupEl.appendChild(item);
      valueNodes.set(`${group.id}:${key}`, valueEl);
    }

    element.appendChild(groupEl);
  }

  return { element, valueNodes };
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

  const { element, valueNodes } = createDiagnosticsLayout(doc);
  element.classList.toggle("hidden", !visible);
  doc.body.appendChild(element);

  let timer = null;

  function refresh() {
    const diagnostics = player.getAudioDiagnostics() || {};
    const frameDiagnostics = getFrameDiagnostics?.() || {};
    const values = buildValues({ ...diagnostics, ...frameDiagnostics });
    for (const [key, node] of valueNodes) {
      const next = values[key] ?? "-";
      if (node.textContent !== next) node.textContent = next;
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
