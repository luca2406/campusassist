/* ==========================================================
   CampusAssist – feedback.js
   Output fission: earcons (Web Audio), haptics (Vibration API),
   speech (TTS), captions, visual flash, screen-reader live regions.
   ========================================================== */
CA.Feedback = (() => {
  'use strict';
  const state = { muted: false, hapticsOn: true, quietZone: false, noisy: false };
  let actx = null, last = '';
  const cfg = () => (CA.App && CA.App.settings) || {};

  function audio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  function tone(freq, start, dur, { pan = 0, type = 'sine', vol = 0.2 } = {}) {
    const c = audio(); if (!c) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    let out = gain;
    if (c.createStereoPanner) {               // left/right spatial cue (earphones)
      const p = c.createStereoPanner(); p.pan.setValueAtTime(pan, t0);
      gain.connect(p); out = p;
    }
    out.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /* Earcon vocabulary – Detailed Design §6.5 */
  const EARCONS = {
    listen:    () => tone(880, 0, 0.08),
    listenEnd: () => tone(660, 0, 0.08),
    click:     () => tone(1200, 0, 0.03, { vol: 0.05 }),
    left:      () => { tone(523, 0, 0.12, { pan: -0.8 }); tone(784, 0.15, 0.15, { pan: -0.8 }); },
    right:     () => { tone(784, 0, 0.12, { pan: 0.8 });  tone(523, 0.15, 0.15, { pan: 0.8 }); },
    lift:      () => { tone(1319, 0, 0.5, { type: 'triangle' }); tone(1047, 0.25, 0.6, { type: 'triangle' }); },
    offroute:  () => { tone(660, 0, 0.2, { type: 'square', vol: 0.12 }); tone(440, 0.25, 0.3, { type: 'square', vol: 0.12 }); },
    arrive:    () => { tone(523, 0, 0.15); tone(659, 0.15, 0.15); tone(784, 0.3, 0.35); },
    confirm:   () => { tone(660, 0, 0.08); tone(990, 0.1, 0.12); },
    error:     () => { tone(220, 0, 0.15, { type: 'sawtooth', vol: 0.1 }); tone(220, 0.2, 0.15, { type: 'sawtooth', vol: 0.1 }); },
    emergency: () => { for (let i = 0; i < 3; i++) tone(988, i * 0.35, 0.25, { type: 'square', vol: 0.15 }); }
  };

  /* Haptic vocabulary (ms: vibrate, pause, vibrate …) */
  const HAPTICS = {
    tick: [10], listen: [50], straight: [100],
    left: [100, 100, 100],                 // 2 pulses
    right: [100, 100, 100, 100, 100],      // 3 pulses
    lift: [300], offroute: [600], arrive: [500],
    error: [60, 60, 60], emergency: [300, 150, 300, 150, 300]
  };

  /* Multimodal cue = earcon + haptic (+ speech) – redundancy (CARE) */
  const CUES = {
    straight: [null, 'straight'], left: ['left', 'left'], right: ['right', 'right'],
    lift: ['lift', 'lift'], escalator: ['lift', 'lift'], stairs: ['lift', 'lift'],
    stop: ['confirm', 'straight'], offroute: ['offroute', 'offroute'], arrive: ['arrive', 'arrive'],
    error: ['error', 'error'], emergency: ['emergency', 'emergency'], confirm: ['confirm', 'tick']
  };

  const soundAllowed = () => { const s = cfg(); return !(s.quiet || state.muted || state.quietZone); };

  function earcon(name) {
    if (!soundAllowed()) return;
    const f = EARCONS[name]; if (f) { try { f(); } catch (e) { /* audio blocked */ } }
  }

  function haptic(name) {
    if (!state.hapticsOn) return;
    const pat = HAPTICS[name]; if (!pat) return;
    let k = { low: 0.6, med: 1, high: 1.5 }[cfg().haptic || 'med'] || 1;
    if (state.noisy || cfg().hearing) k = Math.max(k, 1.5);   // context-aware boost
    const scaled = pat.map((v, i) => (i % 2 === 0 ? Math.round(v * k) : v));
    if (navigator.vibrate) { try { navigator.vibrate(scaled); } catch (e) {} }
    if (name !== 'tick') showViz(scaled);  // visual equivalent for devices without vibration
  }

  function showViz(pat) {
    const el = document.getElementById('hapticViz'); if (!el) return;
    const pulses = pat.filter((_, i) => i % 2 === 0);
    el.innerHTML = '📳 ' + pulses.map(d => `<i style="width:${Math.max(8, d / 8)}px"></i>`).join('');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  function announce(text, assertive = false) {
    const el = document.getElementById(assertive ? 'srAssert' : 'srPolite'); if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 60);
  }

  let capTimer = null;
  function caption(text) {
    const c = document.getElementById('caption'); if (!c) return;
    c.textContent = text; c.hidden = false;
    clearTimeout(capTimer); capTimer = setTimeout(() => { c.hidden = true; }, 4500);
  }

  /* priority: 'high' interrupts (instructions), 'normal' queues, 'low' dropped if busy (ducking) */
  function speak(text, { priority = 'normal', force = false } = {}) {
    if (!text) return;
    last = text;
    const s = cfg();
    const willSpeak = force || !(s.quiet || state.muted || state.quietZone || s.hearing);
    if (s.hearing || s.quiet || state.quietZone || state.muted) caption(text);
    if (!willSpeak || !('speechSynthesis' in window)) { announce(text, priority === 'high'); return; }
    const synth = window.speechSynthesis;
    if (priority === 'high') synth.cancel();
    else if (priority === 'low' && synth.speaking) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = s.rate || 1; u.lang = 'en-GB';
    synth.speak(u);
  }

  function flash() {
    const a = document.getElementById('app'); if (!a) return;
    a.classList.remove('flash'); void a.offsetWidth; a.classList.add('flash');
  }

  function cue(type, text, opts = {}) {
    const c = CUES[type] || [];
    if (c[0]) earcon(c[0]);
    if (c[1]) haptic(c[1]);
    if (text) speak(text, Object.assign({ priority: 'high' }, opts));
    if (state.noisy || cfg().hearing) flash();
  }

  return { state, earcon, haptic, speak, announce, caption, cue, flash, lastSpoken: () => last };
})();