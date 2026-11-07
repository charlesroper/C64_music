// ============================================================================
// Stats for Nerds overlay
// Toggled by the header button or ?audioDebug=1. Shows process timing, missed
// audio quanta, context state changes, and output latency on the phone.
// ============================================================================

function formatMs(microseconds) {
  if (typeof microseconds !== "number" || !Number.isFinite(microseconds)) return "-";
  return (microseconds / 1000).toFixed(2);
}

function formatLatency(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "-";
  return `${(seconds * 1000).toFixed(1)}ms`;
}

function formatEvents(events) {
  if (!events || events.length === 0) return "none";
  return events
    .slice(-4)
    .map((event) => event.state)
    .join(" -> ");
}

function formatDiagnostics(diagnostics) {
  if (!diagnostics) return "STATS FOR NERDS\nwaiting for player";
  const lines = [
    "STATS FOR NERDS",
    `backend: ${diagnostics.backend || "-"}   ctx: ${diagnostics.contextState || "-"}   rate: ${diagnostics.sampleRate || "-"}`,
    `latency: ${diagnostics.latencyHint || "-"}   base: ${formatLatency(diagnostics.baseLatency)}   out: ${formatLatency(diagnostics.outputLatency)}`,
  ];

  if (typeof diagnostics.processCalls === "number") {
    lines.push(
      `process ms: p50 ${formatMs(diagnostics.p50Us)}  p95 ${formatMs(diagnostics.p95Us)}  p99 ${formatMs(diagnostics.p99Us)}  max ${formatMs(diagnostics.maxUs)}  budget ${formatMs(diagnostics.budgetUs)}`,
    );
    lines.push(
      `missed: ${diagnostics.missedQuanta}   telemetry drops: ${diagnostics.telemetryDrops}   gain: ${(diagnostics.gain ?? 0).toFixed(2)}   playing: ${diagnostics.playing ? "yes" : "no"}`,
    );
  } else {
    lines.push("process: waiting for worklet diagnostics");
  }

  lines.push(`events: ${formatEvents(diagnostics.contextEvents)}`);
  return lines.join("\n");
}

export function createAudioDiagnosticsOverlay({ document: doc, player, window: win }) {
  if (!doc || !player) return null;
  const params = new URLSearchParams(win?.location?.search || "");
  let visible = params.get("audioDebug") === "1";

  const element = doc.createElement("pre");
  element.id = "audio-diagnostics";
  element.className = "audio-diagnostics";
  element.textContent = formatDiagnostics(player.getAudioDiagnostics());
  element.classList.toggle("hidden", !visible);
  doc.body.appendChild(element);

  let timer = null;

  function refresh() {
    element.textContent = formatDiagnostics(player.getAudioDiagnostics());
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
