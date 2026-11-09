/* ==========================================================
   CampusAssist – voice.js
   Push-to-talk speech recognition (Web Speech API).
   ========================================================== */
CA.Voice = (() => {
  'use strict';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, active = false;

  function start({ lang = 'en-GB', onInterim, onFinal, onError, onEnd } = {}) {
    if (!SR) { onError && onError('unsupported'); return false; }
    if (active) stop();
    rec = new SR();
    rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 3;
    let gotFinal = false;
    rec.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) { gotFinal = true; onFinal && onFinal(r[0].transcript, r[0].confidence); }
        else interim += r[0].transcript;
      }
      if (interim && onInterim) onInterim(interim);
    };
    rec.onerror = ev => { onError && onError(ev.error); };
    rec.onend = () => { active = false; onEnd && onEnd(gotFinal); };
    try { rec.start(); active = true; } catch (e) { onError && onError('start-failed'); return false; }
    return true;
  }
  function stop() { if (rec && active) { try { rec.stop(); } catch (e) {} } }

  return { supported: () => !!SR, start, stop, isActive: () => active };
})();