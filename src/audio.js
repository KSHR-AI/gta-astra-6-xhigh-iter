// Recorded CC0 foley sits under a small, continuously running Web Audio mixer.
// Nothing opens an AudioContext until start() is called from a user gesture.
const ASSETS = {
  engine: 'engine-loop.wav', gulls: 'coastal-gulls.mp3',
  concrete1: 'step-concrete-1.mp3', concrete2: 'step-concrete-2.mp3', concrete3: 'step-concrete-3.mp3',
  grass1: 'step-grass-1.mp3', grass2: 'step-grass-2.mp3', grass3: 'step-grass-3.mp3',
  metal: 'metal-impact.mp3', click: 'metal-click.mp3', door: 'door-thump.mp3',
  glass: 'glass-impact.mp3', magazine: 'magazine.mp3',
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function createAudio() {
  let context, master, world, echoInput, noiseBuffer;
  let engine, exhaust, transmission, engineFilter, engineGain, exhaustGain, transmissionGain;
  let engineSample, engineSampleGain, roadFilter, roadGain, tireFilter, tireGain, tireTone;
  let windGain, seaGain, gullGain, siren, sirenHarmonic, sirenFilter, sirenGain, sirenPan;
  let enabled = true, disposed = false, active = true;
  let lastTime = 0, lastSpeed = 0, lastGear = 1, lastDistance = 80, shiftUntil = 0;
  let stepDistance = 0, stepIndex = 0, trafficAt = 4, musicAt = 0, musicBeat = 0;
  let lastCrash = -10, lastHorn = -10;
  let previousCar = false;
  const buffers = {};
  const nodes = new Set();
  const continuous = new Set();
  const temporary = new Set();
  const abort = new AbortController();

  function track(node) { nodes.add(node); return node; }
  function gain(value, target = world) {
    const node = track(context.createGain());
    node.gain.value = value;
    if (target) node.connect(target);
    return node;
  }
  function filter(type, frequency, target, q = 0.5) {
    const node = track(context.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    if (target) node.connect(target);
    return node;
  }
  function smooth(param, value, time = 0.12) {
    if (param && Number.isFinite(value)) param.setTargetAtTime(value, context.currentTime, time);
  }
  function loop(buffer, target, rate = 1) {
    const node = track(context.createBufferSource());
    node.buffer = buffer;
    node.loop = true;
    node.playbackRate.value = rate;
    node.connect(target);
    node.start();
    continuous.add(node);
    return node;
  }
  function oscillator(type, frequency, target) {
    const node = track(context.createOscillator());
    node.type = type;
    node.frequency.value = frequency;
    node.connect(target);
    node.start();
    continuous.add(node);
    return node;
  }
  function ready() {
    return Boolean(context && enabled && active && !disposed && context.state === 'running');
  }
  function clearTemporary() {
    for (const voice of [...temporary]) {
      try { voice.source.stop(); } catch { /* The voice may already have ended. */ }
      voice.clean();
    }
  }

  // Voices allocate only at an audible event, never for continuous frame updates.
  function play({ sample, noise = false, type = 'sine', frequency = 440, endFrequency,
    duration = 0.15, volume = 0.1, delay = 0, cutoff = 6000, highpass = 0,
    pan = 0, endPan, rate = 1, endRate, looped = false, attack = 0.004, echo = 0 } = {}) {
    if (!ready() || temporary.size > 40) return false;
    const buffer = sample && buffers[sample];
    if (sample && !buffer) return false;
    const now = context.currentTime + delay;
    const source = buffer || noise ? context.createBufferSource() : context.createOscillator();
    if (buffer || noise) {
      source.buffer = buffer || noiseBuffer;
      source.loop = looped || noise;
      source.playbackRate.setValueAtTime(rate, now);
      if (endRate) source.playbackRate.linearRampToValueAtTime(endRate, now + duration);
    } else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, now);
      if (endFrequency) source.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    }
    const low = context.createBiquadFilter();
    low.type = 'lowpass'; low.frequency.value = cutoff; low.Q.value = 0.45;
    const envelope = context.createGain();
    const level = Math.max(0.0001, volume);
    const onset = Math.min(attack, duration * 0.3);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(level, now + onset);
    if (looped) {
      envelope.gain.setValueAtTime(level, now + duration * 0.55);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    } else if (buffer) {
      envelope.gain.setValueAtTime(level, now + Math.max(onset, duration - 0.035));
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    } else envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(low);
    const high = highpass ? context.createBiquadFilter() : null;
    if (high) {
      high.type = 'highpass'; high.frequency.value = highpass;
      low.connect(high); high.connect(envelope);
    } else low.connect(envelope);
    const panner = context.createStereoPanner?.();
    if (panner) {
      panner.pan.setValueAtTime(clamp(pan, -1, 1), now);
      if (Number.isFinite(endPan)) panner.pan.linearRampToValueAtTime(clamp(endPan, -1, 1), now + duration);
      envelope.connect(panner); panner.connect(world);
    } else envelope.connect(world);
    const send = echo ? context.createGain() : null;
    if (send) { send.gain.value = echo; envelope.connect(send); send.connect(echoInput); }
    const voice = { source, clean: () => {
      source.disconnect(); low.disconnect(); high?.disconnect(); envelope.disconnect();
      panner?.disconnect(); send?.disconnect(); temporary.delete(voice);
    } };
    temporary.add(voice);
    source.onended = voice.clean;
    source.start(now, ...(noise ? [Math.random() * 2] : []));
    source.stop(now + duration + 0.02);
    return true;
  }

  function createMixer() {
    master = gain(enabled ? 0.62 : 0, null);
    const limiter = track(context.createDynamicsCompressor());
    limiter.threshold.value = -14; limiter.knee.value = 15; limiter.ratio.value = 6;
    limiter.attack.value = 0.004; limiter.release.value = 0.16;
    master.connect(limiter); limiter.connect(context.destination);
    world = gain(active ? 1 : 0, master);
    noiseBuffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    // Short, filtered building reflections; no costly long convolution or feedback loop.
    echoInput = gain(1, null);
    for (const [seconds, level, pan] of [[0.092, 0.28, -0.58], [0.173, 0.15, 0.6]]) {
      const delay = track(context.createDelay(0.3)); delay.delayTime.value = seconds;
      const tail = gain(level);
      const panner = context.createStereoPanner ? track(context.createStereoPanner()) : null;
      if (panner) { tail.disconnect(); tail.connect(panner); panner.pan.value = pan; panner.connect(world); }
      const low = filter('lowpass', 1900, tail);
      echoInput.connect(delay); delay.connect(low);
    }

    windGain = gain(0); loop(noiseBuffer, filter('lowpass', 430, windGain));
    seaGain = gain(0); loop(noiseBuffer, filter('bandpass', 720, seaGain, 0.45), 0.81);
    gullGain = gain(0);

    engineGain = gain(0);
    engineFilter = filter('lowpass', 300, engineGain);
    engine = oscillator('sine', 30, engineFilter);
    const harmonic = new Float32Array([0, 0.68, 0.32, 0.18, 0.1, 0.055, 0.035, 0.015]);
    engine.setPeriodicWave(context.createPeriodicWave(new Float32Array(harmonic.length), harmonic));
    exhaustGain = gain(0);
    exhaust = oscillator('triangle', 16, filter('lowpass', 170, exhaustGain));
    engineSampleGain = gain(0);
    transmissionGain = gain(0);
    transmission = oscillator('sine', 130, transmissionGain);
    roadGain = gain(0); roadFilter = filter('bandpass', 720, roadGain, 0.4);
    loop(noiseBuffer, roadFilter, 0.93);
    tireGain = gain(0); tireFilter = filter('bandpass', 1800, tireGain, 1.7);
    loop(noiseBuffer, tireFilter, 1.17);
    const tireToneGain = gain(0.1, tireGain);
    tireTone = oscillator('sine', 730, tireToneGain);

    sirenPan = context.createStereoPanner ? track(context.createStereoPanner()) : null;
    if (sirenPan) sirenPan.connect(world);
    sirenGain = gain(0, sirenPan || world);
    sirenFilter = filter('lowpass', 2200, sirenGain);
    siren = oscillator('triangle', 650, sirenFilter);
    sirenHarmonic = oscillator('sine', 1300, gain(0.12, sirenFilter));
  }

  async function loadAssets() {
    // All requests are local, total transfer < 400 KB; synthesis remains usable on failure.
    const owner = context;
    await Promise.allSettled(Object.entries(ASSETS).map(async ([name, filename]) => {
      const response = await fetch(`/audio/${filename}`, { signal: abort.signal });
      if (!response.ok) return;
      const data = await response.arrayBuffer();
      if (disposed) return;
      const buffer = await new Promise((resolve, reject) => owner.decodeAudioData(data, resolve, reject));
      if (disposed || context !== owner) return;
      buffers[name] = buffer;
      if (name === 'engine') engineSample = loop(buffer, filter('lowpass', 1800, engineSampleGain));
      if (name === 'gulls') loop(buffer, filter('lowpass', 4200, gullGain));
    }));
  }

  async function start() {
    if (disposed) return false;
    try {
      if (!context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        context = new AudioContextClass({ latencyHint: 'interactive' });
        createMixer();
        lastTime = context.currentTime;
        trafficAt = lastTime + 5;
        void loadAssets();
      }
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch { return false; }
  }

  function footsteps(distance, sprinting, surface) {
    stepDistance += distance;
    const stride = sprinting ? 2.1 : 1.38;
    if (stepDistance < stride) return;
    stepDistance %= stride;
    stepIndex++;
    const pan = stepIndex % 2 ? -0.11 : 0.11;
    const soft = surface === 'grass' || surface === 'sand';
    const name = `${soft ? 'grass' : 'concrete'}${stepIndex % 3 + 1}`;
    const rate = (sprinting ? 1.12 : 1) * (0.94 + Math.random() * 0.12);
    const volume = (sprinting ? 0.32 : 0.23) * (soft ? 0.65 : 1);
    if (!play({ sample: name, duration: soft ? 0.6 : 0.2, rate, volume,
      cutoff: soft ? 2600 : 4300, pan })) {
      play({ noise: true, duration: 0.12, volume: 0.075, cutoff: soft ? 900 : 1800, pan });
      play({ frequency: 86, endFrequency: 40, duration: 0.1, volume: 0.06, pan });
    }
  }

  // Speed/footSpeed are metres per second. Optional cameraForward aligns stereo
  // position with an orbiting camera; positions accept Vector3 or plain {x,y,z}.
  function update({ speed = 0, inCar = false, wanted = 0, playerPosition, policePosition,
    velocity, footSpeed, sprinting = false, rpm, gear, slip = 0, policeState,
    night = 0, active: running = true, surface, cameraForward } = {}) {
    const wasActive = active;
    active = Boolean(running);
    if (!context || disposed) return;
    const now = context.currentTime;
    const dt = clamp(now - lastTime, 0, 0.15);
    lastTime = now;
    if (wasActive && !active) clearTemporary();
    smooth(world.gain, active ? 1 : 0, 0.06);
    if (!active || !enabled) {
      stepDistance = 0; lastSpeed = Math.abs(finite(speed));
      musicAt = now + 0.5; trafficAt = now + 5;
      return;
    }

    const roadSpeed = Math.abs(finite(speed));
    const acceleration = dt > 0 ? clamp((roadSpeed - lastSpeed) / dt, -8, 8) : 0;
    lastSpeed = roadSpeed;
    const currentGear = clamp(Math.round(finite(gear, 1 + Math.floor(roadSpeed / 10))), 1, 6);
    if (inCar && previousCar && currentGear !== lastGear) {
      shiftUntil = now + 0.2;
      play({ sample: 'click', volume: 0.07, duration: 0.2, rate: 0.7, cutoff: 1200 });
    }
    lastGear = currentGear;
    previousCar = inCar;
    const inferredRpm = 850 + (roadSpeed < 4 ? roadSpeed * 430 : 1550 + (roadSpeed % 10) * 245);
    const engineRpm = clamp(finite(rpm, inferredRpm), 650, 7500);
    const rev = clamp((engineRpm - 800) / 5700, 0, 1);
    const load = 0.62 + clamp(acceleration / 10, -0.24, 0.45);
    const shifting = now < shiftUntil ? 0.5 : 1;
    const drive = inCar ? 1 : 0;
    smooth(engine.frequency, engineRpm / 30, 0.09);
    smooth(exhaust.frequency, engineRpm / 60, 0.11);
    smooth(engineFilter.frequency, 240 + rev * 1100 + load * 130, 0.1);
    smooth(engineGain.gain, drive * (engineSample ? 0.017 : 0.065) * (0.5 + rev) * load * shifting);
    smooth(exhaustGain.gain, drive * (0.016 + rev * 0.019) * shifting);
    smooth(engineSample?.playbackRate, clamp(engineRpm / 1450, 0.55, 3.7), 0.12);
    smooth(engineSampleGain.gain, drive * (0.105 + rev * 0.08) * load * shifting, 0.15);
    smooth(transmission.frequency, 120 + roadSpeed * 8.5);
    smooth(transmissionGain.gain, drive * Math.min(0.009, roadSpeed * 0.00023));
    smooth(roadFilter.frequency, 480 + Math.min(roadSpeed, 50) * 20);
    smooth(roadGain.gain, drive * Math.min(0.11, Math.pow(roadSpeed / 45, 1.25) * 0.09), 0.25);
    const skid = drive * clamp(Math.abs(finite(slip)), 0, 1) * clamp(roadSpeed / 8, 0, 1);
    smooth(tireGain.gain, skid * 0.09, 0.06);
    smooth(tireFilter.frequency, 1350 + skid * 700 + Math.sin(now * 18) * 90, 0.04);
    smooth(tireTone.frequency, 650 + skid * 430 + Math.sin(now * 21) * 38, 0.04);

    const darkness = clamp(finite(night), 0, 1);
    const coast = playerPosition ? clamp((-finite(playerPosition.x) - 45) / 90, 0, 1) : 0.25;
    const swell = 0.66 + Math.sin(now * 0.34) * 0.18 + Math.sin(now * 0.13) * 0.09;
    const cabin = inCar ? 0.48 : 1;
    smooth(windGain.gain, (0.018 + coast * 0.015) * cabin * (0.85 + Math.sin(now * 0.23) * 0.15), 0.7);
    smooth(seaGain.gain, coast * (0.018 + swell * 0.035) * cabin, 0.8);
    smooth(gullGain.gain, (0.025 + coast * 0.09) * cabin * (1 - darkness * 0.97), 1.5);

    const police = Array.isArray(policePosition) ? policePosition[0] : policePosition;
    const dx = police && playerPosition ? finite(police.x) - finite(playerPosition.x) : 30;
    const dz = police && playerPosition ? finite(police.z) - finite(playerPosition.z) : -80;
    const distance = Math.hypot(dx, dz);
    const distanceGain = 1 / (1 + Math.pow(distance / 25, 1.25));
    const approaching = dt > 0 ? clamp((lastDistance - distance) / dt, -30, 30) : 0;
    lastDistance = distance;
    const searching = policeState === 'search' || policeState === 'searching';
    const phase = now * (searching ? 1.65 : 3.3);
    const pitch = (690 + Math.sin(phase) * 260) * (1 + approaching / 540);
    smooth(siren.frequency, pitch, 0.05);
    smooth(sirenHarmonic.frequency, pitch * 2, 0.05);
    smooth(sirenFilter.frequency, 1050 + distanceGain * 2200, 0.3);
    smooth(sirenGain.gain, wanted > 0 ? (0.026 + Math.min(5, wanted) * 0.006) * distanceGain * (searching ? 0.65 : 1) : 0, 0.45);
    const forwardX = finite(cameraForward?.x), forwardZ = finite(cameraForward?.z, -1);
    const forwardLength = Math.hypot(forwardX, forwardZ) || 1;
    smooth(sirenPan?.pan, clamp((dx * -forwardZ + dz * forwardX) / (Math.max(10, distance) * forwardLength), -0.88, 0.88), 0.18);

    const motion = Number.isFinite(footSpeed) ? Math.abs(footSpeed)
      : typeof velocity === 'number' ? Math.abs(velocity)
        : velocity ? Math.hypot(finite(velocity.x), finite(velocity.z)) : roadSpeed;
    if (!inCar && motion > 0.25) {
      footsteps(Math.min(motion, 12) * dt, sprinting,
        surface || (playerPosition && playerPosition.x < -119 ? 'sand' : 'concrete'));
    } else stepDistance = 0;

    if (now > trafficAt) {
      trafficAt = now + 11 + Math.random() * 11;
      const side = Math.random() < 0.5 ? -1 : 1;
      play({ sample: 'engine', looped: true, duration: 5.5, attack: 1.4, rate: 1.1,
        endRate: 0.72, volume: (0.018 + (1 - coast) * 0.022) * cabin * (1 - darkness * 0.45),
        cutoff: 650, pan: side * 0.85, endPan: side * -0.85 });
    }
    // Quiet original D-minor pulses emerge only during a pursuit, below the siren.
    if (wanted >= 2 && now > musicAt) {
      musicAt = now + 0.6;
      const notes = [73.416, 73.416, 87.307, 73.416, 110, 98, 87.307, 65.406];
      if (musicBeat % 2 === 0 || wanted >= 4) {
        play({ type: 'triangle', frequency: notes[musicBeat % 8], volume: 0.009 + Math.min(wanted, 5) * 0.002,
          duration: 0.5, attack: 0.035, cutoff: 260, echo: 0.16 });
      }
      musicBeat++;
    } else if (!wanted) { musicBeat = 0; musicAt = now + 0.4; }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (context) smooth(master.gain, enabled ? 0.62 : 0, 0.035);
    if (!enabled) clearTemporary();
  }
  function shoot() {
    const variation = 0.96 + Math.random() * 0.08;
    play({ noise: true, volume: 0.48, duration: 0.075, cutoff: 7200, highpass: 350, pan: 0.12, echo: 0.3 });
    play({ frequency: 165 * variation, endFrequency: 45, volume: 0.3, duration: 0.14, pan: 0.08 });
    play({ noise: true, volume: 0.13, duration: 0.3, cutoff: 1800, delay: 0.015, pan: -0.16, echo: 0.3 });
    play({ sample: 'click', volume: 0.1, duration: 0.16, rate: 1.5, delay: 0.075, pan: 0.22 });
    play({ sample: 'metal', volume: 0.025, duration: 0.2, rate: 1.9, delay: 0.35 + Math.random() * 0.12, pan: 0.4 });
  }
  function reload() {
    if (!play({ sample: 'magazine', volume: 0.28, duration: 0.32, pan: 0.16, cutoff: 5300 }))
      play({ noise: true, volume: 0.07, duration: 0.1, cutoff: 2800, pan: 0.16 });
    play({ sample: 'magazine', volume: 0.2, duration: 0.33, delay: 0.45, rate: 0.92, pan: -0.1 });
    play({ sample: 'click', volume: 0.2, duration: 0.2, delay: 0.83, rate: 1.25, pan: 0.14 });
  }
  function horn() {
    if (!ready() || context.currentTime - lastHorn < 0.45) return;
    lastHorn = context.currentTime;
    play({ type: 'triangle', frequency: 330, volume: 0.07, duration: 0.6, attack: 0.025, cutoff: 2300, echo: 0.18 });
    play({ type: 'triangle', frequency: 415, volume: 0.055, duration: 0.6, attack: 0.025, cutoff: 2300 });
  }
  function crash(intensity = 1) {
    if (!ready() || context.currentTime - lastCrash < 0.18) return;
    lastCrash = context.currentTime;
    const strength = clamp(finite(intensity, 1), 0.2, 1.5);
    play({ sample: 'metal', volume: strength * 0.35, duration: 0.38, rate: 0.7, cutoff: 3400, echo: 0.2 });
    play({ noise: true, volume: strength * 0.18, duration: 0.3, cutoff: 1600 });
    play({ frequency: 92, endFrequency: 30, volume: strength * 0.27, duration: 0.3 });
    if (strength > 0.8) play({ sample: 'glass', volume: 0.16, duration: 0.5, delay: 0.045, rate: 0.9, pan: -0.25 });
  }
  function door(open = false) {
    play({ sample: 'click', volume: 0.15, duration: 0.23, rate: open ? 0.8 : 1, pan: -0.3 });
    if (!open) {
      play({ sample: 'door', volume: 0.4, duration: 0.5, delay: 0.09, rate: 0.8, pan: -0.22 });
      play({ frequency: 86, endFrequency: 38, volume: 0.12, duration: 0.2, delay: 0.09 });
    }
  }
  function notify() {
    play({ frequency: 660, volume: 0.035, duration: 0.18, attack: 0.015 });
    play({ frequency: 880, volume: 0.03, duration: 0.28, delay: 0.12, attack: 0.015, echo: 0.12 });
  }
  function mission() {
    for (const [i, note] of [440, 554.365, 659.255, 880].entries())
      play({ type: 'sine', frequency: note, volume: 0.04, duration: 0.55, delay: i * 0.11, attack: 0.015, echo: 0.25 });
  }
  function interact() {
    if (!play({ sample: 'click', volume: 0.085, duration: 0.14, rate: 1.2, cutoff: 2400 }))
      play({ frequency: 500, endFrequency: 350, volume: 0.025, duration: 0.08 });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    clearTemporary();
    for (const source of continuous) { try { source.stop(); } catch { /* Already stopped. */ } }
    for (const node of nodes) node.disconnect();
    continuous.clear(); nodes.clear();
    for (const name of Object.keys(buffers)) delete buffers[name];
    if (context && context.state !== 'closed') context.close().catch(() => {});
    context = undefined;
  }

  return { start, setEnabled, update, shoot, reload, horn, crash, notify, door, mission, interact, dispose };
}
