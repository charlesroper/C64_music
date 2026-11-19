export function createTapeLoadingSound({
  audioLifecycle,
  fetchFn = null,
  url = "./assets/c64_loading_noise.m4a",
} = {}) {
  let rawBytesPromise = null;
  let decodedContext = null;
  let decodedBuffer = null;
  let decodePromise = null;
  let context = null;
  let gain = null;
  let source = null;
  let active = false;
  let playing = false;
  let startToken = 0;
  let unsubscribe = null;

  function resolveFetch() {
    if (typeof fetchFn === "function") return fetchFn;
    return typeof fetch === "function" ? fetch : null;
  }

  function fetchBytes() {
    if (rawBytesPromise) return rawBytesPromise;
    const loader = resolveFetch();
    if (!loader) return Promise.resolve(null);
    rawBytesPromise = (async () => {
      try {
        const resp = await loader(url);
        if (!resp || resp.ok === false) {
          rawBytesPromise = null;
          return null;
        }
        return await resp.arrayBuffer();
      } catch (_) {
        rawBytesPromise = null;
        return null;
      }
    })();
    return rawBytesPromise;
  }

  function preload() {
    return fetchBytes();
  }

  async function loadBuffer(ctx) {
    if (decodedBuffer && decodedContext === ctx) return decodedBuffer;
    if (decodePromise && decodedContext === ctx) return decodePromise;
    decodedContext = ctx;
    decodePromise = (async () => {
      const bytes = await fetchBytes();
      if (!bytes || typeof ctx.decodeAudioData !== "function") return null;
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      if (decodedContext === ctx) decodedBuffer = buffer;
      return buffer;
    })();
    try {
      return await decodePromise;
    } catch (_) {
      if (decodedContext === ctx) {
        decodedContext = null;
        decodedBuffer = null;
        decodePromise = null;
      }
      return null;
    }
  }

  function stop() {
    active = false;
    playing = false;
    startToken++;
    disarmSubscription();
    const ctx = context;
    const master = gain;
    const activeSource = source;
    context = null;
    gain = null;
    source = null;
    if (!ctx || !master || !activeSource) return;
    try {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    } catch (_) {}
    try {
      activeSource.stop(ctx.currentTime + 0.12);
    } catch (_) {}
  }

  function disarmSubscription() {
    if (typeof unsubscribe === "function") {
      const unsub = unsubscribe;
      unsubscribe = null;
      unsub();
    }
  }

  function armSubscription() {
    if (unsubscribe || typeof audioLifecycle?.subscribe !== "function") return;
    unsubscribe = audioLifecycle.subscribe(({ context: nextCtx, state }) => {
      if (!active) {
        disarmSubscription();
        return;
      }
      if (nextCtx && state === "running") {
        tryStartPlayback();
      }
    });
  }

  function resolveRunningContext() {
    let ctx = audioLifecycle?.getContext?.() || null;
    if (!ctx || ctx.state === "closed") return null;
    if (ctx.state !== "running") {
      audioLifecycle?.resume?.();
      ctx = audioLifecycle?.getContext?.() || null;
      if (ctx?.state !== "running") return null;
    }
    return ctx;
  }

  function tryStartPlayback() {
    if (!active || playing) return;
    const ctx = resolveRunningContext();
    if (!active || playing) return;
    if (!ctx) {
      fetchBytes();
      armSubscription();
      return;
    }
    disarmSubscription();
    playing = true;
    const token = ++startToken;
    loadBuffer(ctx).then((buffer) => {
      if (token !== startToken || !active || !buffer) {
        if (token === startToken) {
          playing = false;
          if (!buffer) active = false;
        }
        return;
      }
      const targetCtx = resolveRunningContext();
      if (token !== startToken || !active) {
        if (token === startToken) playing = false;
        return;
      }
      if (!targetCtx) {
        playing = false;
        armSubscription();
        return;
      }
      if (targetCtx !== ctx) {
        playing = false;
        tryStartPlayback();
        return;
      }
      try {
        context = targetCtx;
        gain = targetCtx.createGain();
        gain.gain.value = 0.35;

        source = targetCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain).connect(targetCtx.destination);
        source.start(0);
      } catch (_) {
        playing = false;
        active = false;
        context = null;
        gain = null;
        source = null;
      }
    });
  }

  function start() {
    active = true;
    tryStartPlayback();
  }

  return { preload, start, stop };
}
