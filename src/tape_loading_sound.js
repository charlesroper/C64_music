export function createTapeLoadingSound({ getContext }) {
  let context = null;
  let gain = null;
  let nodes = [];
  let started = false;

  function stop() {
    if (!started) return;
    started = false;
    const ctx = context;
    const master = gain;
    const activeNodes = nodes;
    context = null;
    gain = null;
    nodes = [];
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    } catch (_) {}
    for (const node of activeNodes) {
      try {
        node.stop(ctx.currentTime + 0.12);
      } catch (_) {}
    }
  }

  function start() {
    if (started) return;
    started = true;
    queueMicrotask(() => {
      if (!started) return;
      try {
        context = getContext ? getContext() : null;
        if (!context || context.state === "closed") {
          started = false;
          return;
        }
        if (context.state === "suspended") context.resume?.();

        gain = context.createGain();
        gain.gain.value = 0.035;

        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1700;
        filter.Q.value = 0.7;

        const carrier = context.createOscillator();
        carrier.type = "sawtooth";
        carrier.frequency.value = 1100;

        const carrierLfo = context.createOscillator();
        carrierLfo.type = "sine";
        carrierLfo.frequency.value = 6;
        const carrierDepth = context.createGain();
        carrierDepth.gain.value = 260;

        const chirp = context.createOscillator();
        chirp.type = "square";
        chirp.frequency.value = 2200;

        const chirpLfo = context.createOscillator();
        chirpLfo.type = "triangle";
        chirpLfo.frequency.value = 17;
        const chirpDepth = context.createGain();
        chirpDepth.gain.value = 380;

        const chirpGain = context.createGain();
        chirpGain.gain.value = 0.35;

        carrierLfo.connect(carrierDepth).connect(carrier.frequency);
        chirpLfo.connect(chirpDepth).connect(chirp.frequency);
        carrier.connect(filter);
        chirp.connect(chirpGain).connect(filter);
        filter.connect(gain).connect(context.destination);

        carrier.start();
        carrierLfo.start();
        chirp.start();
        chirpLfo.start();

        nodes = [carrier, carrierLfo, chirp, chirpLfo, carrierDepth, chirpDepth, chirpGain, filter];
      } catch (_) {
        started = false;
        context = null;
        gain = null;
        nodes = [];
      }
    });
  }

  return { start, stop };
}
