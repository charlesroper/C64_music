// ============================================================================
// Boot Handoff (createBootHandoff)
// Joins Boot Sequence progress, background assembly prewarm, Player Engine
// audio preparation, first-frame Telemetry Snapshot readiness, and Load Target
// startup in the Workbench View.
// ============================================================================

export const FIRST_FRAME_TIMEOUT_MS = 3000;

export function createBootHandoff({
  audioLifecycle = null,
  firstFrameTimeoutMs = FIRST_FRAME_TIMEOUT_MS,
  pollIntervalMs = 16,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
} = {}) {
  let boot = null;
  let view = null;
  let player = null;
  let bootActive = true;
  let gateActive = false;
  let bootTarget = null;
  let bootTargetLoaded = false;
  let prewarmDone = false;
  let bootOutcome = null;
  let destroyed = false;
  let audioPrepared = false;
  let unsubscribeAudio = null;
  let activeFadeCancel = null;

  function clearAudioSubscription() {
    if (unsubscribeAudio) {
      unsubscribeAudio();
      unsubscribeAudio = null;
    }
  }

  function preparePlayerAudio() {
    if (destroyed || !player) return;
    if (!audioPrepared && !player.getAudioContext?.()) {
      audioPrepared = true;
      player.prepareAudio?.();
    }
    if (player.getAudioContext?.()) {
      clearAudioSubscription();
    }
  }

  function loadBootTargetPaused() {
    if (destroyed || !bootTarget || !view || !player || !prewarmDone || bootTargetLoaded) return;
    bootTargetLoaded = true;
    view.selectGameAndTrack(bootTarget.gameId, bootTarget.trackId, false);
  }

  function applyBootOutcome() {
    if (destroyed || !bootOutcome || !view || !player || !prewarmDone) return;
    const outcome = bootOutcome;
    bootOutcome = null;
    const autoPlay = Boolean(outcome.autoPlay || view.isPendingPlayOnBoot?.());
    if (bootTargetLoaded) {
      if (autoPlay) view.setPlaying(true);
      return;
    }
    bootTargetLoaded = true;
    view.selectGameAndTrack(outcome.target.gameId, outcome.target.trackId, autoPlay);
  }

  function attachBoot(bootInstance) {
    boot = bootInstance || null;
    if (!destroyed && prewarmDone) {
      boot?.setReady?.();
    }
  }

  function attachView(viewInstance) {
    view = viewInstance || null;
    if (!view || destroyed) return;
    view.setRenderingPaused?.(bootActive);
    loadBootTargetPaused();
    applyBootOutcome();
  }

  function attachPlayer(playerInstance, prewarmPromise = null) {
    clearAudioSubscription();
    audioPrepared = false;
    player = playerInstance || null;
    if (!player || destroyed) return;

    if (audioLifecycle && typeof audioLifecycle.subscribe === "function") {
      unsubscribeAudio = audioLifecycle.subscribe(({ context }) => {
        if (destroyed || player !== playerInstance || !context) return;
        preparePlayerAudio();
      });
    }

    const settlePrewarm = () => {
      if (destroyed || player !== playerInstance) return;
      prewarmDone = true;
      loadBootTargetPaused();
      if (gateActive) {
        preparePlayerAudio();
      }
      boot?.setReady?.();
      applyBootOutcome();
    };

    if (!prewarmPromise) {
      settlePrewarm();
      return;
    }
    Promise.resolve(prewarmPromise).then(settlePrewarm, settlePrewarm);
  }

  function handleGate({ target } = {}) {
    if (destroyed) return;
    gateActive = true;
    if (target) bootTarget = target;
    loadBootTargetPaused();
    if (prewarmDone && (!audioLifecycle || audioLifecycle.getContext?.())) {
      preparePlayerAudio();
    }
  }

  function handleComplete(outcome) {
    if (destroyed) return;
    bootActive = false;
    view?.setRenderingPaused?.(false);
    bootOutcome = outcome;
    applyBootOutcome();
  }

  function waitBeforeFade(ready) {
    if (destroyed) return () => {};
    if (activeFadeCancel) {
      activeFadeCancel();
      activeFadeCancel = null;
    }

    const tel = player?.getTelemetry?.();
    if (tel && tel.frameCount > 0) {
      view?.renderTelemetry?.(tel);
      ready?.();
      return () => {};
    }

    const ctx = player?.getAudioContext?.();
    const playerState = player?.getState?.();
    if (
      ctx?.state !== "running" ||
      !ctx.audioWorklet ||
      playerState?.audioBackend === "in-thread"
    ) {
      ready?.();
      return () => {};
    }

    let timerId = null;
    let settled = false;
    const deadline = now() + firstFrameTimeoutMs;

    const cancelWait = () => {
      if (settled) return;
      settled = true;
      if (timerId !== null) {
        cancel(timerId);
        timerId = null;
      }
      if (activeFadeCancel === cancelWait) {
        activeFadeCancel = null;
      }
    };

    const poll = () => {
      timerId = null;
      if (settled || destroyed) return;
      const current = player?.getTelemetry?.();
      if ((current && current.frameCount > 0) || now() >= deadline) {
        if (current) view?.renderTelemetry?.(current);
        cancelWait();
        ready?.();
        return;
      }
      timerId = schedule(poll, pollIntervalMs);
    };

    activeFadeCancel = cancelWait;
    timerId = schedule(poll, pollIntervalMs);
    return cancelWait;
  }

  function destroy() {
    destroyed = true;
    if (activeFadeCancel) {
      activeFadeCancel();
      activeFadeCancel = null;
    }
    clearAudioSubscription();
  }

  return {
    attachBoot,
    attachView,
    attachPlayer,
    handleGate,
    handleComplete,
    waitBeforeFade,
    destroy,
  };
}
