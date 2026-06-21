let audio = null;

const audioSupport =
  typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeNoiseBuffer(ctx) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

export function ensureAudio() {
  if (!audioSupport) return null;
  if (!audio) {
    const ctx = new audioSupport();
    const master = ctx.createGain();
    const sfx = ctx.createGain();
    master.gain.value = 0.72;
    sfx.gain.value = 0.66;
    sfx.connect(master);
    master.connect(ctx.destination);
    audio = {
      ctx,
      master,
      sfx,
      noise: makeNoiseBuffer(ctx),
      lastSfx: new Map(),
    };
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return audio;
}

function playTone(freq, at, duration, options = {}) {
  if (!audio) return;
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.006;
  const release = options.release ?? 0.12;
  const endAt = at + duration;
  osc.type = options.type || 'sine';
  osc.frequency.setValueAtTime(Math.max(1, freq), at);
  if (options.endFreq) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, options.endFreq),
      Math.max(at + 0.01, endAt - release * 0.3),
    );
  }
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain ?? 0.05), at + attack);
  gain.gain.setTargetAtTime(0.0001, Math.max(at + attack, endAt - release), release);
  osc.connect(gain);
  gain.connect(options.destination || audio.sfx);
  osc.start(at);
  osc.stop(endAt + release + 0.04);
}

function playNoise(at, duration, options = {}) {
  if (!audio) return;
  const ctx = audio.ctx;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.004;
  const release = options.release ?? 0.08;
  const endAt = at + duration;
  source.buffer = audio.noise;
  filter.type = options.filterType || 'bandpass';
  filter.frequency.value = options.filter || 1200;
  filter.Q.value = options.q || 0.8;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain ?? 0.04), at + attack);
  gain.gain.setTargetAtTime(0.0001, Math.max(at + attack, endAt - release), release);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(options.destination || audio.sfx);
  source.start(at);
  source.stop(endAt + release + 0.04);
}

export function playSfx(name, intensity = 1) {
  const system = audio || ensureAudio();
  if (!system) return;
  const safeIntensity = clamp(intensity, 0, 1.4);
  const at = system.ctx.currentTime;
  const limits = { ui: 0.05, complete: 0.08, loot: 0.08 };
  const limit = limits[name] || 0.04;
  if (at - (system.lastSfx.get(name) || -99) < limit) return;
  system.lastSfx.set(name, at);

  if (name === 'ui') {
    playTone(620, at, 0.08, { gain: 0.035 * safeIntensity, endFreq: 780 });
  } else if (name === 'error') {
    playTone(118, at, 0.14, {
      gain: 0.052 * safeIntensity,
      type: 'sawtooth',
      endFreq: 82,
    });
  } else if (name === 'complete') {
    [0, 4, 7].forEach((step, index) =>
      playTone(520 * 2 ** (step / 12), at + index * 0.055, 0.18, {
        gain: 0.036 * safeIntensity,
      }),
    );
  } else if (name === 'loot') {
    [0, 3, 7, 12].forEach((step, index) =>
      playTone(460 * 2 ** (step / 12), at + index * 0.04, 0.14, {
        gain: 0.033 * safeIntensity,
      }),
    );
  } else if (name === 'ability') {
    [0, 7].forEach((step, index) =>
      playTone(500 * 2 ** (step / 12), at + index * 0.025, 0.18, {
        gain: 0.034 * safeIntensity,
        type: 'triangle',
      }),
    );
  } else if (name === 'melee') {
    playNoise(at, 0.08, {
      gain: 0.03 * safeIntensity,
      filter: 1200,
      filterType: 'highpass',
    });
    playTone(260, at, 0.08, {
      gain: 0.026 * safeIntensity,
      type: 'triangle',
      endFreq: 180,
    });
  } else if (name === 'hit') {
    playNoise(at, 0.07, {
      gain: 0.04 * safeIntensity,
      filter: 620,
      filterType: 'bandpass',
    });
    playTone(180, at, 0.1, {
      gain: 0.032 * safeIntensity,
      type: 'square',
      endFreq: 120,
    });
  } else if (name === 'guard') {
    playNoise(at, 0.055, {
      gain: 0.028 * safeIntensity,
      filter: 980,
      filterType: 'highpass',
    });
    [0, 7].forEach((step, index) =>
      playTone(360 * 2 ** (step / 12), at + index * 0.026, 0.11, {
        gain: 0.026 * safeIntensity,
        type: 'triangle',
        endFreq: 480,
      }),
    );
  } else if (name === 'defeat') {
    playTone(220, at, 0.12, {
      gain: 0.034 * safeIntensity,
      type: 'triangle',
      endFreq: 110,
    });
    playTone(146, at + 0.08, 0.18, {
      gain: 0.03 * safeIntensity,
      type: 'sine',
      endFreq: 92,
    });
  } else if (name === 'build') {
    playTone(118, at, 0.13, {
      gain: 0.068 * safeIntensity,
      type: 'triangle',
      endFreq: 86,
    });
    playNoise(at, 0.05, { gain: 0.036 * safeIntensity, filter: 700, filterType: 'lowpass' });
  }
}
