/* ==========================================================
   CampusAssist – app.js
   Screens, state, voice-intent handling (fusion with touch),
   navigation simulation, off-route recovery, quiet/noisy
   context adaptation, AR, Emergency Assist, settings.
   ========================================================== */
CA.App = (() => {
  'use strict';
  const R = CA.Router, N = R.N, F = CA.Feedback;
  const $ = s => document.querySelector(s);
  const STORE = 'campusassist.v1';

  const DEFAULTS = {
    lang: 'en', mode: 'fastest', voice: true, rate: 1, haptics: true, haptic: 'med',
    textSize: 100, hc: false, dark: false, lowvision: false, hearing: false,
    quiet: false, autoQuiet: true, profile: null
  };
  const stored = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const settings = Object.assign({}, DEFAULTS, stored.settings || {});
  const data = { favs: stored.favs || [], recent: stored.recent || [] };

  const S = {
    screen: 'home', history: [], selected: null, results: null, plan: null, route: null,
    nav: null, timer: null, pin: null, pinNode: null, pending: null, pendingMode: null,
    filter: new Set(), sheet: 'half', follow: true, query: '', arrived: null, navOrigin: null,
    ar: false, autoQuiet: false
  };
  const user = { node: 'mtr', floor: N.mtr.floor, x: N.mtr.x, y: N.mtr.y, acc: 3, heading: null };

  const PRESETS = [
    { id: 'standard',  icon: '🙂', label: 'Standard',              desc: 'Default settings',            v: {} },
    { id: 'mobility',  icon: '♿', label: 'Wheelchair / mobility', desc: 'Step-free routes by default', v: { mode: 'stepfree' } },
    { id: 'lowvision', icon: '👁', label: 'Low vision',            desc: 'Large text, high contrast',   v: { textSize: 125, hc: true, lowvision: true } },
    { id: 'blind',     icon: '🦯', label: 'Blind / screen reader', desc: 'Voice and vibration first',   v: { haptic: 'high', rate: 1.1, lowvision: true } },
    { id: 'hearing',   icon: '🦻', label: 'Deaf / hard of hearing',desc: 'Captions, strong vibration',  v: { hearing: true, voice: false, haptic: 'high' } },
    { id: 'visitor',   icon: '🧳', label: 'Visitor',               desc: 'Covered routes, landmarks',   v: { mode: 'covered' } }
  ];
  const EXAMPLES = ['Where is B4302', 'Take me to LT-18 step-free', 'Nearest toilet', 'Where am I', 'Help'];
  const ICON = { start: '●', straight: '⬆', left: '⬅', right: '➡', lift: '⇅', escalator: '⇗', stairs: '≣', stop: '⏸', arrive: '⚑' };
  const MODE_IC = { fastest: '⚡', stepfree: '♿', covered: '☂' };
  const SIZES = ['peek', 'half', 'full'];
  let sheetEl, contentEl;

  /* ---------------- Helpers ---------------- */
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify({ settings, favs: data.favs, recent: data.recent })); } catch (e) {} };
  const t = k => (CA.I18N[settings.lang] || CA.I18N.en)[k] || CA.I18N.en[k] || k;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
  const floorL = R.floorLabel;
  const fmtTime = s => (s < 60 ? '<1 min' : `${Math.round(s / 60)} min`);
  const fmtDist = m => (m < 10 ? `${Math.max(1, Math.round(m))} m` : `${Math.round(m / 5) * 5} m`);
  const fmtH = h => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
  const bldName = n => { const b = CA.BUILDINGS.find(x => x.id === n.bld); return b ? b.name : (n.outdoor ? 'Outdoor' : 'Campus'); };
  const title = n => n.code || n.name;
  const currentNode = () => user.node || R.nearestNode(user.floor, user.x, user.y);

  function isOpen(n) {
    if (!n.hours) return null;
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    return n.hours.some(([a, b]) => h >= a && h < b);
  }
  function hoursText(n) {
    if (!n.hours) return '';
    if (n.hours.length === 1 && n.hours[0][0] === 0 && n.hours[0][1] === 24) return 'Open 24 hours';
    return n.hours.map(([a, b]) => `${fmtH(a)}–${fmtH(b)}`).join(', ');
  }
  function nearestOf(type, from = currentNode(), mode = 'fastest') {
    return CA.NODES.filter(n => n.poi === type)
      .map(n => { const r = n.id === from ? { time: 0 } : R.route(from, n.id, mode); return { n, time: r ? r.time : Infinity }; })
      .filter(o => o.time < Infinity).sort((a, b) => a.time - b.time);
  }
  function addRecent(id) {
    data.recent = [id, ...data.recent.filter(x => x !== id)].slice(0, 8);
    persist();
  }

  /* ---------------- Toast & dialog ---------------- */
  let toastTimer = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    el.hidden = false;
    if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
    F.announce(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3500);
  }

  function openDialog(html, onAct, onClose) {
    const d = $('#dialog');
    if (d.open) d.close();
    d.innerHTML = `<div class="dlg">${html}</div>`;
    d.onclick = e => {
      const b = e.target.closest('[data-dlg]'); if (!b) return;
      if (b.dataset.dlg === 'close') { closeDialog(); return; }
      if (onAct) onAct(b.dataset.dlg, b, e);
    };
    d.onclose = () => { d.onclose = null; if (onClose) onClose(); };
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    const h = d.querySelector('h2'); if (h) d.setAttribute('aria-label', h.textContent);
    const first = d.querySelector('input, button, a[href]'); if (first) first.focus();
  }
  function closeDialog() { const d = $('#dialog'); if (d.open) d.close(); else d.removeAttribute('open'); }

  /* ---------------- Settings ---------------- */
  function applySettings() {
    const b = document.body;
    b.classList.toggle('hc', !!settings.hc);
    b.classList.toggle('dark', !!settings.dark && !settings.hc);
    b.classList.toggle('lowvision', !!settings.lowvision);
    document.documentElement.style.fontSize = (16 * settings.textSize / 100) + 'px';
    F.state.hapticsOn = !!settings.haptics;
    F.state.muted = !settings.voice;
    applyLang();
  }
  function applyLang() {
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-HK' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
    $('#langBtn').textContent = settings.lang === 'zh' ? '中' : 'EN';
    $('#emgBtn').setAttribute('aria-label', `${t('emergency')}. ${t('holdHint')}`);
  }
  function applyPreset(id, silent) {
    const p = PRESETS.find(x => x.id === id); if (!p) return;
    Object.assign(settings,
      { mode: 'fastest', voice: true, rate: 1, haptic: 'med', textSize: 100, hc: false, lowvision: false, hearing: false },
      p.v, { profile: id });
    applySettings(); persist();
    if (!silent) toast(`${p.label} profile applied.`);
  }

  /* ---------------- Status bar & floor hint ---------------- */
  function updateStatus() {
    const near = N[R.nearestNode(user.floor, user.x, user.y)];
    $('#statusLoc').textContent = `◉ ${floorL(user.floor)}${near ? ' · near ' + near.name : ''}`;
    $('#accBadge').textContent = `±${user.acc} m`;
  }
  function updateFloorHint() {
    const h = $('#floorHint'), f = CA.Map.getFloor();
    let msg = null, target = null;
    const sel = (S.screen === 'plan' && S.route) ? N[S.route.to] : (S.screen === 'place' && S.selected ? N[S.selected] : null);
    if (sel && sel.floor !== f) { msg = `${title(sel)} is on ${floorL(sel.floor)}`; target = sel.floor; }
    else if (user.floor !== f) { msg = `You are on ${floorL(user.floor)}`; target = user.floor; }
    if (!msg) { h.hidden = true; return; }
    h.innerHTML = `<span>${esc(msg)}</span><button type="button">Show ${floorL(target)}</button>`;
    h.hidden = false;
    h.querySelector('button').onclick = () => CA.Map.setFloor(target);
  }

  /* ---------------- User position ---------------- */
  function placeUser(x, y, floor, heading = user.heading) {
    const floorChanged = floor !== user.floor;
    Object.assign(user, { x, y, floor, heading });
    CA.Map.setUser(user);
    if (S.nav) CA.Map.setProgress(S.nav.k, x, y);
    if (floorChanged && S.follow) CA.Map.setFloor(floor, { silent: true });
    if (S.nav && S.follow) CA.Map.centerOn(x, y, sheetFrac());
    updateStatus();
    if (floorChanged) updateFloorHint();
  }
  function setMyLocation(floor, x, y, node) {
    user.node = node; user.acc = 3;
    placeUser(x, y, floor, null);
    toast(`Location set: ${floorL(floor)}, near ${N[node].name}.`);
  }

  /* ---------------- Bottom sheet ---------------- */
  function setSheet(size) {
    S.sheet = size;
    sheetEl.className = `sheet sheet--${size}`;
    $('#app').style.setProperty('--sheet-h', size === 'peek' ? '176px' : '48%');
    $('#sheetHandle').setAttribute('aria-label', `Resize panel (currently ${size})`);
  }
  function sheetFrac() {
    const mv = $('#mapView').offsetHeight || 1;
    return S.sheet === 'peek' ? 176 / mv : 0.48;
  }

  function show(screen, { push = true, focus = true } = {}) {
    if (push && S.screen !== screen) S.history.push(S.screen);
    S.screen = screen;
    renderSheet(focus);
  }
  function back() {
    if (S.screen === 'plan') { S.plan = null; S.route = null; CA.Map.setRoute(null); }
    if (S.screen === 'place') { S.selected = null; CA.Map.setHighlight(null); }
    if (S.screen === 'pin') { S.pin = null; CA.Map.setPin(null); }
    S.pending = null;
    S.screen = S.history.pop() || 'home';
    if (S.screen === 'place' && !S.selected) S.screen = 'home';
    if (S.screen === 'plan' && !S.plan) S.screen = 'home';
    renderSheet(true);
  }

  const RENDER = {
    home: () => homeHTML(), results: () => resultsHTML(), place: () => placeHTML(),
    plan: () => planHTML(), nav: () => navHTML(), arrived: () => arrivedHTML(), pin: () => pinHTML()
  };
  function renderSheet(focus = true) {
    contentEl.innerHTML = (RENDER[S.screen] || RENDER.home)();
    contentEl.scrollTop = 0;
    if (S.screen === 'nav') updateNavUI();
    if (focus) {
      const h = contentEl.querySelector('h2[tabindex]');
      if (h) h.focus();
    }
    updateFloorHint();
  }
  function refocus(act, id) {
    const sel = `[data-act="${act}"]` + (id != null ? `[data-id="${id}"]` : '');
    const el = contentEl.querySelector(sel); if (el) el.focus();
  }

  const header = (text, backBtn = true) =>
    `<div class="sheet-top">${backBtn ? '<button class="icon-btn" data-act="back" aria-label="Back">←</button>' : ''}<h2 tabindex="-1">${text}</h2></div>`;

  function resultBtn(n, tag = '', attr = 'data-act') {
    const z = n.zone && CA.ZONES[n.zone];
    const type = CA.POI_TYPES[n.poi || n.cat];
    const bar = z
      ? `<span class="zone-bar" style="background:${z.color};color:${z.text}" aria-hidden="true">${n.zone}</span>`
      : `<span class="zone-bar" aria-hidden="true">${type ? type.icon : '📍'}</span>`;
    const sub = [floorL(n.floor), bldName(n), z ? z.name : (n.code ? n.name : '')].filter(Boolean).join(' · ');
    return `<button class="result" ${attr}="place" data-id="${n.id}">${bar}<span class="r-body"><strong>${esc(title(n))}</strong><span>${esc(sub)}</span></span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</button>`;
  }
  const resultItem = (n, tag) => `<li>${resultBtn(n, tag)}</li>`;

  const stepsHTML = (steps, pre) => `<ol class="steps">${steps.map((s, i) => `
    <li class="step" id="${pre}-${i}">
      <span class="step-ic" aria-hidden="true">${ICON[s.type] || '•'}</span>
      <span class="step-t">${esc(s.text)}</span>
      <span class="step-m">${s.dist ? fmtDist(s.dist) : ''}<span class="fbadge">${floorL(s.toFloor || s.floor)}</span></span>
    </li>`).join('')}</ol>`;

  /* ---------------- Screen: Home ---------------- */
  function homeHTML() {
    const chips = Object.entries(CA.POI_TYPES).filter(([, v]) => v.chip).map(([k, v]) =>
      `<button class="chip" data-act="chip" data-id="${k}" aria-pressed="${S.filter.has(k)}"><span aria-hidden="true">${v.icon}</span>${esc(v.label)}</button>`).join('');
    const c = CA.TIMETABLE[0];
    const next = c && N[c.node] ? `
      <div class="tip"><span aria-hidden="true">📅</span>
        <div><strong>Next class</strong><br>${esc(c.course)}<br><span class="muted">${esc(c.dayName)} ${esc(c.time)} · ${esc(title(N[c.node]))}</span></div>
        <button class="btn btn-primary" data-act="route" data-id="${c.node}">${t('go')}</button>
      </div>` : '';
    const rec = data.recent.filter(id => N[id]).slice(0, 4).map(id => resultItem(N[id])).join('');
    const hints = `<div class="voice-hints" role="group" aria-label="Voice command examples">
      <span class="muted" aria-hidden="true">🎤 Try:</span>
      ${EXAMPLES.slice(0, 3).map(x => `<button class="pill pill--say" data-act="say" data-v="${esc(x)}">“${esc(x)}”</button>`).join('')}
      </div>`;
    return `
      <h2 class="sr-only" tabindex="-1">Search</h2>
      <div class="search-row">
        <label class="search"><span aria-hidden="true">🔍</span><span class="sr-only">Search</span>
          <input id="q" type="search" placeholder="${esc(t('searchPh'))}" autocomplete="off" enterkeyhint="search"
                 value="${esc(S.query)}" role="combobox" aria-expanded="false" aria-controls="suggest" aria-autocomplete="list">
        </label>
        <button class="mic" data-act="mic" aria-label="Voice command. Tap to talk, or press and hold.">🎤</button>
      </div>
      <ul class="suggest" id="suggest" role="listbox" aria-label="Suggestions" hidden></ul>
      <div class="chips" role="group" aria-label="Find nearby">${chips}</div>
      ${S.filter.size ? nearbyHTML() : ''}
      ${next}
      <h3 class="sec-h">${t('recent')}</h3>
      <ul class="results">${rec || '<li class="muted">No recent places yet. Try “B4302” or “LT-18”.</li>'}</ul>`;
  }
  function nearbyHTML() {
    const from = currentNode();
    const rows = [...S.filter].flatMap(tp => nearestOf(tp, from).slice(0, 3).map((o, i) =>
      resultItem(o.n, (i === 0 ? 'Nearest · ' : '') + fmtTime(o.time) + (isOpen(o.n) === false ? ' · Closed' : ''))));
    return `<h3 class="sec-h">Nearby</h3><ul class="results">${rows.join('') || '<li class="muted">None found.</li>'}</ul>`;
  }
  function updateSuggest(q) {
    const box = $('#suggest'), input = $('#q'); if (!box || !input) return;
    if (!q.trim()) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    const r = CA.NLU.search(q, { fromNode: currentNode() });
    const items = (r.items.length ? r.items : r.suggestions || []).slice(0, 5);
    if (!items.length) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    box.innerHTML = items.map((n, i) => {
      const tp = CA.POI_TYPES[n.poi || n.cat];
      return `<li role="presentation"><button role="option" id="sg-${i}" data-act="place" data-id="${n.id}">
        <span aria-hidden="true">${n.zone ? n.zone : (tp ? tp.icon : '📍')}</span><span>${esc(title(n))}</span><small>${floorL(n.floor)}</small></button></li>`;
    }).join('');
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function doSearch(q) {
    q = (q || '').trim(); if (!q) return;
    S.query = q;
    const r = CA.NLU.search(q, { fromNode: currentNode() });
    if (r.kind === 'single') return openPlace(r.items[0].id);
    S.results = r;
    if (r.kind === 'none') { F.earcon('error'); F.haptic('error'); }
    if (r.kind === 'poi') CA.Map.focusNode(r.items[0].id);
    show('results');
  }
  function toggleChip(k) {
    if (S.filter.has(k)) S.filter.delete(k); else S.filter.add(k);
    CA.Map.setPoiFilter(S.filter);
    F.earcon('click');
    renderSheet(false); refocus('chip', k);
    if (S.filter.has(k)) {
      const o = nearestOf(k)[0];
      if (o) { F.announce(`Showing ${CA.POI_TYPES[k].label}. Nearest: ${o.n.name}, ${floorL(o.n.floor)}, ${fmtTime(o.time)}.`); CA.Map.focusNode(o.n.id); }
    }
  }

  /* ---------------- Screen: Results ---------------- */
  function resultsHTML() {
    const r = S.results; if (!r) return homeHTML();
    if (r.kind === 'none') {
      const sug = r.suggestions || [];
      return `${header(`Results for “${esc(r.q)}”`)}
        <p class="error" role="alert">No place matches “${esc(r.q)}”.</p>
        ${sug.length ? `<div class="did-you-mean"><span>Did you mean:</span>${sug.map(n => `<button class="pill" data-act="place" data-id="${n.id}">${esc(title(n))}</button>`).join('')}</div>` : ''}
        <div class="tip"><span aria-hidden="true">💡</span><div>Try a room code (B4302), a lecture theatre (LT-18) or a facility (toilet, café, lift).</div></div>`;
    }
    if (r.kind === 'poi') {
      const from = currentNode();
      const rows = r.items.map((n, i) => {
        const rt = n.id === from ? { time: 0 } : R.route(from, n.id, 'fastest');
        const tag = (i === 0 ? 'Nearest · ' : '') + (rt ? fmtTime(rt.time) : '') + (isOpen(n) === false ? ' · Closed' : '');
        return resultItem(n, tag);
      }).join('');
      return `${header(`Nearest ${esc(CA.POI_TYPES[r.poiType].label)}`)}<ul class="results">${rows}</ul>`;
    }
    return `${header(`Results for “${esc(r.q)}”`)}
      <p class="muted">${r.items.length} places match. Which one do you mean?</p>
      <ul class="results">${r.items.map(n => resultItem(n)).join('')}</ul>`;
  }

  /* ---------------- Screen: Place ---------------- */
  function openPlace(id, { voice = false } = {}) {
    const n = N[id]; if (!n) return;
    S.selected = id; addRecent(id);
    CA.Map.focusNode(id);
    show('place');
    if (voice) F.speak(`${R.placeLabel(n)}, ${floorL(n.floor)}, ${bldName(n)}. Say “take me there”, or tap Directions.`);
  }
  function placeHTML() {
    const n = N[S.selected]; if (!n) return homeHTML();
    const z = n.zone && CA.ZONES[n.zone];
    const type = CA.POI_TYPES[n.poi || n.cat];
    const open = isOpen(n);
    const fav = data.favs.includes(n.id);
    const from = currentNode();
    const fast = from !== n.id ? R.route(from, n.id, 'fastest') : null;
    const sf = from !== n.id ? R.route(from, n.id, 'stepfree') : null;
    const maint = CA.EDGES.some(e => e.maintenance && (e.a === n.id || e.b === n.id));
    const facts = [
      `📍 ${floorL(n.floor)} · ${bldName(n)}`,
      z && `🎨 ${z.name}. Follow the ${z.name.split(' ')[0].toLowerCase()} signs with the letter “${n.zone}”.`,
      open !== null && `${open ? '🟢 Open now' : '🔴 Closed now'} · ${hoursText(n)}`,
      n.serves && `⇅ Serves ${n.serves}`,
      maint && '⚠ Under maintenance. Routes avoid it.',
      n.quiet && '🤫 Quiet zone. Audio switches to vibration and captions.',
      fast && `🚶 ${fmtTime(fast.time)} from you (fastest)`,
      from !== n.id && (sf ? `♿ Step-free route: ${fmtTime(sf.time)}` : '♿ No step-free route available')
    ].filter(Boolean);
    const zb = z ? `<span class="zbadge" style="background:${z.color};color:${z.text}" aria-hidden="true">${n.zone}</span>`
                 : `<span class="zbadge zbadge--plain" aria-hidden="true">${type ? type.icon : '📍'}</span>`;
    return `${header(esc(title(n)))}
      <p class="place-sub">${zb}<span>${esc(n.code ? n.name : (type ? type.label : ''))}</span></p>
      <ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      <div class="btn-row">
        <button class="btn btn-primary btn-lg" data-act="route" data-id="${n.id}" ${from === n.id ? 'disabled' : ''}>➜ ${t('directions')}</button>
        <button class="btn btn-lg" data-act="fav" data-id="${n.id}" aria-pressed="${fav}">${fav ? '★ ' + t('saved') : '☆ ' + t('save')}</button>
      </div>
      <button class="btn btn-block" data-act="showmap" data-id="${n.id}">🗺 Show on map</button>`;
  }
  function toggleFav(id) {
    const on = !data.favs.includes(id);
    data.favs = on ? [...data.favs, id] : data.favs.filter(x => x !== id);
    persist(); F.earcon('confirm'); F.haptic('tick');
    toast(on ? `${title(N[id])} saved.` : `${title(N[id])} removed from Saved.`);
  }

  /* ---------------- Screen: Route planner ---------------- */
  function planRoute(to, mode, { voice = false } = {}) {
    if (S.nav) endNav({ silent: true, toPlan: false });
    const from = currentNode();
    if (from === to) { toast('You are already at this place.'); if (voice) F.speak('You are already here.'); return; }
    S.plan = { from, to, stops: [], mode: mode || S.pendingMode || settings.mode };
    S.pendingMode = null;
    S.selected = to; addRecent(to);
    computePlan();
    show('plan');
    if (voice) {
      F.speak(`${planSummaryText()} ${S.route ? 'Say “go”, or tap Start.' : ''}`);
      S.pending = S.route ? { type: 'go' } : null;
    } else F.announce(planSummaryText());
  }
  function computePlan() {
    const p = S.plan; p.alts = {};
    ['fastest', 'stepfree', 'covered'].forEach(m => { p.alts[m] = R.routeVia([p.from, ...p.stops, p.to], m); });
    S.route = p.alts[p.mode] || null;
    CA.Map.setHighlight(null);
    CA.Map.setRoute(S.route);
    if (S.route) CA.Map.fitRoute();
  }
  function planSummaryText() {
    const r = S.route, p = S.plan;
    if (!r) return `No ${t(p.mode)} route is available.`;
    const v = r.edges.filter(e => e.type !== 'walk').map(e => e.label);
    return `${t(r.mode)} route to ${R.placeLabel(N[r.to])}: about ${fmtTime(r.time)}, ${fmtDist(r.distance)}${v.length ? ', using ' + v.join(' and ') : ''}.`;
  }
  function planHTML() {
    const p = S.plan; if (!p) return homeHTML();
    const r = S.route;
    const end = (ic, label, sub, extra = '') =>
      `<li class="end"><span class="end-ic" aria-hidden="true">${ic}</span><span>${esc(label)}<small>${esc(sub)}</small></span>${extra}</li>`;
    const fromN = N[p.from], toN = N[p.to];
    const ends =
      end('◉', p.from === user.node ? 'My location' : title(fromN), `${floorL(fromN.floor)} · near ${fromN.name}`) +
      p.stops.map((id, i) => end(String(i + 1), title(N[id]), `Stop · ${floorL(N[id].floor)}`,
        `<button class="icon-btn" data-act="rmstop" data-id="${i}" aria-label="Remove stop ${esc(title(N[id]))}">✕</button>`)).join('') +
      end('⚑', title(toN), `${floorL(toN.floor)} · ${bldName(toN)}${toN.zone ? ' · ' + CA.ZONES[toN.zone].name : ''}`);
    const seg = ['fastest', 'stepfree', 'covered'].map(m => {
      const a = p.alts[m];
      return `<button class="seg-btn ${m === p.mode ? 'is-on' : ''}" data-act="mode" data-id="${m}" aria-pressed="${m === p.mode}" ${a ? '' : 'disabled'}>
        <span><span aria-hidden="true">${MODE_IC[m]}</span> ${t(m)}</span><small>${a ? fmtTime(a.time) : 'Not available'}</small></button>`;
    }).join('');
    let body;
    if (!r) {
      body = `<p class="error" role="alert">No ${esc(t(p.mode))} route is available. Try another option.</p>`;
    } else {
      const v = r.edges.filter(e => e.type !== 'walk');
      const floors = v.length ? `${v.length} floor change${v.length > 1 ? 's' : ''} (${v.map(e => e.label).join(', ')})` : 'Same floor';
      body = `
        <p class="route-sum"><strong>${fmtTime(r.time)}</strong> · ${fmtDist(r.distance)} · ${esc(floors)}</p>
        ${r.warnings.length ? `<ul class="warns">${r.warnings.map(w => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : ''}
        <h3 class="sec-h">${t('steps')}</h3>
        ${stepsHTML(r.steps, 'pstep')}`;
    }
    return `${header(`${esc(t('directions'))}<span class="dot">·</span>${esc(title(toN))}`)}
      <ul class="ends" aria-label="Route points">${ends}</ul>
      ${p.stops.length < 2 ? '<button class="link-btn" data-act="addstop">+ Add a stop (café, toilet…)</button>' : ''}
      <div class="seg" role="group" aria-label="Route type">${seg}</div>
      ${body}
      <div class="sticky-cta"><button class="btn btn-primary btn-lg btn-block" data-act="start" ${r ? '' : 'disabled'}>▶ ${t('start')}</button></div>`;
  }
  function openAddStop() {
    if (S.plan.stops.length >= 2) return toast('You can add up to 2 stops in this prototype.');
    const opts = ['cafe', 'wc', 'canteen', 'library'].map(tp => {
      const o = nearestOf(tp, S.plan.from).find(x => x.n.id !== S.plan.to && !S.plan.stops.includes(x.n.id));
      return o && `<button class="preset" data-dlg="stop" data-id="${o.n.id}"><span aria-hidden="true">${CA.POI_TYPES[tp].icon}</span>${esc(o.n.name)}<small>${floorL(o.n.floor)} · ${fmtTime(o.time)}</small></button>`;
    }).filter(Boolean).join('');
    openDialog(`<h2>Add a stop</h2><p class="muted">These are the nearest to your start point.</p>
      <div class="preset-grid">${opts}</div><button class="btn btn-block" data-dlg="close">Cancel</button>`,
      (act, b) => {
        if (act !== 'stop') return;
        S.plan.stops.push(b.dataset.id); closeDialog();
        computePlan(); renderSheet(false); F.earcon('confirm');
        F.announce(`Stop added. ${planSummaryText()}`);
      });
  }

  /* ---------------- Navigation (simulated positioning) ---------------- */
  function startNav({ reroute = false } = {}) {
    const r = S.route; if (!r) return;
    clearInterval(S.timer);
    const prev = S.nav;
    const cum = [0]; r.edges.forEach((e, i) => cum.push(cum[i] + e.len));
    S.nav = {
      r, cum, d: 0, k: 0, wait: 0, fired: new Set([0]), pre: new Set(), paused: false, off: false,
      speedX: prev ? prev.speedX : 2, startT: prev && reroute ? prev.startT : Date.now()
    };
    if (!reroute) S.navOrigin = r.from;
    S.pending = null; S.follow = true;
    S.pin = null; CA.Map.setPin(null); CA.Map.setHighlight(null);
    $('#app').classList.add('is-nav');
    $('#navCard').hidden = false;
    CA.Map.setNavigating(true);
    CA.Map.setRoute(r);
    const s0 = N[r.from];
    user.node = r.from;
    CA.Map.setFloor(s0.floor, { silent: true });
    placeUser(s0.x, s0.y, s0.floor, null);
    S.history = ['plan']; S.screen = 'nav';
    setSheet('peek'); renderSheet(false);
    const card = $('#navCard'); card.setAttribute('tabindex', '-1'); card.focus();
    const first = r.steps[1];
    if (reroute) F.cue('confirm', `New route. ${first ? first.text : ''}`);
    else F.cue('straight', `Starting ${t(r.mode)} route to ${R.placeLabel(N[r.to])}. About ${fmtTime(r.time)}. ${r.steps[0].text}.`);
    checkQuiet(s0);
    S.timer = setInterval(tick, 250);
  }

  function tick() {
    const nv = S.nav; if (!nv || nv.paused || nv.off) return;
    const r = nv.r, dt = 0.25 * nv.speedX;
    if (nv.k >= r.path.length - 1) return arrive();
    const e = r.edges[nv.k];

    if (e.type !== 'walk') {                         // in lift / on escalator / stairs
      nv.wait += dt;
      const need = Math.min(R.seconds(e, r.mode), 6); // compressed for the demo
      if (nv.wait >= need) {
        nv.wait = 0; nv.k++;
        const n = N[r.path[nv.k]];
        user.node = n.id;
        placeUser(n.x, n.y, n.floor, user.heading);
        const nx = r.steps.find((s, j) => j > 0 && !nv.fired.has(j));
        F.cue('confirm', `You are now on ${floorL(n.floor)}. ${nx ? nx.text + '.' : ''}`);
        onReachNode(nv.k);
        if (!S.nav) return;
      }
      updateNavUI(); return;
    }

    nv.d += R.speed(r.mode) * dt;
    while (nv.k < r.edges.length && r.edges[nv.k].type === 'walk' && nv.d >= nv.cum[nv.k + 1]) {
      nv.k++;
      onReachNode(nv.k);
      if (!S.nav || S.nav !== nv || nv.paused) break;
    }
    if (!S.nav || S.nav !== nv) return;

    const ce = r.edges[nv.k];
    if (ce && ce.type === 'walk') {
      const a = N[r.path[nv.k]], b = N[r.path[nv.k + 1]];
      const f = clamp((nv.d - nv.cum[nv.k]) / (ce.len || 1), 0, 1);
      placeUser(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.floor, Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
    } else {
      const n = N[r.path[nv.k]];
      placeUser(n.x, n.y, n.floor, user.heading);
    }
    preAnnounce();
    updateNavUI();
  }

  function onReachNode(k) {
    const nv = S.nav, r = nv.r, n = N[r.path[k]];
    user.node = n.id;
    checkQuiet(n);
    r.steps.forEach((s, i) => {
      if (i > 0 && s.at === k && !nv.fired.has(i)) { nv.fired.add(i); fireStep(s); }
    });
  }

  function fireStep(s) {
    const nv = S.nav;
    switch (s.type) {
      case 'left': case 'right':
        F.cue(s.type, `${s.text}.`); break;
      case 'lift': case 'escalator': case 'stairs':
        F.cue(s.type, `${s.text}.`); break;
      case 'stop':
        F.cue('stop', `${s.text}. Tap Continue when you are ready.`);
        nv.paused = true; updatePauseBtn();
        toast(`Stopped at ${s.landmark}.`, { label: 'Continue', fn: resumeNav });
        break;
      case 'arrive':
        arrive(); break;
      default:
        F.cue('straight', s.text);
    }
  }

  function preAnnounce() {
    const nv = S.nav, cur = navCurrent();
    if (!cur.s || cur.vertical || nv.pre.has(cur.i)) return;
    const d = nv.cum[cur.s.at] - nv.d;
    if (d <= 15 && d > 4) {
      nv.pre.add(cur.i);
      F.speak(`In ${fmtDist(d)}, ${lc(cur.s.text)}.`, { priority: 'normal' });
      F.haptic('tick');
    }
  }

  function navCurrent() {
    const nv = S.nav, r = nv.r, e = r.edges[nv.k];
    if (e && e.type !== 'walk') {
      const i = r.steps.findIndex(s => s.at === nv.k && s.type === e.type);
      if (i >= 0) return { i, s: r.steps[i], vertical: true };
    }
    const i = r.steps.findIndex((s, j) => j > 0 && !nv.fired.has(j));
    return { i, s: r.steps[i], vertical: false };
  }

  function remaining(nv) {
    const r = nv.r; let s = 0, m = 0;
    for (let i = nv.k; i < r.edges.length; i++) {
      const e = r.edges[i];
      if (e.type === 'walk') {
        const len = i === nv.k ? Math.max(0, nv.cum[i + 1] - nv.d) : e.len;
        s += len / R.speed(r.mode); m += len;
      } else s += Math.max(0, R.seconds(e, r.mode) - (i === nv.k ? nv.wait : 0));
    }
    return { s, m };
  }

  function updateNavUI() {
    const nv = S.nav; if (!nv) return;
    const r = nv.r, cur = navCurrent(); if (!cur.s) return;
    const s = cur.s;
    $('#navArrow').textContent = ICON[s.type] || '⬆';
    let dist;
    if (cur.vertical) dist = s.type === 'lift' ? 'In the lift…' : 'Changing floor…';
    else {
      const d = Math.max(0, nv.cum[s.at] - nv.d);
      dist = d < 4 ? 'Now' : `In ${fmtDist(d)}`;
    }
    $('#navDist').textContent = dist;
    $('#navText').textContent = s.text;
    const nx = r.steps[cur.i + 1];
    $('#navNext').textContent = nx ? `Then: ${nx.text}` : '';

    const rem = remaining(nv);
    const eta = $('#navEta'), rm = $('#navRemain');
    if (eta) eta.textContent = fmtTime(rem.s);
    if (rm) rm.textContent = `${fmtDist(rem.m)} left`;
    const total = Math.max(1, r.distance);
    $('#navCard').style.setProperty('--prog', `${clamp(100 * (1 - rem.m / total), 0, 100).toFixed(1)}%`);
    r.steps.forEach((_, i) => {
      const li = document.getElementById(`nstep-${i}`); if (!li) return;
      li.classList.toggle('is-cur', i === cur.i);
      li.classList.toggle('is-done', nv.fired.has(i) && i !== cur.i);
      if (i === cur.i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (S.ar) updateAR(s);
  }

  function navHTML() {
    const nv = S.nav; if (!nv) return homeHTML();
    const r = nv.r;
    return `
      <h2 class="sr-only" tabindex="-1">Navigation to ${esc(title(N[r.to]))}</h2>
      <div class="nav-sum">
        <span><strong id="navEta">–</strong> · <span id="navRemain">–</span></span>
        <span class="nav-badges"><span class="badge">${MODE_IC[r.mode]} ${esc(t(r.mode))}</span>${r.stops.length ? `<span class="badge">${r.stops.length} stop${r.stops.length > 1 ? 's' : ''}</span>` : ''}</span>
      </div>
      <div class="nav-actions">
        <button class="btn" data-act="repeat">🔊 Repeat</button>
        <button class="btn btn-emg" data-act="end">✕ ${t('end')}</button>
        <button class="mic" data-act="mic" aria-label="Voice command">🎤</button>
      </div>
      <div class="nav-toggles">
        <button class="toggle" data-act="tgl" data-id="voice" aria-pressed="${!F.state.muted}">🔈 Voice</button>
        <button class="toggle" data-act="tgl" data-id="haptics" aria-pressed="${F.state.hapticsOn}">📳 Vibration</button>
        <button class="toggle" data-act="tgl" data-id="ar" aria-pressed="${S.ar}">📷 AR view</button>
      </div>
      <h3 class="sec-h">${t('steps')}</h3>
      ${stepsHTML(r.steps, 'nstep')}
      <details class="demo"><summary>🧪 Demo controls (simulation)</summary>
        <div class="btn-row">
          <button class="btn" data-act="demo" data-id="pause">${nv.paused ? '▶ Resume' : '⏸ Pause'}</button>
          <button class="btn" data-act="demo" data-id="off">↯ Wrong turn</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-act="demo" data-id="noisy" aria-pressed="${F.state.noisy}">📢 Noisy place</button>
          <button class="btn" data-act="demo" data-id="quiet" aria-pressed="${F.state.quietZone}">🤫 Quiet zone</button>
        </div>
        <div class="field"><label for="simSpeed">Walking speed (simulation)</label>
          <select id="simSpeed">${[1, 2, 4, 8].map(x => `<option value="${x}" ${x === nv.speedX ? 'selected' : ''}>${x}×</option>`).join('')}</select>
        </div>
      </details>`;
  }

  function updatePauseBtn() {
    const b = contentEl.querySelector('[data-act="demo"][data-id="pause"]');
    if (b && S.nav) b.textContent = S.nav.paused ? '▶ Resume' : '⏸ Pause';
  }
  function pauseNav() { if (!S.nav) return; S.nav.paused = true; updatePauseBtn(); F.announce('Navigation paused.'); }
  function resumeNav() { if (!S.nav) return; S.nav.paused = false; updatePauseBtn(); F.cue('confirm', 'Continuing.'); }

  function repeat() {
    if (S.nav) {
      const cur = navCurrent(); if (!cur.s) return;
      const txt = `${$('#navDist').textContent}. ${cur.s.text}.`;
      F.speak(txt, { priority: 'high' }); F.caption(txt);
    } else {
      const l = F.lastSpoken();
      if (l) { F.speak(l, { priority: 'high' }); F.caption(l); } else toast('Nothing to repeat yet.');
    }
  }

  function endNav({ arrived = false, silent = false, toPlan = true } = {}) {
    clearInterval(S.timer); S.timer = null;
    if (S.ar) setAR(false);
    S.nav = null;
    $('#app').classList.remove('is-nav');
    $('#navCard').hidden = true;
    $('#offBanner').hidden = true;
    CA.Map.setNavigating(false);
    CA.Map.setProgress(null);
    if (S.autoQuiet) { F.state.quietZone = false; S.autoQuiet = false; }
    if (arrived) return;
    if (!silent) F.speak('Navigation ended.', { priority: 'high' });
    if (toPlan && S.plan) {
      S.plan.from = currentNode(); S.plan.stops = [];
      if (S.plan.from === S.plan.to) { S.screen = 'home'; CA.Map.setRoute(null); }
      else { computePlan(); S.screen = 'plan'; }
      S.history = ['home'];
      setSheet('half'); renderSheet(true);
    }
  }

  function arrive() {
    const nv = S.nav; if (!nv) return;
    const r = nv.r;
    const secs = Math.round((Date.now() - nv.startT) / 1000);
    S.arrived = { to: r.to, from: S.navOrigin, secs };
    F.cue('arrive', `You have arrived at ${R.placeLabel(N[r.to])}.`);
    endNav({ arrived: true });
    user.node = r.to;
    const d = N[r.to]; placeUser(d.x, d.y, d.floor, null);
    S.route = null; S.plan = null;
    CA.Map.setRoute(null); CA.Map.setHighlight(r.to);
    addRecent(r.to);
    S.history = []; S.screen = 'arrived';
    setSheet('half'); renderSheet(true);
  }
  function arrivedHTML() {
    const a = S.arrived; if (!a) return homeHTML();
    const n = N[a.to], z = n.zone && CA.ZONES[n.zone];
    const fav = data.favs.includes(n.id);
    return `
      <h2 class="sr-only" tabindex="-1">Arrived</h2>
      <div class="arrive-card" role="status"><span class="big" aria-hidden="true">⚑</span>
        <div><div>You have arrived</div><strong>${esc(title(n))}</strong><div>${floorL(n.floor)} · ${esc(bldName(n))}${z ? ' · ' + esc(z.name) : ''}</div></div>
      </div>
      <p class="muted">Simulated trip time: ${Math.max(1, Math.round(a.secs))} s (demo speed).</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-act="done">✓ Done</button>
        <button class="btn" data-act="fav" data-id="${n.id}" aria-pressed="${fav}">${fav ? '★ ' + t('saved') : '☆ ' + t('save')}</button>
        ${a.from && a.from !== a.to ? `<button class="btn" data-act="route" data-id="${a.from}">↩ Route back</button>` : ''}
      </div>`;
  }

  /* ---------------- Off-route recovery ---------------- */
  function simulateOffRoute() {
    const nv = S.nav; if (!nv || nv.off) return;
    const r = nv.r, e = r.edges[nv.k];
    if (!e || e.type !== 'walk') return toast('Try this while walking, not while changing floor.');
    const a = N[r.path[nv.k]], b = N[r.path[nv.k + 1]];
    const side = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    nv.off = true;
    const x = user.x + Math.cos(side) * 45, y = user.y + Math.sin(side) * 45;
    user.acc = 5;
    placeUser(x, y, user.floor, side * 180 / Math.PI);
    const ban = $('#offBanner');
    ban.innerHTML = `<div class="off-row"><span class="spinner" aria-hidden="true"></span><div><strong>Off route</strong><br>Finding a new route from here…</div></div>`;
    ban.hidden = false;
    F.cue('offroute', 'You seem to be off route. Finding a new route.');
    setTimeout(() => {
      if (S.nav !== nv) return;
      const near = R.nearestNode(user.floor, x, y);
      const remStops = (r.stops || []).filter(s => s.idx > nv.k).map(s => s.id);
      const nr = R.routeVia([near, ...remStops, r.to], r.mode);
      if (!nr) {
        ban.innerHTML = `<div class="off-row"><span aria-hidden="true">⚠</span><div><strong>No route found from here.</strong><br>End navigation or use Emergency Assist.</div></div>`;
        F.cue('error', 'No route found from here.');
        return;
      }
      user.acc = 3;
      ban.innerHTML = `<div class="off-row"><span aria-hidden="true">✓</span><div><strong>New route · ${fmtTime(nr.time)}</strong><br>Head back to ${esc(N[near].name)}.</div></div>`;
      setTimeout(() => { ban.hidden = true; }, 3500);
      S.route = nr;
      if (S.plan) { S.plan.from = near; S.plan.stops = remStops; }
      startNav({ reroute: true });
    }, 2200);
  }

  /* ---------------- Context adaptation ---------------- */
  function setQuietZone(on, auto) {
    if (F.state.quietZone === on) return;
    F.state.quietZone = on; S.autoQuiet = on && auto;
    F.haptic('tick');
    toast(on ? '🤫 Quiet zone: spoken guidance switched to vibration and captions.' : '🔈 Left the quiet zone: spoken guidance is back on.');
    const b = contentEl.querySelector('[data-act="demo"][data-id="quiet"]'); if (b) b.setAttribute('aria-pressed', on);
  }
  function checkQuiet(n) {
    if (!settings.autoQuiet) return;
    if (n.quiet && !F.state.quietZone) setQuietZone(true, true);
    else if (!n.quiet && S.autoQuiet) setQuietZone(false, true);
  }

  /* ---------------- AR view ---------------- */
  let arStream = null;
  async function setAR(on) {
    S.ar = on;
    const layer = $('#arLayer'), v = $('#arVideo');
    layer.hidden = !on;
    const b = contentEl.querySelector('[data-act="tgl"][data-id="ar"]'); if (b) b.setAttribute('aria-pressed', on);
    if (!on) {
      if (arStream) { arStream.getTracks().forEach(tr => tr.stop()); arStream = null; }
      v.srcObject = null; return;
    }
    layer.classList.add('ar--fallback');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        arStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!S.ar) { arStream.getTracks().forEach(tr => tr.stop()); arStream = null; return; }
        v.srcObject = arStream; await v.play();
        layer.classList.remove('ar--fallback');
      } catch (e) { toast('Camera not available. Showing the AR arrow on a placeholder view.'); }
    } else toast('Camera not supported. Showing the AR arrow on a placeholder view.');
    updateNavUI();
  }
  function updateAR(s) {
    const a = $('#arArrow');
    const vertical = ['lift', 'escalator', 'stairs'].includes(s.type);
    a.textContent = s.type === 'arrive' ? '⚑' : vertical ? '⇅' : '⬆';
    a.style.transform = s.type === 'left' ? 'rotate(-90deg)' : s.type === 'right' ? 'rotate(90deg)' : 'none';
    $('#arLabel').textContent = `${$('#navDist').textContent} · ${s.text}`;
  }

  /* ---------------- Dropped pin ---------------- */
  function onLongPress(floor, x, y) {
    if (S.nav) return;
    S.pin = { floor, x, y };
    S.pinNode = R.nearestNode(floor, x, y);
    if (!S.pinNode) { toast('No mapped places on this floor yet.'); S.pin = null; return; }
    CA.Map.setPin(S.pin);
    F.haptic('tick'); F.earcon('confirm');
    show('pin');
  }
  function pinHTML() {
    if (!S.pin) return homeHTML();
    const n = N[S.pinNode];
    return `${header('📌 Dropped pin')}
      <p class="place-sub">${floorL(S.pin.floor)} · near ${esc(n.name)}</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-lg" data-act="route" data-id="${n.id}">➜ Directions here</button>
        <button class="btn btn-lg" data-act="pinme">◉ I am here</button>
      </div>
      <button class="btn btn-block" data-act="pinrm">✕ Remove pin</button>
      <p class="muted">Tip: say “take me there” to route to this pin. “I am here” sets your position, because the prototype has no indoor positioning.</p>`;
  }

  /* ---------------- Voice ---------------- */
  let micPressT = 0, micHeld = false, listening = false;
  function micDown(e) { e.preventDefault(); micPressT = Date.now(); micHeld = true; startListening(); }
  function micUp() {
    if (!micHeld) return; micHeld = false;
    if (Date.now() - micPressT > 450 && CA.Voice.isActive()) CA.Voice.stop(); // hold-to-talk release
  }
  function startListening() {
    if (!CA.Voice.supported()) return openTypeDialog();
    if (listening) { CA.Voice.stop(); return; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    F.earcon('listen'); F.haptic('listen');
    listening = true;
    const ov = $('#listen');
    $('#listenTitle').textContent = 'Listening…';
    $('#listenText').textContent = 'Try “Take me to B4302 step-free”';
    ov.hidden = false;
    contentEl.querySelectorAll('.mic').forEach(m => m.classList.add('is-listening'));
    let finalText = null, conf = 1;
    CA.Voice.start({
      lang: settings.lang === 'zh' ? 'zh-HK' : 'en-GB',
      onInterim: tx => { $('#listenText').textContent = tx; },
      onFinal: (tx, c) => { finalText = tx; conf = c; $('#listenText').textContent = tx; },
      onError: err => {
        if (err === 'not-allowed' || err === 'service-not-allowed') { toast('Microphone blocked. You can type instead.'); setTimeout(openTypeDialog, 300); }
        else if (err === 'no-speech') toast('I didn’t hear anything. Try again, or type.');
        else if (err === 'network') { toast('Speech service unavailable. You can type instead.'); setTimeout(openTypeDialog, 300); }
        else if (err !== 'aborted') toast('Voice input problem. You can type instead.');
      },
      onEnd: () => {
        listening = false;
        F.earcon('listenEnd');
        contentEl.querySelectorAll('.mic').forEach(m => m.classList.remove('is-listening'));
        if (finalText) { $('#listenTitle').textContent = 'Heard:'; setTimeout(() => { ov.hidden = true; }, 900); handleUtterance(finalText, conf); }
        else ov.hidden = true;
      }
    });
  }
  function openTypeDialog() {
    openDialog(`<h2>Type a command</h2>
      <p class="muted">Voice input isn’t available here. Type what you would say.</p>
      <input id="typeIn" class="text-in" type="text" placeholder="e.g. take me to B4302 step-free" aria-label="Command">
      <div class="pills" style="margin:10px 0">${EXAMPLES.map(x => `<button class="pill" data-dlg="ex" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="btn-row"><button class="btn" data-dlg="close">Cancel</button><button class="btn btn-primary" data-dlg="send">Send</button></div>`,
      (act, b) => {
        if (act === 'ex') { $('#typeIn').value = b.dataset.v; $('#typeIn').focus(); }
        if (act === 'send') send();
      });
    const send = () => { const v = $('#typeIn').value.trim(); closeDialog(); if (v) handleUtterance(v, 1); };
    $('#typeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }
  function confirmHeard(text) {
    F.speak(`Did you say: ${text}?`);
    openDialog(`<h2>Did you say…</h2><p class="heard">“${esc(text)}”</p>
      <div class="btn-row"><button class="btn btn-primary" data-dlg="yes">Yes</button><button class="btn" data-dlg="again">Try again</button><button class="btn" data-dlg="type">Type</button></div>`,
      act => {
        closeDialog();
        if (act === 'yes') handleUtterance(text, 1);
        if (act === 'again') startListening();
        if (act === 'type') openTypeDialog();
      });
  }

  /* Intent handling – voice fused with touch context (selected place / pin) */
  function handleUtterance(text, conf = 1) {
    if (conf > 0 && conf < 0.45) return confirmHeard(text);
    F.announce(`Heard: ${text}`);
    const it = CA.NLU.parse(text);
    switch (it.intent) {
      case 'help': return openEmergency();
      case 'stop':
        if (S.nav) return endNav();
        S.pending = null; return F.speak('OK.');
      case 'repeat': return repeat();
      case 'where_am_i': return whereAmI();
      case 'navigate_here': {
        const target = S.pin ? S.pinNode : S.selected;
        if (!target) return F.cue('error', 'Tap a place on the map first, then say “take me there”.');
        return planRoute(target, S.pendingMode, { voice: true });
      }
      case 'navigate':
        if (!it.query) return F.speak('Where would you like to go?');
        return resolve(it.query, id => planRoute(id, it.mode, { voice: true }), false);
      case 'set_mode':
        if (S.plan && !S.nav) {
          S.plan.mode = it.mode; computePlan(); renderSheet(false);
          S.pending = S.route ? { type: 'go' } : null;
          return F.speak(`${planSummaryText()} ${S.route ? 'Say “go” to start.' : ''}`);
        }
        S.pendingMode = it.mode;
        return F.speak(`${t(it.mode)} route selected. Where would you like to go?`);
      case 'confirm':
        if (S.pending && S.pending.type === 'choose' && S.pending.items.length === 1) { const p = S.pending; S.pending = null; return p.then(p.items[0].id); }
        if ((S.pending && S.pending.type === 'go') || (S.screen === 'plan' && S.route)) return startNav();
        return F.speak('There is nothing to confirm right now.');
      case 'deny':
        S.pending = null; return F.speak('OK, cancelled.');
      case 'choose': return choose(it.choice);
      case 'find':
      default:
        if (!it.query) return F.speak('What place are you looking for?');
        return resolve(it.query, id => openPlace(id, { voice: true }), true);
    }
  }

  function resolve(query, then, isFind) {
    if (S.nav && !isFind) endNav({ silent: true, toPlan: false });
    const r = CA.NLU.search(query, { fromNode: currentNode() });
    S.query = query;
    if (r.kind === 'single') return then(r.items[0].id);
    if (r.kind === 'poi') {
      const n = r.items[0], label = CA.POI_TYPES[r.poiType].label;
      if (!isFind) return then(n.id);
      S.results = r; show('results'); CA.Map.focusNode(n.id);
      S.pending = { type: 'choose', items: r.items, then };
      const rt = R.route(currentNode(), n.id, 'fastest');
      return F.speak(`The nearest ${label.toLowerCase()} is ${n.name}, ${floorL(n.floor)}${rt ? ', ' + fmtTime(rt.time) + ' away' : ''}. Say “take me there”, or choose from the list.`);
    }
    if (r.kind === 'multi') {
      S.results = r; show('results');
      S.pending = { type: 'choose', items: r.items, then };
      const names = r.items.map(n => (n.zone ? CA.ZONES[n.zone].name.split(' ')[0] : title(n)));
      return F.speak(`I found ${r.items.length} places: ${names.join(', ')}. Which one?`);
    }
    S.results = r; show('results');
    const sug = r.suggestions || [];
    S.pending = sug.length ? { type: 'choose', items: sug, then } : null;
    F.cue('error', `Sorry, I couldn’t find ${query}.${sug.length ? ` Did you mean ${title(sug[0])}?` : ' Try a room code like B4302.'}`);
  }

  function choose(c) {
    const p = S.pending;
    if (!p || p.type !== 'choose') return F.speak('There is nothing to choose right now.');
    const zl = { purple: 'P', green: 'G', blue: 'B', yellow: 'Y', red: 'R' }[c];
    const ord = { first: 0, second: 1, third: 2, fourth: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[c];
    const n = zl ? p.items.find(x => x.zone === zl) : p.items[ord];
    if (!n) return F.cue('error', 'Sorry, which one? Say a colour, or first, second, and so on.');
    S.pending = null;
    p.then(n.id);
  }
  function onPickPlace(id) {
    if (S.pending && S.pending.type === 'choose' && S.pending.items.some(n => n.id === id)) {
      const p = S.pending; S.pending = null; return p.then(id);
    }
    openPlace(id);
  }
  function whereAmI() {
    const near = N[R.nearestNode(user.floor, user.x, user.y)];
    const txt = `You are on ${floorL(user.floor)}${near && near.bld ? ', ' + bldName(near) : ''}, near ${near ? near.name : 'an unknown place'}. Accuracy about ${user.acc} metres.`;
    F.speak(txt, { priority: 'high' }); toast(txt);
  }

  /* ---------------- Emergency Assist ---------------- */
  function locText() {
    const near = N[R.nearestNode(user.floor, user.x, user.y)];
    return `${floorL(user.floor)}, ${near ? bldName(near) + ', near ' + near.name : 'CityU campus'} (±${user.acc} m)`;
  }
  function openEmergency() {
    F.cue('emergency', 'Emergency Assist opened. Your location is ready to share.', { force: true });
    const loc = locText();
    const mode = settings.mode === 'stepfree' ? 'stepfree' : 'fastest';
    const aid = nearestOf('firstaid', currentNode(), mode)[0];
    const sec = nearestOf('security', currentNode(), mode)[0];
    const tel = CA.CONFIG.securityPhone;
    openDialog(`<h2>🆘 Emergency Assist</h2>
      <p class="loc-line"><strong>Your location:</strong> ${esc(loc)}</p>
      <div class="emg-grid">
        <a class="btn btn-emg btn-lg" data-dlg="call" href="${tel ? 'tel:' + esc(tel) : '#'}">📞 Call Campus Security</a>
        <button class="btn btn-lg" data-dlg="share">📤 Share my location</button>
        ${aid ? `<button class="btn btn-lg" data-dlg="aid">➕ Route to first aid · ${fmtTime(aid.time)}</button>` : ''}
        ${sec ? `<button class="btn btn-lg" data-dlg="sec">🛡 Route to Security office · ${fmtTime(sec.time)}</button>` : ''}
        <button class="btn" data-dlg="close">Cancel</button>
      </div>`,
      async (act, b, e) => {
        if (act === 'call' && !tel) {
          e.preventDefault();
          toast('Prototype: add the official Campus Security number in CA.CONFIG.securityPhone.');
        }
        if (act === 'share') {
          const msg = `I need help. My location: ${loc}. (sent from CampusAssist)`;
          try {
            if (navigator.share) await navigator.share({ title: 'My location', text: msg });
            else { await navigator.clipboard.writeText(msg); toast('Location copied. Paste it into a message.'); }
          } catch (err) { toast('Sharing cancelled.'); }
        }
        if (act === 'aid' || act === 'sec') {
          const target = act === 'aid' ? aid.n.id : sec.n.id;
          closeDialog();
          switchTab('map');
          planRoute(target, mode);
          if (S.route) startNav();
        }
      });
  }
  function bindEmergency() {
    const b = $('#emgBtn'); let tm = null;
    const startHold = () => {
      if (tm) return;
      b.classList.add('holding'); F.haptic('tick');
      tm = setTimeout(() => { tm = null; b.classList.remove('holding'); openEmergency(); }, 1500);
    };
    const cancel = () => {
      if (!tm) return;
      clearTimeout(tm); tm = null; b.classList.remove('holding');
      toast(t('holdHint'));
    };
    b.addEventListener('pointerdown', e => { e.preventDefault(); startHold(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, cancel));
    b.addEventListener('contextmenu', e => e.preventDefault());
    // Keyboard / screen-reader activation (detail === 0): open directly – the dialog itself is harmless.
    b.addEventListener('click', e => { if (e.detail === 0) openEmergency(); });
  }

  /* ---------------- Onboarding & guide ---------------- */
  function openOnboarding() {
    openDialog(`<h2>Welcome to CampusAssist</h2>
      <p>Choose a starting profile. You can change everything later in <strong>Profile</strong>.</p>
      <div class="preset-grid">${PRESETS.map(p => `<button class="preset" data-dlg="preset" data-id="${p.id}"><span aria-hidden="true">${p.icon}</span>${esc(p.label)}<small>${esc(p.desc)}</small></button>`).join('')}</div>
      <button class="btn btn-block" data-dlg="guide">👆 Show gesture guide</button>`,
      (act, b) => {
        if (act === 'preset') {
          applyPreset(b.dataset.id, true); closeDialog();
          const p = PRESETS.find(x => x.id === b.dataset.id);
          F.speak(`Welcome. ${p.label} profile is on. Search, or tap the microphone to speak.`);
          toast(`${p.label} profile applied.`);
          renderSheet(false);
        }
        if (act === 'guide') openGuide();
      },
      () => { if (!settings.profile) applyPreset('standard', true); });
  }
  function openGuide() {
    const G = [
      ['🤏', 'Pinch', 'Zoom the map in or out. You can also use the plus and minus buttons.'],
      ['🔄', 'Two-finger twist', 'Rotate the map. Tap the compass to reset to north.'],
      ['✌️', 'Two-finger swipe', 'Swipe up or down with two fingers to change floor. You can also use the floor buttons.'],
      ['👇', 'Long-press map', 'Drop a pin. Then route there, or set it as your location.'],
      ['🎤', 'Tap or hold mic', 'Speak a command, for example: take me to B4302 step-free.'],
      ['🆘', 'Hold SOS 1.5 s', 'Open Emergency Assist.']
    ];
    openDialog(`<h2>Gesture guide</h2>
      <div class="tut-grid">${G.map(([i, h, d]) => `<button data-dlg="say" data-v="${esc(h + '. ' + d)}"><span aria-hidden="true">${i}</span>${esc(h)}<small>${esc(d)}</small></button>`).join('')}</div>
      <p class="muted">Keyboard: arrows pan, + / − zoom, [ ] rotate, N resets north, Page Up / Page Down change floor.</p>
      <button class="btn btn-primary btn-block" data-dlg="close">Got it</button>`,
      (act, b) => { if (act === 'say') F.speak(b.dataset.v, { priority: 'high' }); });
  }

  /* ---------------- Saved view ---------------- */
  function renderSaved() {
    const v = $('#savedView');
    const favs = data.favs.filter(id => N[id]);
    v.innerHTML = `<h2 class="page-h" tabindex="-1">${t('savedTitle')}</h2>
      <h3 class="sec-h">${t('favourites')}</h3>
      ${favs.length ? `<ul class="list">${favs.map(id => `
        <li style="display:flex;gap:8px;align-items:center">${resultBtn(N[id], '', 'data-sact')}
          <button class="icon-btn" data-sact="rmfav" data-id="${id}" aria-label="Remove ${esc(title(N[id]))} from Saved">✕</button></li>`).join('')}</ul>`
        : '<p class="muted">No favourites yet. Open a place and tap ☆ Save.</p>'}
      <h3 class="sec-h">${t('timetable')}</h3>
      <ul class="list">${CA.TIMETABLE.filter(c => N[c.node]).map(c => `
        <li class="tip"><span aria-hidden="true">📅</span>
          <div><strong>${esc(c.course)}</strong><br><span class="muted">${esc(c.dayName)} ${esc(c.time)} · ${esc(title(N[c.node]))}</span></div>
          <button class="btn btn-primary" data-sact="route" data-id="${c.node}">${t('go')}</button></li>`).join('')}</ul>`;
  }
  function onSavedClick(e) {
    const b = e.target.closest('[data-sact]'); if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.sact === 'place') { switchTab('map'); openPlace(id); }
    if (b.dataset.sact === 'route') { switchTab('map'); planRoute(id); }
    if (b.dataset.sact === 'rmfav') {
      data.favs = data.favs.filter(x => x !== id); persist(); renderSaved();
      toast(`${title(N[id])} removed.`, { label: 'Undo', fn: () => { data.favs.push(id); persist(); renderSaved(); } });
    }
  }

  /* ---------------- Profile view ---------------- */
  function renderProfile() {
    const v = $('#profileView');
    const chk = (k, label) => `<label class="field"><span>${label}</span><input type="checkbox" data-set="${k}" ${settings[k] ? 'checked' : ''}></label>`;
    const sel = (k, label, opts) => `<div class="field"><label for="s-${k}">${label}</label><select id="s-${k}" data-set="${k}">${opts.map(([val, l]) => `<option value="${val}" ${String(settings[k]) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    const rng = (k, label, min, max, step, fmt) => `<div class="field"><label for="s-${k}">${label}</label><input id="s-${k}" type="range" min="${min}" max="${max}" step="${step}" value="${settings[k]}" data-set="${k}"><output for="s-${k}">${fmt(settings[k])}</output></div>`;
    v.innerHTML = `<h2 class="page-h" tabindex="-1">${t('profileTitle')}</h2>
      <fieldset><legend>Quick profile</legend><div class="pills">${PRESETS.map(p =>
        `<button class="pill" data-preset="${p.id}" aria-pressed="${settings.profile === p.id}"><span aria-hidden="true">${p.icon}</span>${esc(p.label)}</button>`).join('')}</div></fieldset>
      <fieldset><legend>Display</legend>
        ${rng('textSize', 'Text size', 100, 150, 5, x => x + '%')}
        ${chk('hc', 'High contrast')}
        ${chk('dark', 'Dark theme')}
        ${chk('lowvision', 'Extra-large instructions')}
      </fieldset>
      <fieldset><legend>Sound and speech</legend>
        ${chk('voice', 'Spoken guidance and sounds')}
        ${rng('rate', 'Speech rate', 0.7, 1.5, 0.1, x => Number(x).toFixed(1) + '×')}
        ${chk('hearing', 'Captions for all speech')}
        ${chk('quiet', 'Always quiet (vibration + captions)')}
        ${chk('autoQuiet', 'Go quiet automatically in library')}
      </fieldset>
      <fieldset><legend>Vibration</legend>
        ${chk('haptics', 'Vibration cues')}
        ${sel('haptic', 'Strength', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']])}
      </fieldset>
      <fieldset><legend>Routing</legend>
        ${sel('mode', 'Default route', [['fastest', 'Fastest'], ['stepfree', 'Step-Free'], ['covered', 'Covered']])}
      </fieldset>
      <fieldset><legend>Language / 語言</legend>
        ${sel('lang', 'Interface language', [['en', 'English'], ['zh', '繁體中文']])}
        <p class="muted">In this prototype, spoken guidance is in English only.</p>
      </fieldset>
      <div class="btn-row">
        <button class="btn" data-pact="guide">👆 Gesture guide</button>
        <button class="btn" data-pact="test">🔔 Test cues</button>
        <button class="btn" data-pact="reset">↺ Reset app</button>
      </div>
      <p class="muted">Prototype: the map is schematic and positioning is simulated. Vibration needs Chrome on Android; voice input needs Chrome or Edge.</p>`;
  }
  function onSettingChange(e) {
    const el = e.target, k = el.dataset.set; if (!k) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    settings[k] = v;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = k === 'textSize' ? v + '%' : Number(v).toFixed(1) + '×';
    if (e.type === 'input' && el.type === 'range' && k !== 'textSize') return;
    applySettings(); persist();
    if (e.type === 'change') {
      if (k === 'haptic') F.haptic('right');
      if (k === 'rate') F.speak('This is the new speaking rate.', { priority: 'high' });
      if (k === 'lang') { renderProfile(); renderSheet(false); }
    }
  }
  function onProfileClick(e) {
    const p = e.target.closest('[data-preset]');
    if (p) { applyPreset(p.dataset.preset); renderProfile(); renderSheet(false); return; }
    const a = e.target.closest('[data-pact]'); if (!a) return;
    if (a.dataset.pact === 'guide') openGuide();
    if (a.dataset.pact === 'test') testCues();
    if (a.dataset.pact === 'reset') {
      openDialog(`<h2>Reset app?</h2><p>This clears saved places, recent searches and settings.</p>
        <div class="btn-row"><button class="btn" data-dlg="close">Cancel</button><button class="btn btn-emg" data-dlg="ok">Reset</button></div>`,
        act => { if (act === 'ok') { try { localStorage.removeItem(STORE); } catch (err) {} location.reload(); } });
    }
  }
  function testCues() {
    const seq = [['left', 'Turn left'], ['right', 'Turn right'], ['lift', 'Take the lift'], ['offroute', 'Off route'], ['arrive', 'You have arrived']];
    seq.forEach(([c, txt], i) => setTimeout(() => F.cue(c, txt), i * 1800));
  }

  /* ---------------- Tabs ---------------- */
  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#mapView').hidden = tab !== 'map';
    $('#savedView').hidden = tab !== 'saved';
    $('#profileView').hidden = tab !== 'profile';
    if (tab === 'saved') { renderSaved(); $('#savedView h2').focus(); }
    if (tab === 'profile') { renderProfile(); $('#profileView h2').focus(); }
    if (tab === 'map') requestAnimationFrame(() => CA.Map.render());
  }

  /* ---------------- Sheet events (delegated) ---------------- */
  function bindSheet() {
    const h = $('#sheetHandle'); let y0 = null;
    h.addEventListener('pointerdown', e => { y0 = e.clientY; try { h.setPointerCapture(e.pointerId); } catch (err) {} });
    h.addEventListener('pointerup', e => {
      if (y0 == null) return;
      const dy = e.clientY - y0, i = SIZES.indexOf(S.sheet); y0 = null;
      if (dy < -30) setSheet(SIZES[Math.min(2, i + 1)]);
      else if (dy > 30) setSheet(SIZES[Math.max(0, i - 1)]);
      else setSheet(SIZES[(i + 1) % 3]);
    });
    h.addEventListener('click', e => { if (e.detail === 0) setSheet(SIZES[(SIZES.indexOf(S.sheet) + 1) % 3]); });

    contentEl.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      const id = b.dataset.id, act = b.dataset.act;
      switch (act) {
        case 'back': back(); break;
        case 'chip': toggleChip(id); break;
        case 'place': onPickPlace(id); break;
        case 'route': planRoute(id); break;
        case 'fav': toggleFav(id); renderSheet(false); refocus('fav', id); break;
        case 'showmap': CA.Map.focusNode(id); setSheet('peek'); break;
        case 'mode':
          S.plan.mode = id; computePlan(); renderSheet(false); refocus('mode', id);
          F.earcon('click'); F.announce(planSummaryText()); break;
        case 'addstop': openAddStop(); break;
        case 'rmstop': S.plan.stops.splice(Number(id), 1); computePlan(); renderSheet(false); F.announce('Stop removed.'); break;
        case 'start': startNav(); break;
        case 'repeat': repeat(); break;
        case 'end': endNav(); break;
        case 'tgl':
          if (id === 'voice') { F.state.muted = !F.state.muted; b.setAttribute('aria-pressed', !F.state.muted); toast(F.state.muted ? 'Voice off. Captions on.' : 'Voice on.'); }
          if (id === 'haptics') { F.state.hapticsOn = !F.state.hapticsOn; b.setAttribute('aria-pressed', F.state.hapticsOn); if (F.state.hapticsOn) F.haptic('straight'); }
          if (id === 'ar') setAR(!S.ar);
          break;
        case 'demo':
          if (id === 'pause') { S.nav.paused ? resumeNav() : pauseNav(); }
          if (id === 'off') simulateOffRoute();
          if (id === 'noisy') {
            F.state.noisy = !F.state.noisy; b.setAttribute('aria-pressed', F.state.noisy);
            F.cue('confirm');
            toast(F.state.noisy ? '📢 Noisy area: stronger vibration and screen flash on.' : 'Noise level back to normal.');
          }
          if (id === 'quiet') setQuietZone(!F.state.quietZone, false);
          break;
        case 'pinme':
          setMyLocation(S.pin.floor, S.pin.x, S.pin.y, S.pinNode);
          S.pin = null; CA.Map.setPin(null); S.history = []; show('home', { push: false }); break;
        case 'pinrm': back(); break;
        case 'done':
          S.arrived = null; S.history = []; CA.Map.setHighlight(null); show('home', { push: false }); break;
        case 'mic': if (e.detail === 0) startListening(); break; // keyboard / screen reader
        case 'say': F.earcon('listen'); handleUtterance(b.dataset.v, 1); break;
      }
    });

    contentEl.addEventListener('pointerdown', e => { if (e.target.closest('.mic')) micDown(e); });
    document.addEventListener('pointerup', micUp);
    document.addEventListener('pointercancel', micUp);

    contentEl.addEventListener('input', e => {
      if (e.target.id === 'q') { S.query = e.target.value; updateSuggest(e.target.value); }
    });
    contentEl.addEventListener('change', e => {
      if (e.target.id === 'simSpeed' && S.nav) S.nav.speedX = Number(e.target.value);
    });
    contentEl.addEventListener('keydown', e => {
      if (e.target.id === 'q') {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(e.target.value); }
        if (e.key === 'ArrowDown') { const f = $('#sg-0'); if (f && !$('#suggest').hidden) { e.preventDefault(); f.focus(); } }
        if (e.key === 'Escape') { $('#suggest').hidden = true; e.target.setAttribute('aria-expanded', 'false'); e.stopPropagation(); }
      } else if (e.target.closest('#suggest')) {
        const all = [...contentEl.querySelectorAll('#suggest button')], i = all.indexOf(e.target);
        if (e.key === 'ArrowDown' && i < all.length - 1) { e.preventDefault(); all[i + 1].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? all[i - 1] : $('#q')).focus(); }
      }
    });
    contentEl.addEventListener('focusin', e => { if (e.target.id === 'q' && S.sheet === 'peek') setSheet('half'); });
  }

  /* ---------------- Map callbacks & controls ---------------- */
  function onSelectNode(id) {
    const n = N[id]; if (!n) return;
    F.haptic('tick');
    if (S.nav) return toast(`${title(n)} · ${floorL(n.floor)}`);
    onPickPlace(id);
  }
  function onFloorChange(f, opts = {}) {
    updateFloorHint();
    if (!opts.silent) { F.announce(`Showing ${floorL(f)}`); F.haptic('tick'); }
  }
  function bindMapCtrls() {
    $('#zoomIn').addEventListener('click', () => CA.Map.zoomBy(1.25));
    $('#zoomOut').addEventListener('click', () => CA.Map.zoomBy(0.8));
    $('#compass').addEventListener('click', () => { CA.Map.resetNorth(); F.announce('Map facing north.'); });
    $('#locateBtn').addEventListener('click', () => {
      S.follow = true;
      CA.Map.setFloor(user.floor, { silent: true });
      CA.Map.centerOn(user.x, user.y, sheetFrac());
      F.announce(`Centred on your location, ${floorL(user.floor)}.`);
    });
  }
  function bindTabs() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#savedView').addEventListener('click', onSavedClick);
    $('#profileView').addEventListener('click', onProfileClick);
    $('#profileView').addEventListener('change', onSettingChange);
    $('#profileView').addEventListener('input', onSettingChange);
  }
  function bindGlobal() {
    $('#langBtn').addEventListener('click', () => {
      settings.lang = settings.lang === 'zh' ? 'en' : 'zh';
      applyLang(); persist(); renderSheet(false);
      if (!$('#profileView').hidden) renderProfile();
      if (!$('#savedView').hidden) renderSaved();
      toast(settings.lang === 'zh' ? '語言：繁體中文（語音導航暫時只有英文）' : 'Language: English');
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || $('#dialog').open) return;
      if (!S.nav && S.screen !== 'home' && $('#savedView').hidden && $('#profileView').hidden) back();
    });
    window.addEventListener('resize', () => { if (S.nav && S.follow) CA.Map.centerOn(user.x, user.y, sheetFrac()); });
  }

  /* ---------------- Init ---------------- */
  function init() {
    sheetEl = $('#sheet'); contentEl = $('#sheetContent');
    applySettings();
    CA.Map.init({
      onSelectNode, onFloorChange, onLongPress,
      onUserPan: () => { S.follow = false; },
      onFloorLimit: dir => toast(dir > 0 ? 'This is the top floor.' : 'This is the lowest floor.'),
      getFrac: sheetFrac
    });
    CA.Map.setFloor(user.floor, { silent: true, force: true });
    CA.Map.setUser(user);
    bindSheet(); bindMapCtrls(); bindEmergency(); bindTabs(); bindGlobal();
    setSheet('half');
    show('home', { push: false, focus: false });
    updateStatus();
    requestAnimationFrame(() => CA.Map.centerOn(user.x, user.y, sheetFrac()));
    if (!settings.profile) setTimeout(openOnboarding, 400);
  }

  return { settings, init, handleUtterance, openEmergency, user };
})();

CA.App.init();