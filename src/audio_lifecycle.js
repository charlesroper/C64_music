// ============================================================================
// Audio Lifecycle (createAudioLifecycle)
// Single browser session owner for Web Audio context creation, unlock,
// resumption, subscriber notifications, and Audio Mode replacement.
// ============================================================================

const GESTURE_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"];

function normalizeMode(value) {
  return value === "interactive" ? "interactive" : "playback";
}

function closeQuietly(ctx) {
  if (!ctx || typeof ctx.close !== "function") return Promise.resolve();
  try {
    const result = ctx.close();
    return result && typeof result.then === "function" ? result.catch(() => {}) : Promise.resolve();
  } catch (_) {
    return Promise.resolve();
  }
}

export function createAudioLifecycle({
  document: doc = null,
  window: win = typeof window !== "undefined" ? window : null,
  navigator: nav = typeof navigator !== "undefined" ? navigator : null,
  latencyHint = "playback",
  createContext = null,
} = {}) {
  let activeHint = normalizeMode(latencyHint);
  let activeContext = null;
  let contextHint = null;
  let notifiedContext = null;
  let notifiedRunning = false;
  let listenersAttached = false;
  let destroyed = false;
  const subscribers = new Set();

  function configureAudioSession() {
    if (!nav?.audioSession) return;
    try {
      nav.audioSession.type = "playback";
    } catch (_) {
      // Ignore on browsers where audioSession.type is read-only.
    }
  }

  function buildContext(hint) {
    const opts = { sampleRate: 48000, latencyHint: hint };
    if (typeof createContext === "function") {
      try {
        return { ctx: createContext(opts), usedHint: hint };
      } catch (_) {
        return { ctx: createContext(), usedHint: null };
      }
    }
    const AudioCtx = win?.AudioContext || win?.webkitAudioContext || null;
    if (!AudioCtx) return { ctx: null, usedHint: null };
    try {
      return { ctx: new AudioCtx(opts), usedHint: hint };
    } catch (_) {
      return { ctx: new AudioCtx(), usedHint: null };
    }
  }

  function detachGestureListeners() {
    if (!listenersAttached || typeof doc?.removeEventListener !== "function") {
      listenersAttached = false;
      return;
    }
    listenersAttached = false;
    for (const type of GESTURE_EVENTS) {
      doc.removeEventListener(type, handleGesture, true);
    }
  }

  function notify(payload) {
    for (const listener of Array.from(subscribers)) {
      if (subscribers.has(listener)) listener(payload);
    }
  }

  function handleStateChange() {
    syncState();
  }

  function attachStateChange(ctx) {
    if (typeof ctx?.addEventListener === "function") {
      ctx.addEventListener("statechange", handleStateChange);
    }
  }

  function detachStateChange(ctx) {
    if (typeof ctx?.removeEventListener === "function") {
      ctx.removeEventListener("statechange", handleStateChange);
    }
  }

  function clearActiveContext() {
    const previous = activeContext;
    detachStateChange(previous);
    activeContext = null;
    contextHint = null;
    notifiedContext = null;
    notifiedRunning = false;
    return previous;
  }

  function activateContext(hint) {
    if (activeContext) {
      detachStateChange(activeContext);
    }
    const built = buildContext(hint);
    activeContext = built.ctx;
    contextHint = built.usedHint;
    if (activeContext) {
      attachStateChange(activeContext);
    }
  }

  function syncState() {
    if (!activeContext) return;
    if (activeContext.state === "closed") {
      notifiedRunning = false;
      return;
    }
    if (activeContext.state === "running") {
      detachGestureListeners();
      if (notifiedContext !== activeContext || !notifiedRunning) {
        notifiedContext = activeContext;
        notifiedRunning = true;
        notify({ context: activeContext, state: "running" });
      }
      return;
    }
    if (notifiedContext !== activeContext) {
      notifiedContext = activeContext;
      notifiedRunning = false;
      notify({ context: activeContext, state: activeContext.state });
    } else if (notifiedRunning) {
      notifiedRunning = false;
    }
  }

  function resumeContext(ctx) {
    if (!ctx) return;
    if (ctx.state !== "running" && ctx.state !== "closed") {
      try {
        const result = ctx.resume?.();
        if (result && typeof result.then === "function") {
          result.then(
            () => {
              if (ctx === activeContext) syncState();
            },
            () => {},
          );
        }
      } catch (_) {
        // Ignore synchronous resume errors.
      }
    }
    syncState();
  }

  function getContext() {
    return activeContext && activeContext.state !== "closed" ? activeContext : null;
  }

  function isRunning() {
    return Boolean(activeContext && activeContext.state === "running");
  }

  function getLatencyHint() {
    return activeHint;
  }

  function setLatencyHint(mode) {
    activeHint = normalizeMode(mode);
    return activeHint;
  }

  function unlock() {
    if (destroyed) return null;
    configureAudioSession();
    if (!activeContext || activeContext.state === "closed") {
      activateContext(activeHint);
    }
    if (activeContext) {
      resumeContext(activeContext);
    }
    return getContext();
  }

  function ensureContext(options) {
    if (destroyed) return null;
    configureAudioSession();
    const requestedHint =
      options?.latencyHint !== undefined ? normalizeMode(options.latencyHint) : activeHint;
    if (options?.latencyHint !== undefined) activeHint = requestedHint;

    if (
      activeContext &&
      activeContext.state !== "closed" &&
      contextHint !== null &&
      requestedHint !== contextHint
    ) {
      const stale = clearActiveContext();
      closeQuietly(stale);
    }

    if (!activeContext || activeContext.state === "closed") {
      activateContext(requestedHint);
    }
    if (activeContext) {
      resumeContext(activeContext);
    }
    return getContext();
  }

  function resume() {
    if (destroyed || !activeContext || activeContext.state === "closed") return null;
    resumeContext(activeContext);
    return getContext();
  }

  async function replaceContext(options = {}) {
    if (destroyed) return null;
    if (options?.latencyHint !== undefined) {
      activeHint = normalizeMode(options.latencyHint);
    }
    const oldCtx = clearActiveContext();
    await closeQuietly(oldCtx);
    if (destroyed) return null;
    return ensureContext({ latencyHint: activeHint });
  }

  async function close() {
    const oldCtx = clearActiveContext();
    await closeQuietly(oldCtx);
  }

  function subscribe(listener) {
    if (destroyed || typeof listener !== "function") return () => {};
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }

  function handleGesture() {
    unlock();
  }

  if (typeof doc?.addEventListener === "function") {
    listenersAttached = true;
    for (const type of GESTURE_EVENTS) {
      doc.addEventListener(type, handleGesture, true);
    }
  }

  function destroy() {
    destroyed = true;
    detachGestureListeners();
    detachStateChange(activeContext);
    subscribers.clear();
  }

  return {
    getContext,
    isRunning,
    getLatencyHint,
    setLatencyHint,
    unlock,
    ensureContext,
    resume,
    replaceContext,
    close,
    subscribe,
    destroy,
  };
}
