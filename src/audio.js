/** Small, self-contained soundscape. Call start() from a pointer/key gesture. */
export function createAudio() {
  let context;
  let master;
  let engine;
  let engineGain;
  let engineFilter;
  let siren;
  let sirenGain;
  let enabled = true;
  let disposed = false;
  let noiseBuffer;
  const continuous = [];
  const temporary = new Set();

  const smooth = (param, value, time = 0.12) => {
    if (context && param) param.setTargetAtTime(value, context.currentTime, time);
  };

  function oscillator(type, frequency, target) {
    const source = context.createOscillator();
    source.type = type;
    source.frequency.value = frequency;
    source.connect(target);
    source.start();
    continuous.push(source);
    return source;
  }

  function makeNoise(seconds) {
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function loopNoise(target) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    source.connect(target);
    source.start();
    continuous.push(source);
    return source;
  }

  function ready() {
    return Boolean(context && enabled && !disposed && context.state === 'running');
  }

  // Each short sound owns its nodes; disconnect after playback to release them.
  function play({ noise = false, type = 'sine', frequency = 440, endFrequency,
    duration = 0.15, gain = 0.1, delay = 0, cutoff = 6000, pan = 0 }) {
    if (!ready()) return;
    const time = context.currentTime + delay;
    const source = noise ? context.createBufferSource() : context.createOscillator();
    if (noise) source.buffer = noiseBuffer;
    else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, time);
      if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    }
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), time + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(envelope);
    const panner = context.createStereoPanner ? context.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      envelope.connect(panner);
      panner.connect(master);
    } else envelope.connect(master);
    temporary.add(source);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
      panner?.disconnect();
      temporary.delete(source);
    };
    source.start(time, ...(noise ? [Math.random() * 1.5] : []));
    source.stop(time + duration + 0.02);
  }

  async function start() {
    if (disposed) return false;
    try {
      if (!context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        context = new AudioContextClass();
        master = context.createGain();
        master.gain.value = enabled ? 0.48 : 0;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -16;
        limiter.knee.value = 18;
        limiter.ratio.value = 5;
        master.connect(limiter);
        limiter.connect(context.destination);
        noiseBuffer = makeNoise(4);

        // Filtered air is intentionally quiet: the city should feel open.
        const windFilter = context.createBiquadFilter();
        windFilter.type = 'lowpass';
        windFilter.frequency.value = 520;
        const windGain = context.createGain();
        windGain.gain.value = 0.055;
        windFilter.connect(windGain);
        windGain.connect(master);
        loopNoise(windFilter);

        engineGain = context.createGain();
        engineGain.gain.value = 0;
        engineFilter = context.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 220;
        engineFilter.Q.value = 0.4;
        engineFilter.connect(engineGain);
        engineGain.connect(master);
        engine = oscillator('sawtooth', 42, engineFilter);

        sirenGain = context.createGain();
        sirenGain.gain.value = 0;
        sirenGain.connect(master);
        siren = oscillator('sine', 550, sirenGain);
      }
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch {
      // Unsupported/blocked sound must never prevent the game from starting.
      return false;
    }
  }

  function update({ speed = 0, inCar = false, wanted = 0 } = {}) {
    if (!context || disposed) return;
    const velocity = Number.isFinite(speed) ? Math.abs(speed) : 0;
    const rev = Math.min(1, velocity / 48);
    const vibration = Math.sin(context.currentTime * 29) * 0.8;
    smooth(engine?.frequency, 39 + rev * 100 + vibration, 0.1);
    smooth(engineFilter?.frequency, 180 + rev * 580, 0.14);
    smooth(engineGain?.gain, inCar ? 0.04 + rev * 0.035 : 0, 0.18);
    smooth(siren?.frequency, 650 + Math.sin(context.currentTime * 3) * 180, 0.07);
    smooth(sirenGain?.gain, wanted > 0 ? 0.009 + Math.min(wanted, 5) * 0.0015 : 0, 0.5);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    smooth(master?.gain, enabled ? 0.48 : 0, 0.04);
  }

  function shoot() {
    play({ noise: true, gain: 0.32, duration: 0.17, cutoff: 4200, pan: 0.12 });
    play({ frequency: 130, endFrequency: 42, gain: 0.27, duration: 0.15 });
    play({ noise: true, gain: 0.035, duration: 0.24, delay: 0.06, cutoff: 1800, pan: -0.25 });
  }

  function reload() {
    play({ noise: true, gain: 0.055, duration: 0.07, cutoff: 2300, pan: 0.14 });
    play({ noise: true, gain: 0.08, duration: 0.08, delay: 0.35, cutoff: 3500, pan: -0.1 });
    play({ type: 'triangle', frequency: 210, endFrequency: 110, gain: 0.045,
      duration: 0.06, delay: 0.56 });
  }

  function horn() {
    play({ type: 'triangle', frequency: 330, gain: 0.065, duration: 0.45 });
    play({ type: 'triangle', frequency: 415, gain: 0.05, duration: 0.45 });
  }

  function crash() {
    play({ noise: true, gain: 0.22, duration: 0.27, cutoff: 1300 });
    play({ frequency: 100, endFrequency: 32, gain: 0.24, duration: 0.24 });
  }

  function notify() {
    play({ frequency: 660, gain: 0.04, duration: 0.15 });
    play({ frequency: 880, gain: 0.035, duration: 0.22, delay: 0.11 });
  }

  function dispose() {
    disposed = true;
    for (const source of [...continuous, ...temporary]) {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    continuous.length = 0;
    temporary.clear();
    if (context && context.state !== 'closed') context.close().catch(() => {});
    context = undefined;
  }

  return { start, setEnabled, update, shoot, reload, horn, crash, notify, dispose };
}
