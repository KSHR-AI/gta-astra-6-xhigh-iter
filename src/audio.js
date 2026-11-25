import { assetUrl } from './asset-url.js';
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
const RADIO_NOTES = [293.66, 349.23, 440, 392, 0, 349.23, 329.63, 261.63];
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function createAudio() {
  let context, master, world, radioBus, echoInput, noiseBuffer;
  let radioAt = 0, radioBeat = 0, toolAt = 0;
  let passPan, passGain, passFilter, passTone;
  let engine, exhaust, transmission, engineFilter, engineGain, exhaustGain, transmissionGain;
  let engineSample, engineSampleGain, roadFilter, roadGain, tireFilter, tireGain, tireTone;
  let seaPan, seaFilter, windGain, seaGain, gullGain, siren, sirenHarmonic, sirenFilter, sirenGain, sirenPan;
  let enabled = true, disposed = false, active = true;
  let lastTime = 0, lastSpeed = 0, lastGear = 1, lastDistance = 80, shiftUntil = 0;
  let stepDistance = 0, stepIndex = 0, trafficAt = 4, musicAt = 0, musicBeat = 0;
  let lastCrash = -10, lastHorn = -10;
  let previousCar = false;
  let lastPistol = -1, groundSurface = 'concrete';
  const listener = { x: 0, y: 0, z: 0, forwardX: 0, forwardZ: -1 };
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
  const targets = new WeakMap();
  function smooth(param, value, time = 0.12) {
    if (!param || !Number.isFinite(value) || targets.get(param) === value) return;
    targets.set(param, value);
    param.setTargetAtTime(value, context.currentTime, time);
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
  function clearTemporary(group) {
    for (const voice of [...temporary]) {
      if (group && voice.group !== group) continue;
      try { voice.source.stop(); } catch { /* The voice may already have ended. */ }
      voice.clean();
    }
  }

  // Voices allocate only at an audible event, never for continuous frame updates.
  function play({ sample, noise = false, type = 'sine', frequency = 440, endFrequency,
    duration = 0.15, volume = 0.1, delay = 0, cutoff = 6000, highpass = 0,
    pan = 0, endPan, rate = 1, endRate, looped = false, attack = 0.004, echo = 0,
    offset = 0, group, bus = world } = {}) {
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
      envelope.connect(panner); panner.connect(bus);
    } else envelope.connect(bus);
    const send = echo ? context.createGain() : null;
    if (send) { send.gain.value = echo; envelope.connect(send); send.connect(echoInput); }
    const voice = { source, group, clean: () => {
      source.disconnect(); low.disconnect(); high?.disconnect(); envelope.disconnect();
      panner?.disconnect(); send?.disconnect(); temporary.delete(voice);
    } };
    temporary.add(voice);
    source.onended = voice.clean;
    source.start(now, ...(noise ? [Math.random() * 2] : buffer ? [offset] : []));
    source.stop(now + duration + 0.02);
    return true;
  }

  function createPistolBuffers() {
    // Original, baked pressure impulses: an irregular crack and short resonant
    // body, not a pitched oscillator sweep. Five variants are reused per shot.
    const sampleRate = context.sampleRate;
    for (let variant = 0; variant < 5; variant++) {
      const buffer = context.createBuffer(1, Math.ceil(sampleRate * 0.29), sampleRate);
      const data = buffer.getChannelData(0);
      const tone = 0.94 + Math.random() * 0.12;
      const bassCoefficient = 1 - Math.exp(-2 * Math.PI * 460 / sampleRate);
      const airCoefficient = 1 - Math.exp(-2 * Math.PI * 2400 / sampleRate);
      let low = 0, air = 0, previous = 0, dc = 0, peak = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const noise = Math.random() * 2 - 1;
        low += bassCoefficient * (noise - low);
        air += airCoefficient * (noise - air);
        const attack = 1 - Math.exp(-t / 0.00018);
        const crack = (noise - low) * (Math.exp(-t / 0.0055) + 0.23 * Math.exp(-t / 0.018));
        const body = low * 2.9 * Math.exp(-t / 0.027)
          + (Math.sin(t * 2 * Math.PI * 148 * tone)
            + 0.42 * Math.sin(t * 2 * Math.PI * 263 * tone)) * 0.19 * Math.exp(-t / 0.023);
        const tail = air * 0.2 * Math.exp(-t / 0.062) * (1 - Math.exp(-t / 0.009));
        const value = (crack + body + tail) * attack;
        // Remove subsonic/DC drift, then taper the already quiet tail to zero.
        dc = value - previous + 0.995 * dc; previous = value;
        const fade = clamp((0.29 - t) / 0.025, 0, 1);
        data[i] = dc * fade * fade;
        peak = Math.max(peak, Math.abs(data[i]));
      }
      for (let i = 0; i < data.length; i++) data[i] *= 0.92 / Math.max(peak, 0.001);
      buffers[`pistol${variant}`] = buffer;
    }

    // A small brass case has a bright, rapidly dying tick, not a heavy clang.
    const casing = context.createBuffer(1, Math.ceil(sampleRate * 0.095), sampleRate);
    const data = casing.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate, attack = 1 - Math.exp(-t / 0.0002);
      data[i] = attack * (0.34 * Math.sin(t * 2 * Math.PI * 3670) * Math.exp(-t / 0.012)
        + 0.2 * Math.sin(t * 2 * Math.PI * 5210) * Math.exp(-t / 0.008)
        + (Math.random() * 2 - 1) * 0.25 * Math.exp(-t / 0.002));
    }
    buffers.casing = casing;
  }

  function spatial(position) {
    if (!position) return { distance: 0, volume: 1, pan: 0.08, cutoff: 11000, delay: 0 };
    const dx = finite(position.x) - listener.x;
    const dy = finite(position.y) - listener.y;
    const dz = finite(position.z) - listener.z;
    const distance = Math.hypot(dx, dy, dz);
    const horizontal = Math.max(1, Math.hypot(dx, dz));
    return {
      distance,
      volume: 1 / (1 + Math.pow(distance / 17, 1.35)),
      pan: clamp((dx * -listener.forwardZ + dz * listener.forwardX) / horizontal, -0.92, 0.92),
      cutoff: 1800 + 9200 / (1 + distance / 24),
      delay: Math.min(0.22, distance / 343),
    };
  }

  function createMixer() {
    master = gain(enabled ? 0.62 : 0, null);
    const limiter = track(context.createDynamicsCompressor());
    limiter.threshold.value = -14; limiter.knee.value = 15; limiter.ratio.value = 6;
    limiter.attack.value = 0.004; limiter.release.value = 0.16;
    master.connect(limiter); limiter.connect(context.destination);
    world = gain(active ? 1 : 0, master);
    radioBus = gain(1);
    noiseBuffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    createPistolBuffers();

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
    seaPan = context.createStereoPanner ? track(context.createStereoPanner()) : null;
    seaPan?.connect(world);
    seaGain = gain(0, seaPan || world);
    seaFilter = filter('lowpass', 720, seaGain);
    loop(noiseBuffer, filter('highpass', 135, seaFilter), 0.81);
    gullGain = gain(0);

    passPan = context.createStereoPanner ? track(context.createStereoPanner()) : null;
    passPan?.connect(world);
    passGain = gain(0, passPan || world);
    passFilter = filter('lowpass', 530, passGain);
    passTone = oscillator('sawtooth', 60, passFilter);

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
      const response = await fetch(assetUrl(`audio/${filename}`), { signal: abort.signal });
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
    night = 0, active: running = true, surface, cameraForward, vehicleType, district, landmarks, passingCar, dialogueActive = false } = {}) {
    const wasActive = active;
    active = Boolean(running);
    if (!context || disposed) return;
    const now = context.currentTime;
    const dt = clamp(now - lastTime, 0, 0.15);
    lastTime = now;
    if (wasActive && !active) clearTemporary();
    smooth(world.gain, active ? 1 : 0, 0.06);
    if (playerPosition) {
      listener.x = finite(playerPosition.x); listener.y = finite(playerPosition.y); listener.z = finite(playerPosition.z);
    }
    if (cameraForward) {
      const x = finite(cameraForward.x), z = finite(cameraForward.z, -1);
      const length = Math.hypot(x, z) || 1;
      listener.forwardX = x / length; listener.forwardZ = z / length;
    }
    groundSurface = surface || (playerPosition && playerPosition.x < -119 ? 'sand' : 'concrete');
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
    const sedan = vehicleType === 'sedan' || vehicleType === 'police';
    // Closed sedan cabin suppresses upper harmonics and tire hiss. The Aurora
    // carries its intake note and road texture directly into the open cockpit.
    const combustion = engineRpm / (sedan ? 30 : 20);
    smooth(engine.frequency, combustion, 0.09);
    smooth(exhaust.frequency, engineRpm / 60, 0.11);
    smooth(engineFilter.frequency, (sedan ? 210 : 320) + rev * (sedan ? 640 : 1450) + load * 130, 0.1);
    smooth(engineGain.gain, drive * (engineSample && !sedan ? 0.024 : 0.075) * (0.5 + rev) * load * shifting);
    smooth(exhaustGain.gain, drive * (0.016 + rev * 0.019) * shifting);
    smooth(engineSample?.playbackRate, clamp(engineRpm / (sedan ? 1900 : 1450), 0.55, 3.7), 0.12);
    smooth(engineSampleGain.gain, drive * (sedan ? 0.038 + rev * 0.026 : 0.105 + rev * 0.08) * load * shifting, 0.15);
    smooth(transmission.frequency, 120 + roadSpeed * 8.5);
    smooth(transmissionGain.gain, drive * Math.min(0.009, roadSpeed * 0.00023));
    smooth(roadFilter.frequency, (sedan ? 330 : 530) + Math.min(roadSpeed, 50) * (sedan ? 12 : 22));
    smooth(roadGain.gain, drive * Math.min(0.11, Math.pow(roadSpeed / 45, 1.25) * 0.09), 0.25);
    const skid = drive * clamp(Math.abs(finite(slip)), 0, 1) * clamp(roadSpeed / 8, 0, 1);
    smooth(tireGain.gain, skid * 0.09, 0.06);
    smooth(tireFilter.frequency, 1350 + skid * 700 + Math.sin(now * 18) * 90, 0.04);
    smooth(tireTone.frequency, 650 + skid * 430 + Math.sin(now * 21) * 38, 0.04);

    const darkness = clamp(finite(night), 0, 1);
    const shoreline = playerPosition ? clamp((-finite(playerPosition.x) - 45) / 90, 0, 1) : 0.25;
    const paloma = landmarks?.safehouse && playerPosition ? Math.max(0, 1 - Math.hypot(listener.x - landmarks.safehouse.x, listener.z - landmarks.safehouse.z) / 48) : 0;
    const coast = Math.max(shoreline, paloma * .62);
    const workshop = landmarks?.garage && playerPosition ? Math.max(0, 1 - Math.hypot(listener.x - landmarks.garage.x, listener.z - landmarks.garage.z) / 34) : 0;
    const cabin = inCar ? sedan ? .43 : .78 : 1;
    smooth(radioBus.gain, dialogueActive ? .17 : 1, dialogueActive ? .075 : .45);
    const radioVolume = inCar ? (sedan ? .42 : .27) : workshop;
    if (radioVolume > .04 && now >= radioAt) {
      const radioPan = inCar ? -.13 : spatial(landmarks.garage).pan;
      const note = RADIO_NOTES[radioBeat % RADIO_NOTES.length];
      if (note) play({ type: 'triangle', frequency: note, duration: .35, attack: .025, volume: .058 * radioVolume,
        highpass: 240, cutoff: 1550, pan: radioPan, bus: radioBus });
      if (radioBeat % 4 === 0) play({ type: 'triangle', frequency: note ? note / 2 : 130.81, duration: .55,
        volume: .032 * radioVolume, highpass: 90, cutoff: 740, pan: radioPan, bus: radioBus });
      radioBeat++; radioAt = now + .39;
    }
    if (workshop > .1 && now >= toolAt) {
      const tools = spatial(landmarks.garage);
      for (const delay of [0, .27]) play({ sample: 'metal', volume: .09 * workshop * cabin, duration: .14,
        rate: 1.6, highpass: 620, cutoff: 3400, pan: tools.pan, delay });
      toolAt = now + 7 + Math.random() * 6;
    }
    // Breakers brighten as they crest and soften through a longer wash.
    const wavePhase = now * 0.82 + 0.55 * Math.sin(now * 0.19);
    const crest = (0.5 + 0.5 * Math.cos(wavePhase)) ** 3;
    const wash = 0.5 + 0.5 * Math.cos(wavePhase - 0.8);
    smooth(windGain.gain, (0.018 + coast * 0.015) * cabin * (0.85 + Math.sin(now * 0.23) * 0.15), 0.7);
    smooth(seaGain.gain, coast * (0.027 + crest * 0.065 + wash * 0.031) * cabin, 0.36);
    smooth(seaFilter.frequency, (620 + coast * (400 + crest * 2150)) * (inCar ? 0.58 : 1), 0.32);
    // The sea lies west of the boulevard. Keep a broad stereo image as the camera turns.
    smooth(seaPan?.pan, listener.forwardZ * 0.53, 0.2);
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
      footsteps(Math.min(motion, 12) * dt, sprinting, groundSurface);
    } else stepDistance = 0;

    const passingPosition = passingCar?.model?.mesh.position;
    if (!inCar && passingPosition) {
      const source = spatial(passingPosition);
      const sporty = passingCar.model.type === 'sport';
      const speed = Math.abs(finite(passingCar.speed));
      const rpm = clamp(finite(passingCar.rpm, 950 + speed * 95), 700, 7000);
      smooth(passTone.frequency, rpm / (sporty ? 20 : 30), .19);
      smooth(passFilter.frequency, (sporty ? 560 : 340) + 950 * source.volume, .2);
      smooth(passGain.gain, .064 * source.volume * clamp(speed / 3, 0, 1), .18);
      smooth(passPan?.pan, source.pan, .12);
    } else smooth(passGain.gain, 0, .18);
    if (!passingPosition && now > trafficAt) {
      trafficAt = now + 11 + Math.random() * 11;
      const side = Math.random() < 0.5 ? -1 : 1;
      play({ sample: 'engine', looped: true, duration: 5.5, attack: 1.4, rate: 1.1,
        endRate: 0.72, volume: (0.018 + (1 - coast) * 0.022) * cabin * (1 - darkness * 0.45),
        cutoff: district === 'Ocean Drive' ? 1050 : 650, pan: side * 0.85, endPan: side * -0.85 });
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
  function shoot({ position } = {}) {
    if (!ready()) return;
    if (!position) cancelReload();
    const location = spatial(position);
    if (location.volume < 0.025) return;
    // Avoid consecutive identical transients while keeping every shot the same weapon.
    lastPistol = (lastPistol + 1 + Math.floor(Math.random() * 4)) % 5;
    const rate = 0.975 + Math.random() * 0.05;
    play({ sample: `pistol${lastPistol}`, volume: 0.77 * location.volume * (0.96 + Math.random() * 0.08),
      duration: 0.30, rate, attack: 0.0002, highpass: 55, cutoff: location.cutoff,
      pan: location.pan, delay: location.delay, echo: 0.23 });
    // The slide cycles immediately; the case reaches the ground later and bounces.
    if (location.distance < 12) {
      play({ sample: 'click', volume: 0.048 * location.volume, duration: 0.025, offset: 0.002,
        rate: 1.25, cutoff: 4600, highpass: 800, delay: location.delay + 0.043, pan: location.pan });
      const hardGround = groundSurface !== 'grass' && groundSurface !== 'sand';
      if (hardGround) {
        const landing = 0.43 + Math.random() * 0.12 + location.delay;
        const casePan = clamp(location.pan + 0.29, -0.92, 0.92);
        play({ sample: 'casing', volume: 0.085 * location.volume, duration: 0.095, rate: 0.9 + Math.random() * 0.2,
          delay: landing, pan: casePan, cutoff: location.cutoff, attack: 0.0003 });
        play({ sample: 'casing', volume: 0.028 * location.volume, duration: 0.075, rate: 1.13,
          delay: landing + 0.12 + Math.random() * 0.05, pan: casePan, cutoff: 6500, attack: 0.0003 });
      }
    }
  }
  function cancelReload() { clearTemporary('reload'); }
  function reload({ duration = 1.45 } = {}) {
    if (!ready()) return;
    cancelReload();
    const seconds = clamp(finite(duration, 1.45), 0.65, 4);
    const variation = 0.97 + Math.random() * 0.06;
    const common = { group: 'reload', cutoff: 4800, highpass: 180 };
    if (!play({ ...common, sample: 'click', volume: 0.095, duration: 0.025, offset: 0.002, rate: 1.2 * variation, pan: 0.12 }))
      play({ ...common, noise: true, volume: 0.045, duration: 0.045, cutoff: 2200, pan: 0.12 });
    if (!play({ ...common, sample: 'magazine', volume: 0.14, duration: 0.022, offset: 0.072,
      delay: seconds * 0.16, rate: 0.86 * variation, pan: -0.1 }))
      play({ ...common, noise: true, volume: 0.035, duration: 0.12, delay: seconds * 0.16, cutoff: 1700 });
    if (!play({ ...common, sample: 'magazine', volume: 0.22, duration: 0.023, offset: 0.102,
      delay: seconds * 0.60, rate: 1.05 * variation, pan: -0.035 }))
      play({ ...common, noise: true, volume: 0.06, duration: 0.08, delay: seconds * 0.60, cutoff: 3000 });
    if (!play({ ...common, sample: 'click', volume: 0.16, duration: 0.035, offset: 0.002,
      delay: seconds * 0.85, rate: 1.1 * variation, pan: 0.13 }))
      play({ ...common, noise: true, volume: 0.055, duration: 0.045, delay: seconds * 0.85, cutoff: 4200 });
  }
  function dryFire() {
    if (!play({ sample: 'click', volume: 0.065, duration: 0.023, offset: 0.002, rate: 1.45, cutoff: 2700, highpass: 500, pan: 0.08 }))
      play({ noise: true, volume: 0.045, duration: 0.025, cutoff: 2200, highpass: 550, pan: 0.08 });
  }
  function impact({ position, material, surface = material || 'concrete', strength = 1, delay = 0 } = {}) {
    if (!ready()) return;
    const location = spatial(position);
    const level = clamp(finite(strength, 1), 0.15, 1.5) * location.volume;
    const when = location.delay + clamp(finite(delay), 0, 1);
    const soft = surface === 'body' || surface === 'flesh' || surface === 'sand' || surface === 'grass';
    play({ noise: true, volume: (soft ? 0.13 : 0.19) * level, duration: soft ? 0.085 : 0.055,
      cutoff: Math.min(location.cutoff, soft ? 850 : 4700), highpass: soft ? 70 : 650,
      delay: when, pan: location.pan, attack: 0.0006, echo: soft ? 0 : 0.09 });
    if (surface === 'metal' || surface === 'vehicle' || surface === 'glass')
      play({ sample: surface === 'glass' ? 'glass' : 'metal', volume: 0.13 * level,
        duration: surface === 'glass' ? 0.25 : 0.14, rate: 1.35 + Math.random() * 0.15,
        cutoff: location.cutoff, highpass: 650, delay: when, pan: location.pan });
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
  function recordingCue(site) {
    if (site === 'boulevard') {
      play({ type: 'triangle', frequency: 135, endFrequency: 58, duration: .8, volume: .06, cutoff: 900, pan: -.4 });
      play({ noise: true, volume: .055, duration: .9, cutoff: 1450, highpass: 180, attack: .13, pan: .35 });
    } else {
      play({ noise: true, volume: .04, duration: .45, cutoff: 2100, highpass: 500, attack: .1 });
      play({ type: 'sine', frequency: 1800, endFrequency: 2450, volume: .018, duration: .11, delay: .15 });
      play({ type: 'sine', frequency: 2100, endFrequency: 1600, volume: .017, duration: .13, delay: .34 });
    }
  }
  function shutter(position) {
    const at = spatial(position);
    if (at.volume < .04) return;
    const common = { pan: at.pan, volume: .21 * at.volume, cutoff: Math.min(at.cutoff, 2100), group: 'shutter' };
    clearTemporary('shutter');
    play({ ...common, noise: true, looped: true, duration: 1.45, attack: .18, highpass: 430 });
    play({ ...common, type: 'sawtooth', frequency: 58, endFrequency: 86, duration: 1.3, attack: .13, cutoff: 300 });
    for (const delay of [0, .21, .43, .69, .98, 1.27]) {
      play({ ...common, sample: 'click', rate: .74, duration: .08, delay });
    }
    play({ ...common, sample: 'door', duration: .31, rate: .72, delay: 1.46 });
  }
  function handoff() {
    play({ sample: 'click', volume: .16, rate: 1.5, duration: .1, pan: -.12 });
    play({ sample: 'metal', volume: .085, highpass: 1100, rate: 1.8, duration: .12, delay: .09, pan: .13 });
    mission();
  }
  function startProjection(position) {
    const at = spatial(position);
    clearTemporary('projection');
    const projector = { group:'projection', pan:at.pan, volume:.09*at.volume };
    play({ ...projector, sample:'click', rate:.72, duration:.14 });
    play({ ...projector, type:'sawtooth', frequency:31, endFrequency:49,
      attack:.28, duration:1.8, cutoff:260 });
    // A brushed, minor-seventh chord as the opening title comes into focus.
    for (const [index,note] of [146.83,220,261.63,349.23].entries())
      play({ group:'projection', type:'triangle', frequency:note, pan:(index-1.5)*.13,
        volume:.037, delay:.55+index*.23, duration:1.8, attack:.08, cutoff:1450, echo:.16 });
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

  return { start, setEnabled, update, shoot, reload, cancelReload, dryFire, impact,
    horn, crash, notify, door, mission, shutter, handoff, startProjection, recordingCue, interact, dispose };
}
