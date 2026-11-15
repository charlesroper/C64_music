export function createTapeLoadingSound({
  getContext,
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
  let started = false;

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
    if (!started) return;
    started = false;
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

  function resumeContext(ctx) {
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    try {
      ctx.resume?.();
    } catch (_) {}
  }

  function start() {
    const initialContext = context || (getContext ? getContext() : null);
    resumeContext(initialContext);
    if (started) return;
    if (!initialContext || initialContext.state === "closed") return;
    started = true;
    loadBuffer(initialContext).then((buffer) => {
      if (!started || !buffer) {
        if (!buffer) started = false;
        return;
      }
      const activeCtx = (getContext ? getContext() : null) || initialContext;
      if (!activeCtx || activeCtx.state === "closed") {
        started = false;
        return;
      }
      resumeContext(activeCtx);
      try {
        context = activeCtx;
        gain = activeCtx.createGain();
        gain.gain.value = 0.35;

        source = activeCtx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain).connect(activeCtx.destination);
        source.start(0);
      } catch (_) {
        started = false;
        context = null;
        gain = null;
        source = null;
      }
    });
  }

  return { preload, start, stop };
}
