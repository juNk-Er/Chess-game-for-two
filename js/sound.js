/*
 * Small synthesized sound effects (Web Audio API), so no audio files are needed.
 */
(function (global) {
  'use strict';

  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** A short filtered noise burst: sounds like a wooden piece being placed. */
  function knock(when, { freq = 1800, gain = 0.6, length = 0.07 } = {}) {
    const ac = audio();
    const frames = Math.floor(ac.sampleRate * length);
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 4);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(when);
  }

  function tone(when, freq, length, gain = 0.15, type = 'sine') {
    const ac = audio();
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + length);
    osc.connect(g).connect(ac.destination);
    osc.start(when);
    osc.stop(when + length + 0.02);
  }

  const effects = {
    move(t) {
      knock(t, { freq: 1500, gain: 0.7 });
    },
    capture(t) {
      knock(t, { freq: 900, gain: 0.9, length: 0.09 });
      knock(t + 0.05, { freq: 1600, gain: 0.5 });
    },
    castle(t) {
      knock(t, { freq: 1500, gain: 0.7 });
      knock(t + 0.1, { freq: 1300, gain: 0.6 });
    },
    check(t) {
      knock(t, { freq: 1500, gain: 0.6 });
      tone(t + 0.02, 880, 0.18, 0.12, 'triangle');
    },
    promote(t) {
      knock(t, { freq: 1500, gain: 0.6 });
      tone(t + 0.02, 660, 0.12, 0.1, 'triangle');
      tone(t + 0.1, 990, 0.18, 0.1, 'triangle');
    },
    end(t) {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(t + i * 0.12, f, 0.6, 0.12, 'triangle'));
    },
    lowTime(t) {
      tone(t, 1200, 0.08, 0.08, 'square');
    },
  };

  const Sound = {
    enabled: true,
    play(name) {
      if (!this.enabled || !effects[name]) return;
      try {
        const ac = audio();
        if (ac) effects[name](ac.currentTime + 0.01);
      } catch (err) {
        // Audio is a nicety; never let it break the game.
      }
    },
  };

  global.Sound = Sound;
})(window);
