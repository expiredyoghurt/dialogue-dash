/* Dash Express sounds: a few short tones made with the browser's own audio, so there are no files to load.
   Quiet by default, never autoplay (browsers only allow sound after a tap), and one switch turns them off. */
(() => {
  'use strict';
  const KEY = 'dd_sound';
  let ctx = null;
  let on = true;
  try {
    on = localStorage.getItem(KEY) !== '0';
  } catch {}

  function audio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  // notes: [frequency Hz, start s, length s]
  function tones(notes, { type = 'sine', gain = 0.07 } = {}) {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended' && c.resume) c.resume().catch(() => {});
    const t0 = c.currentTime + 0.01;
    for (const [freq, at, len] of notes) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + at);
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + len + 0.03);
    }
  }

  const SOUNDS = {
    right: () => tones([[660, 0, 0.12], [880, 0.09, 0.18]]),
    wrong: () => tones([[220, 0, 0.18], [175, 0.12, 0.24]], { type: 'triangle', gain: 0.06 }),
    combo: () => tones([[660, 0, 0.1], [784, 0.07, 0.1], [988, 0.14, 0.2]]),
    slip: () => tones([[300, 0, 0.12], [240, 0.1, 0.16]], { type: 'triangle', gain: 0.05 }),
    done: () => tones([[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.3]]),
    levelup: () => tones([[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.12], [1319, 0.42, 0.35]]),
    tap: () => tones([[520, 0, 0.05]], { gain: 0.04 }),
  };

  window.DashSfx = {
    enabled: () => on,
    setEnabled(v, opts) {
      on = !!v;
      try {
        localStorage.setItem(KEY, on ? '1' : '0');
      } catch {}
      if (on && !(opts && opts.quiet)) SOUNDS.tap();
    },
    play(name) {
      if (!on || !SOUNDS[name]) return;
      try {
        SOUNDS[name]();
      } catch {} // sound is a nicety; never let it break the game
    },
  };
})();
