/* ==========================================================
   CampusAssist – map.js  (v4 – Google-Maps-style basemap)
   • Basemap: campus land, parks, roads (lane arrows, labels
     that follow the road), cream buildings, context pins.
   • Indoor layer on top: zones, corridors, rooms, facilities.
   • Round category pins (icon + same-colour bilingual label).
   • Labels/symbols stay upright and a constant screen size.
   • Level of detail: indoor detail appears when zoomed in.
   Gestures: drag-pan, pinch-zoom, two-finger rotate, two-finger
   vertical swipe = change floor, double-tap zoom, long-press = pin.
   Keyboard: arrows pan, +/− zoom, [ ] rotate, N north,
   PgUp/PgDn floor, L legend.
   ========================================================== */
CA.Map = (() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const R = CA.Router, N = R.N;
  const BM = Object.assign({ campus: null, parks: [], context: [], roads: [], pois: [], areas: [] }, CA.BASEMAP || {});
  let svg, vp, L = {};
  let floor = '3';
  let K = 2;                                    // marker scale (≈ 1 marker unit = 1 screen px)
  const view = { s: 1, r: 0, tx: 0, ty: 0 };
  const st = { route: null, progress: null, user: null, pin: null, highlight: null, poiFilter: new Set() };
  const H = {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const frac = () => (H.getFrac ? H.getFrac() : 0);
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const shortName = n => (n.code ? n.code.replace(/^YEUNG-/, '') : n.name);
  const PIN_D = 'M0,0 C-5,-10 -14,-16 -14,-26 A14,14 0 1 1 14,-26 C14,-16 5,-10 0,0 Z';
  const LOD_PPU = 0.7;                          // screen px per map unit at which indoor detail appears
  const FLOOR_NAMES = Object.assign({ G: 'Ground floor', 3: 'Podium · footbridge level', 4: 'University Concourse' }, CA.FLOOR_NAMES || {});

  const MAINT = new Set();
  CA.EDGES.forEach(e => { if (e.maintenance) { MAINT.add(e.a); MAINT.add(e.b); } });

  /* ---------------- SVG helpers ---------------- */
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, s, attrs = {}) {
    const t = el('text', Object.assign({ x, y }, attrs), parent);
    t.textContent = s; return t;
  }
  const ptStr = arr => arr.map(p => (Array.isArray(p) ? p : [p.x, p.y]).join(',')).join(' ');
  const rectPoly = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  const centroid = pts => {
    const P = pts.map(p => (Array.isArray(p) ? p : [p.x, p.y]));
    return { x: P.reduce((s, p) => s + p[0], 0) / P.length, y: P.reduce((s, p) => s + p[1], 0) / P.length };
  };
  function shape(g, pts, cls, style) {
    const a = { points: ptStr(pts), class: cls }; if (style) a.style = style;
    return el('polygon', a, g);
  }
  function line(g, pts, cls, style) {
    const a = { points: ptStr(pts), class: cls }; if (style) a.style = style;
    return el('polyline', a, g);
  }

  /* ---------------- Constant-size upright markers ----------------
     mode: undefined = upright | 'norot' = turns with the map | number = follows a road angle */
  function marker(parent, x, y, attrs = {}, mode) {
    const m = el('g', Object.assign({ 'data-up': `${x} ${y}` }, attrs), parent);
    if (mode === 'norot') m.setAttribute('data-norot', '');
    else if (typeof mode === 'number') m.setAttribute('data-ang', String(mode));
    place(m);
    return m;
  }
  function place(m) {
    const [x, y] = m.getAttribute('data-up').split(' ');
    let rot = -view.r;
    if (m.hasAttribute('data-norot')) rot = 0;
    else if (m.hasAttribute('data-ang')) {          // road label: along the road, never upside-down
      let a = (Number(m.getAttribute('data-ang')) + view.r) % 360;
      if (a > 180) a -= 360; if (a < -180) a += 360;
      if (a > 90) a -= 180; else if (a <= -90) a += 180;
      rot = a - view.r;
    }
    m.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${K})`);
  }
  function ppu() { const m = svg && svg.getScreenCTM(); return ((m && m.a) || 0.5) * view.s; }
  function syncMarkers() {
    if (!svg) return;
    const p = ppu();
    K = clamp(1 / p, 0.55, 3.5);
    svg.querySelectorAll('[data-up]').forEach(place);
    svg.setAttribute('data-lod', p >= LOD_PPU ? '2' : '1');
    updateScale(p);
  }

  /* Multi-line label (Chinese first, then English, like Google Maps HK) */
  const LBL = {
    below: (o, i) => [0, o + 9 + i * 14, 'middle'],
    above: (o, i, n) => [0, -o - (n - 1 - i) * 14, 'middle'],
    right: (o, i, n) => [o, 4 + (i - (n - 1) / 2) * 14, 'start'],
    left:  (o, i, n) => [-o, 4 + (i - (n - 1) / 2) * 14, 'end']
  };
  function label(m, lines, pos = 'below', off = 20, cls = '') {
    lines = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    if (!lines.length) return null;
    const f = LBL[pos] || LBL.below;
    const t = el('text', { class: `map-lbl ${cls}`.trim(), 'text-anchor': f(off, 0, lines.length)[2] }, m);
    lines.forEach((s, i) => {
      const [x, y] = f(off, i, lines.length);
      el('tspan', { x, y, class: i === 0 ? 'l1' : i === 1 ? 'l2' : 'l3' }, t).textContent = s;
    });
    return t;
  }

  function nodeMarker(g, n, aria) {
    const m = marker(g, n.x, n.y, { 'data-node': n.id, tabindex: 0, role: 'button', 'aria-label': aria });
    el('title', {}, m).textContent = aria;
    el('circle', { r: 22, class: 'hit' }, m);           // 44–48 px touch target
    return m;
  }

  /* ---------------- Pin system (Google-style) ---------------- */
  const P = (g, d, cls = 'gg') => el('path', { d, class: cls }, g);
  const GLYPH = {
    cap:    g => P(g, 'M0,-6.5 L8.5,-2.5 L0,1.5 L-8.5,-2.5 Z M-5,-0.3 V3.6 Q0,7 5,3.6 V-0.3 L0,2.2 Z'),
    cup:    g => { P(g, 'M-6.5,-2.5 H4 V1.5 Q4,6 -1.2,6 Q-6.5,6 -6.5,1.5 Z'); P(g, 'M4,-0.5 Q7.2,-0.5 7.2,1.8 Q7.2,4 4,3.6 M-3.5,-7 Q-2,-5.5 -3.5,-4.2 M0,-7 Q1.5,-5.5 0,-4.2', 'gs'); },
    fork:   g => P(g, 'M-4,-7 V7 M-6.5,-7 V-2.5 Q-6.5,0 -4,0 Q-1.5,0 -1.5,-2.5 V-7 M4,7 V-7 Q1,-5 1,0 H4', 'gs'),
    bag:    g => { P(g, 'M-5.5,-2 H5.5 L4.5,7 H-4.5 Z'); P(g, 'M-2.5,-2 V-3.5 Q0,-7.5 2.5,-3.5 V-2', 'gs'); },
    cross:  g => P(g, 'M-2.3,-7 H2.3 V-2.3 H7 V2.3 H2.3 V7 H-2.3 V2.3 H-7 V-2.3 H-2.3 Z'),
    shield: g => P(g, 'M0,-7.5 L6.5,-4.8 V-0.5 C6.5,3.8 3.4,6.4 0,7.5 C-3.4,6.4 -6.5,3.8 -6.5,-0.5 V-4.8 Z'),
    book:   g => P(g, 'M-7.5,-5 Q-3.8,-6.6 -0.7,-4.6 V5.8 Q-3.8,3.8 -7.5,5.2 Z M7.5,-5 Q3.8,-6.6 0.7,-4.6 V5.8 Q3.8,3.8 7.5,5.2 Z'),
    dot:    g => el('circle', { r: 4.2, class: 'gg' }, g),
    wc:     g => { el('circle', { cx: -3.9, cy: -5, r: 1.8, class: 'gg' }, g); el('circle', { cx: 4, cy: -5, r: 1.8, class: 'gg' }, g);
                   P(g, 'M-6,-2 H-1.8 V7 H-6 Z M4,-2.3 L7.2,4 H0.8 Z M2.3,4 H5.7 V7 H2.3 Z'); },
    lift:   g => P(g, 'M-5,-1.5 L0,-7.5 L5,-1.5 Z M-5,1.5 L0,7.5 L5,1.5 Z'),
    stairs: g => P(g, 'M-7,6.5 V2.5 H-3 V-1.5 H1 V-5.5 H7', 'gs'),
    esc:    g => { P(g, 'M-7.5,6 H-3.5 L3.5,-3 H7.5', 'gs'); el('circle', { cx: -2, cy: -4.8, r: 1.8, class: 'gg' }, g); },
    door:   g => P(g, 'M-6.5,0 H3 M-0.5,-3.8 L3.3,0 L-0.5,3.8 M6.5,-6.5 V6.5', 'gs'),
    mtr:    g => P(g, 'M-3.6,-5.6 A6.6,6.6 0 0,0 -3.6,5.6 M3.6,-5.6 A6.6,6.6 0 0,1 3.6,5.6 M0,-7.5 V7.5 M-7.5,0 H7.5', 'gs')
  };
  /* type → [colour tone, glyph] */
  const CAT = {
    room: ['edu', 'cap'], edu: ['edu', 'cap'], library: ['edu', 'book'],
    cafe: ['food', 'cup'], canteen: ['food', 'fork'], food: ['food', 'fork'], shop: ['shop', 'bag'],
    firstaid: ['health', 'cross'], security: ['sec', 'shield'], sport: ['sport', 'dot'],
    wc: ['util', 'wc'], lift: ['util', 'lift'], stairs: ['util', 'stairs'], escalator: ['util', 'esc'],
    door: ['util', 'door'], transit: ['transit', 'mtr'], landmark: ['lm', null]
  };
  function gpin(g, type, r = 11, letter) {
    const [tone, gl] = CAT[type] || ['util', null];
    g.classList.add('gp', `gp--${tone}`);
    el('circle', { r, class: 'gp-bg' }, g);
    const s = el('g', { transform: `scale(${(r / 12).toFixed(3)})` }, g);
    if (gl && GLYPH[gl]) GLYPH[gl](s);
    else txt(s, 0, 4.5, letter || '•', { class: 'gp-letter', 'text-anchor': 'middle' });
    return tone;
  }

  /* ---------------- Init ---------------- */
  function init(handlers) {
    svg = document.getElementById('map');
    vp = document.getElementById('viewport');
    L = { base: document.getElementById('layerBase'), route: document.getElementById('layerRoute'),
          poi: document.getElementById('layerPoi'), user: document.getElementById('layerUser') };
    Object.assign(H, handlers || {});
    ensureDefs();
    buildOverlays();
    bindGestures();
    applyView();
    render();
    renderFloorSel();
    window.addEventListener('resize', syncMarkers);
    requestAnimationFrame(syncMarkers);
  }

  function ensureDefs() {
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    const pat = (id, draw) => {
      if (document.getElementById(id)) return;
      draw(el('pattern', { id, width: 12, height: 12, patternUnits: 'userSpaceOnUse' }, defs));
    };
    pat('patDiag',  p => el('path', { d: 'M-3,3 L3,-3 M0,12 L12,0 M9,15 L15,9', class: 'pat-stroke' }, p));
    pat('patDots',  p => el('circle', { cx: 6, cy: 6, r: 1.6, class: 'pat-fill' }, p));
    pat('patCross', p => el('path', { d: 'M0,0 L12,12 M12,0 L0,12', class: 'pat-stroke' }, p));
    pat('patVert',  p => el('path', { d: 'M6,0 V12', class: 'pat-stroke' }, p));
  }

  /* ---------------- Overlays: floor title, scale bar, legend ---------------- */
  function buildOverlays() {
    const wrap = svg.closest('.map-wrap') || svg.parentElement;
    const info = document.createElement('div');
    info.className = 'map-info';
    info.innerHTML = '<div class="map-floor" id="mapFloorTitle"></div>' +
      '<div class="scale" aria-hidden="true"><i id="scaleBar"></i><span id="scaleTxt"></span></div>';
    wrap.appendChild(info);

    const panel = document.createElement('div');
    panel.id = 'mapLegend'; panel.className = 'map-legend'; panel.hidden = true; panel.tabIndex = -1;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Map legend');
    panel.appendChild(legendContent());
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); toggleLegend(false); document.getElementById('legendBtn').focus(); }
    });
    wrap.appendChild(panel);

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fab'; btn.id = 'legendBtn';
    btn.setAttribute('aria-label', 'Map legend');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'mapLegend');
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
    btn.addEventListener('click', () => toggleLegend());
    (document.querySelector('.map-ctrls') || wrap).appendChild(btn);
  }
  function toggleLegend(force) {
    const p = document.getElementById('mapLegend'), b = document.getElementById('legendBtn');
    if (!p) return;
    const on = force != null ? force : p.hidden;
    p.hidden = !on;
    if (b) b.setAttribute('aria-expanded', String(on));
    if (on) p.focus();
  }

  function legendContent() {
    const frag = document.createDocumentFragment();
    const head = document.createElement('div');
    head.className = 'lg-head';
    head.innerHTML = '<strong>Map legend</strong><button type="button" class="icon-btn" aria-label="Close legend">✕</button>';
    head.querySelector('button').onclick = () => { toggleLegend(false); document.getElementById('legendBtn').focus(); };
    frag.appendChild(head);

    const section = (title, rows) => {
      const h = document.createElement('h3'); h.textContent = title; frag.appendChild(h);
      const ul = document.createElement('ul');
      rows.forEach(([draw, text]) => {
        const li = document.createElement('li'); li.className = 'lg-row';
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', '-19 -13 38 26'); s.setAttribute('aria-hidden', 'true');
        draw(s); li.appendChild(s);
        const sp = document.createElement('span'); sp.textContent = text; li.appendChild(sp);
        ul.appendChild(li);
      });
      frag.appendChild(ul);
    };
    const seg = { x1: -16, y1: 0, x2: 16, y2: 0 };
    const routeLine = cls => s => { el('line', Object.assign({ class: 'route-casing' }, seg), s); el('line', Object.assign({ class: cls }, seg), s); };
    const road = (cls, w) => s => {
      el('line', Object.assign({ class: `rd-edge rd--${cls}`, style: `stroke-width:${w + 4}` }, seg), s);
      el('line', Object.assign({ class: `rd rd--${cls}`, style: `stroke-width:${w}` }, seg), s);
    };
    const corr = open => s => {
      const o = open ? ' corr--open' : '';
      el('line', Object.assign({ class: 'corr-edge' + o, style: 'stroke-width:14' }, seg), s);
      el('line', Object.assign({ class: 'corr' + o, style: 'stroke-width:10' }, seg), s);
    };
    const area = cls => s => el('rect', { x: -15, y: -9, width: 30, height: 18, rx: 4, class: cls }, s);
    const pin = type => s => gpin(el('g', {}, s), type, 10);

    section('Route', [
      [routeLine('route'), 'Fastest route'],
      [routeLine('route route--stepfree'), 'Step-free route (dashed)'],
      [routeLine('route route--covered'), 'Covered route (dotted)'],
      [s => el('line', Object.assign({ class: 'route-done' }, seg), s), 'Already walked']
    ]);
    section('Map', [
      [road('major', 10), 'Main road'], [road('minor', 7), 'Street'],
      [corr(false), 'Indoor corridor'], [corr(true), 'Open-air walkway / footbridge'],
      [area('bld'), 'Campus building'], [area('bm-bld bm-bld--res'), 'Other building'], [area('bm-park'), 'Park / open space']
    ]);
    section('Places', [
      [pin('edu'), 'Academic building / room'], [pin('cafe'), 'Café'], [pin('canteen'), 'Canteen / restaurant'],
      [pin('shop'), 'Shopping'], [pin('firstaid'), 'First aid'], [pin('security'), 'Security'],
      [pin('library'), 'Library'], [pin('sport'), 'Sports centre'], [pin('wc'), 'Accessible toilet'],
      [pin('lift'), 'Lift'], [pin('stairs'), 'Stairs'], [pin('escalator'), 'Escalator'],
      [pin('door'), 'Building entrance'], [pin('transit'), 'MTR exit'],
      [s => { gpin(el('g', {}, s), 'lift', 10);
              el('line', { x1: -9, y1: -9, x2: 9, y2: 9, class: 'sym-x' }, s);
              el('line', { x1: 9, y1: -9, x2: -9, y2: 9, class: 'sym-x' }, s); }, 'Closed / maintenance']
    ]);
    section('Colour zones (YEUNG, north-west → south-east)', (CA.ZONE_ORDER || Object.keys(CA.ZONES)).map(k => [k, CA.ZONES[k]]).map(([k, z]) => [
      s => { el('rect', { x: -10, y: -10, width: 20, height: 20, rx: 5, class: 'zone-badge', style: `fill:${z.color}` }, s);
             txt(s, 0, 4.5, k, { class: 'zone-letter', 'text-anchor': 'middle', style: `fill:${z.text}` }); },
      `${z.name} – letter ${k}`
    ]));
    section('You', [
      [s => { el('circle', { r: 11, class: 'user-acc' }, s); el('circle', { r: 6, class: 'user-dot' }, s); }, 'Your position'],
      [s => { const g = el('g', { transform: 'translate(0 11) scale(.55)' }, s); el('path', { d: PIN_D, class: 'dest-pin' }, g); }, 'Destination']
    ]);
    return frag;
  }

  function updateFloorTitle() {
    const t = document.getElementById('mapFloorTitle'); if (!t) return;
    t.textContent = '';
    const b = document.createElement('strong'); b.textContent = R.floorLabel(floor);
    t.appendChild(b);
    if (FLOOR_NAMES[floor]) t.appendChild(document.createTextNode(' ' + FLOOR_NAMES[floor]));
  }
  function updateScale(p) {
    const bar = document.getElementById('scaleBar'), lab = document.getElementById('scaleTxt');
    if (!bar || !lab) return;
    const pxPerM = p / CA.M_PER_UNIT;
    const len = [2, 5, 10, 20, 50, 100, 200].find(m => m * pxPerM >= 48) || 200;
    bar.style.width = `${Math.round(len * pxPerM)}px`;
    lab.textContent = `${len} m`;
  }

  /* ---------------- View transform ---------------- */
  function applyView() {
    vp.setAttribute('transform',
      `translate(${view.tx} ${view.ty}) translate(500 350) rotate(${view.r}) scale(${view.s}) translate(-500 -350)`);
    const needle = document.getElementById('compassNeedle');
    if (needle) needle.style.transform = `rotate(${view.r - 90}deg)`;
    syncMarkers();
  }
  function setScaleRot(s, r, base = Object.assign({}, view)) {
    const k = s / base.s, th = (r - base.r) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    view.s = s; view.r = r;
    view.tx = k * (c * base.tx - sn * base.ty);
    view.ty = k * (sn * base.tx + c * base.ty);
    applyView();
  }
  const zoomBy = f => setScaleRot(clamp(view.s * f, 0.6, 4), view.r);
  const rotateBy = d => setScaleRot(view.s, view.r + d);
  const resetNorth = () => setScaleRot(view.s, 0);
  function unitsPerPx() { const m = svg.getScreenCTM(); return m && m.a ? 1 / m.a : 1; }

  function centerOn(x, y, f = 0) {
    const m = svg.getScreenCTM(); if (!m || !m.a) return;
    const visH = svg.getBoundingClientRect().height / m.a;
    const th = view.r * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const dx = x - 500, dy = y - 350;
    const rx = view.s * (dx * c - dy * s), ry = view.s * (dx * s + dy * c);
    view.tx = -rx;
    view.ty = -(f * visH) / 2 - ry;
    applyView();
  }
  function clientToMap(cx, cy) {
    const m = vp.getScreenCTM(); if (!m) return null;
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    const q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }

  /* ---------------- Road helpers ---------------- */
  function along(arr, every, start, fn) {
    let carry = start;
    for (let i = 0; i < arr.length - 1; i++) {
      const [ax, ay] = arr[i], [bx, by] = arr[i + 1], len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, ang = Math.atan2(uy, ux) * 180 / Math.PI;
      let d = carry;
      while (d < len) { fn(ax + ux * d, ay + uy * d, ux, uy, ang); d += every; }
      carry = d - len;
    }
  }
  function pointAt(arr, f) {
    const segs = []; let tot = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      const l = Math.hypot(arr[i + 1][0] - arr[i][0], arr[i + 1][1] - arr[i][1]); segs.push(l); tot += l;
    }
    let d = f * tot;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) {
        const [ax, ay] = arr[i], [bx, by] = arr[i + 1], k = segs[i] ? Math.min(1, d / segs[i]) : 0;
        return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, ang: Math.atan2(by - ay, bx - ax) * 180 / Math.PI };
      }
      d -= segs[i];
    }
    return { x: arr[0][0], y: arr[0][1], ang: 0 };
  }
  /* Lane arrows – Hong Kong drives on the LEFT */
  function roadArrows(g, r) {
    if (!r.arrows) return;
    const off = r.w / 4;
    const lanes = r.arrows === 'one' ? [[0, 0]] : [[1, 0], [-1, 180]];
    along(r.pts, 150, 60, (x, y, ux, uy, ang) => lanes.forEach(([sg, da]) => {
      const m = marker(g, x + uy * off * sg, y - ux * off * sg, { 'aria-hidden': 'true', class: 'rd-arrow' }, 'norot');
      el('path', { d: 'M-5,0 H4 M0.5,-3.5 L4.5,0 L0.5,3.5', transform: `rotate(${ang + da})` }, m);
    }));
  }
  function roadLabel(g, r) {
    const name = [r.zh, r.en].filter(Boolean).join(' · ');
    if (!name) return;
    (r.labelAt || [0.5]).forEach(f => {
      const p = pointAt(r.pts, f);
      const m = marker(g, p.x, p.y, { 'aria-hidden': 'true' }, p.ang);
      txt(m, 0, 4.5, name, { class: `rd-lbl rd-lbl--${r.cls}`, 'text-anchor': 'middle' });
    });
  }

  /* ---------------- Rendering ---------------- */
  function render() { drawBase(); drawRoute(); drawPois(); drawUser(); updateFloorTitle(); }

  function drawBase() {
    const g = L.base; g.innerHTML = '';
    el('rect', { x: -3000, y: -3000, width: 7000, height: 7000, class: 'map-ground' }, g);

    // 1. Land use
    if (BM.campus) shape(g, BM.campus, 'bm-campus');
    BM.parks.forEach(p => shape(g, p.poly, 'bm-park'));

    // 2. Roads (edge → fill → green median)
    BM.roads.forEach(r => line(g, r.pts, `rd-edge rd--${r.cls}`, `stroke-width:${r.w + 4}`));
    BM.roads.forEach(r => line(g, r.pts, `rd rd--${r.cls}`, `stroke-width:${r.w}`));
    BM.roads.filter(r => r.median).forEach(r => line(g, r.pts, 'rd-median'));

    // 3. Buildings
    BM.context.forEach(b => shape(g, b.poly, `bm-bld bm-bld--${b.kind || 'campus'}`));
    const blds = CA.BUILDINGS.filter(b => b.floors === 'all' || b.floors.includes(floor));
    blds.forEach(b => shape(g, b.poly || rectPoly(b), 'bld'));

    const onFloor = CA.NODES.filter(n => n.floor === floor);
    const mapped = onFloor.length > 0;

    // 4. Indoor: zones (tint + pattern), corridors
    if (mapped) CA.ZONE_AREAS.forEach(a => {
      const z = CA.ZONES[a.zone], pts = a.poly || rectPoly(a);
      shape(g, pts, 'zone-area', `fill:${z.color};stroke:${z.color}`);
      if (z.pattern) shape(g, pts, 'zone-pat').setAttribute('fill', `url(#${z.pattern})`);
    });
    const walks = CA.EDGES.filter(e => e.type === 'walk' && N[e.a].floor === floor && N[e.b].floor === floor);
    const seg = (e, cls) => {
      const a = N[e.a], b = N[e.b];
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls + (e.covered ? '' : ' corr--open') }, g);
    };
    walks.forEach(e => seg(e, 'corr-edge'));
    walks.forEach(e => seg(e, 'corr'));

    // 5. Road arrows + names
    BM.roads.forEach(r => { roadArrows(g, r); roadLabel(g, r); });

    // 6. Zone badges
    if (mapped) CA.ZONE_AREAS.forEach(a => {
      const z = CA.ZONES[a.zone], at = a.at || { x: a.x + 18, y: a.y + 18 };
      const m = marker(g, at.x, at.y, { 'aria-hidden': 'true' });
      el('rect', { x: -10, y: -10, width: 20, height: 20, rx: 5, class: 'zone-badge', style: `fill:${z.color}` }, m);
      txt(m, 0, 4.5, a.zone, { class: 'zone-letter', 'text-anchor': 'middle', style: `fill:${z.text}` });
      label(m, z.name, 'right', 15, 'map-lbl--zone lod-2');
    });

    // 7. Area names, context pins, building names
    BM.areas.forEach(a => label(marker(g, a.x, a.y, { 'aria-hidden': 'true' }), [a.zh, a.en], 'above', 0,
      'map-lbl--area' + (a.lod === 1 ? ' lod-1only' : '')));
    BM.pois.forEach(p => {
      const m = marker(g, p.x, p.y, { 'aria-hidden': 'true' });
      if (p.cat) gpin(m, p.cat, 11);
      label(m, [p.zh, p.en, p.sub], p.cat ? (p.pos || 'right') : 'above', p.cat ? 16 : 0, p.cls || '');
    });
    blds.forEach(b => {
      if (!b.labelAt) return;
      const m = marker(g, b.labelAt.x, b.labelAt.y, { 'aria-hidden': 'true' });
      gpin(m, 'edu', 11);
      label(m, [b.zh, b.en || b.name], b.labelPos || 'right', 16, 'map-lbl--bld');
    });

    if (!mapped && CA.BUILDINGS[0]) {
      const c = centroid(CA.BUILDINGS[0].poly || rectPoly(CA.BUILDINGS[0]));
      label(marker(g, c.x, c.y, { 'aria-hidden': 'true' }), `${R.floorLabel(floor)}: indoor map not available yet`, 'above', 0, 'map-lbl--strong');
    }

    // 8. Indoor places
    onFloor.forEach(n => {
      const fl = R.floorLabel(n.floor);
      switch (n.cat) {
        case 'room': {
          const z = n.zone && CA.ZONES[n.zone];
          const m = nodeMarker(g, n, `${n.code || n.name}, ${n.name}${z ? ', ' + z.name : ''}, ${fl}`);
          gpin(m, 'room', 10);
          if (z) {
            el('rect', { x: 14, y: -9, width: 18, height: 18, rx: 4, class: 'zone-chip lod-2', style: `fill:${z.color}` }, m);
            txt(m, 23, 4.5, n.zone, { class: 'zone-chip-t lod-2', 'text-anchor': 'middle', style: `fill:${z.text}` });
          }
          txt(m, z ? 36 : 15, 4.5, shortName(n), { class: 'map-lbl map-lbl--room lod-2' });
          break;
        }
        case 'landmark': {
          const m = nodeMarker(g, n, `${n.name}, landmark, ${fl}`);
          gpin(m, 'landmark', 10, n.name.slice(-1));
          label(m, [n.zh, n.name], n.labelPos || 'right', 15, 'lod-2');
          break;
        }
        case 'stairs':
        case 'escalator': {
          const m = nodeMarker(g, n, `${n.name}, ${fl}`);
          m.classList.add('lod-2');
          gpin(m, n.cat, 9);
          label(m, n.name, n.labelPos || 'below', 13, 'lod-2');
          break;
        }
        case 'entrance': {
          const m = nodeMarker(g, n, `${n.name}, entrance, ${fl}`);
          if (n.outdoor) { gpin(m, 'transit', 12); label(m, [n.zh, n.name], n.labelPos || 'right', 17, 'map-lbl--strong'); }
          else { gpin(m, 'door', 10); label(m, [n.zh, n.name], n.labelPos || 'below', 14, 'lod-2'); }
          break;
        }
        case 'junction': {
          if (n.search) {
            const m = nodeMarker(g, n, `${n.name}, ${fl}`);
            el('circle', { r: 4.5, class: 'jn-dot' }, m);
            label(m, [n.zh, n.name], n.labelPos || 'above', 9, 'map-lbl--soft lod-2');
          } else if (/bridge|link/i.test(n.name)) {
            label(marker(g, n.x, n.y, { 'aria-hidden': 'true' }), [n.zh, n.name], n.labelPos || 'below', 12, 'map-lbl--soft lod-2');
          }
          break;
        }
      }
    });
  }

  function drawPois() {
    const g = L.poi; g.innerHTML = '';
    const f = st.poiFilter;
    CA.NODES.filter(n => n.poi && n.floor === floor).forEach(n => {
      const maint = MAINT.has(n.id), hl = f.has(n.poi) || st.highlight === n.id;
      const aria = `${n.name}${n.serves ? ', serves ' + n.serves : ''}${maint ? ', under maintenance' : ''}, ${R.floorLabel(n.floor)}`;
      const m = nodeMarker(g, n, aria);
      m.setAttribute('class', 'poi' + (hl ? ' poi--hl' : '') + (f.size && !f.has(n.poi) ? ' poi--dim' : ''));
      const r = hl ? 14 : 11;
      const tone = gpin(m, n.poi, r);
      if (tone === 'util' && !hl && !maint) m.classList.add('lod-2');   // toilets/lifts appear when zoomed in
      if (maint) {
        el('line', { x1: -r, y1: -r, x2: r, y2: r, class: 'sym-x' }, m);
        el('line', { x1: r, y1: -r, x2: -r, y2: r, class: 'sym-x' }, m);
        txt(m, 0, r + 15, `${n.name} · Closed`, { class: 'sym-closed', 'text-anchor': 'middle' });
      } else {
        label(m, [n.zh, n.name], n.labelPos || 'right', r + 5, hl ? '' : 'lod-2');
      }
    });
    const h = st.highlight && N[st.highlight];
    if (h && h.floor === floor) el('circle', { r: 26, class: 'hl-ring' }, marker(g, h.x, h.y, { 'aria-hidden': 'true' }));
  }

  function pill(g, x, y, s) {
    const m = marker(g, x, y, { 'aria-hidden': 'true' });
    const w = s.length * 7 + 18;
    el('rect', { x: 12, y: -36, width: w, height: 24, rx: 12, class: 'transition-pill' }, m);
    txt(m, 12 + w / 2, -19.5, s, { class: 'transition-text', 'text-anchor': 'middle' });
  }
  function chevrons(g, run) {
    let carry = 30;
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i], b = run[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len) continue;
      const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      let d = carry;
      while (d < len) {
        const m = marker(g, a.x + (b.x - a.x) * d / len, a.y + (b.y - a.y) * d / len, { 'aria-hidden': 'true' }, 'norot');
        el('path', { d: 'M-2.5,-3.5 L1.5,0 L-2.5,3.5', class: 'route-chev', transform: `rotate(${ang})` }, m);
        d += 70;
      }
      carry = d - len;
    }
  }

  function drawRoute() {
    const g = L.route; g.innerHTML = '';
    const r = st.route; if (!r) return;
    const runs = []; let cur = null;
    r.edges.forEach((e, i) => {
      const a = N[r.path[i]], b = N[r.path[i + 1]];
      if (e.type === 'walk' && a.floor === floor && b.floor === floor) {
        if (!cur) { cur = [a]; runs.push(cur); }
        cur.push(b);
      } else cur = null;
    });
    const modeCls = r.mode === 'stepfree' ? ' route--stepfree' : r.mode === 'covered' ? ' route--covered' : '';
    runs.forEach(run => line(g, run, 'route-casing'));
    runs.forEach(run => line(g, run, 'route' + modeCls));
    if (r.mode !== 'covered') runs.forEach(run => chevrons(g, run));

    const p = st.progress;
    if (p) {
      r.edges.forEach((e, i) => {
        if (i >= p.idx || e.type !== 'walk') return;
        const a = N[r.path[i]], b = N[r.path[i + 1]];
        if (a.floor === floor && b.floor === floor) el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'route-done' }, g);
      });
      const a = N[r.path[p.idx]], e = r.edges[p.idx];
      if (a && e && e.type === 'walk' && a.floor === floor && p.x != null)
        el('line', { x1: a.x, y1: a.y, x2: p.x, y2: p.y, class: 'route-done' }, g);
    }

    r.edges.forEach((e, i) => {
      if (e.type === 'walk') return;
      const a = N[r.path[i]], b = N[r.path[i + 1]];
      const up = R.FI(b.floor) > R.FI(a.floor);
      const via = cap(String(e.label || e.type).replace(/^the\s+/i, ''));
      if (a.floor === floor) pill(g, a.x, a.y, `${up ? '▲' : '▼'} ${via} to ${R.floorLabel(b.floor)}`);
      if (b.floor === floor) pill(g, b.x, b.y, `${via} from ${R.floorLabel(a.floor)}`);
    });

    (r.stops || []).forEach((s, i) => {
      const n = N[s.id]; if (n.floor !== floor) return;
      const m = marker(g, n.x, n.y, { 'aria-hidden': 'true' });
      el('circle', { r: 11, class: 'dest-pin' }, m);
      txt(m, 0, 4.5, String(i + 1), { class: 'transition-text', 'text-anchor': 'middle' });
    });

    const s0 = N[r.from];
    if (s0.floor === floor && !p) el('circle', { r: 7, class: 'start-dot' }, marker(g, s0.x, s0.y, { 'aria-hidden': 'true' }));
    const d = N[r.to];
    if (d.floor === floor) {
      const m = marker(g, d.x, d.y, { 'aria-hidden': 'true' });
      el('path', { d: PIN_D, class: 'dest-pin' }, m);
      el('circle', { cy: -26, r: 5, class: 'dest-eye' }, m);
      txt(m, 0, -50, shortName(d), { class: 'dest-lbl', 'text-anchor': 'middle' });
    }
  }

  function drawUser() {
    const g = L.user; g.innerHTML = '';
    const p = st.pin;
    if (p && p.floor === floor) {
      const m = marker(g, p.x, p.y, { 'aria-hidden': 'true' });
      el('path', { d: PIN_D, class: 'pin' }, m);
      el('circle', { cy: -26, r: 5, class: 'pin-eye' }, m);
    }
    const u = st.user;
    if (!u || u.floor !== floor) return;
    const m = marker(g, u.x, u.y, { 'aria-hidden': 'true' }, 'norot');
    el('circle', { r: 20, class: 'user-acc' }, m);
    if (u.heading != null) el('path', { d: 'M0,-24 L9,-11 L-9,-11 Z', class: 'user-heading', transform: `rotate(${u.heading + 90})` }, m);
    el('circle', { r: 8, class: 'user-dot' }, m);
    label(marker(g, u.x, u.y, { 'aria-hidden': 'true' }), 'You', 'right', 14, 'user-lbl lod-2');
  }

  /* ---------------- Floor selector ---------------- */
  function renderFloorSel() {
    const box = document.getElementById('floorSel'); if (!box) return;
    const uf = st.user && st.user.floor;
    const df = st.route && N[st.route.to].floor;
    box.innerHTML = '';
    CA.FLOORS.forEach(f => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'floor-btn' + (f === floor ? ' is-cur' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(f === floor));
      b.setAttribute('aria-label', `Floor ${f}${f === uf ? ', you are here' : ''}${f === df ? ', destination' : ''}`);
      b.textContent = f;
      if (f === uf) { const d = document.createElement('span'); d.className = 'you-dot'; d.setAttribute('aria-hidden', 'true'); b.appendChild(d); }
      if (f === df && f !== uf) b.style.boxShadow = 'inset 0 0 0 3px var(--maroon)';
      b.addEventListener('click', () => setFloor(f));
      box.appendChild(b);
    });
  }
  function setFloor(f, opts = {}) {
    if (!CA.FLOORS.includes(f)) return;
    const changed = f !== floor;
    floor = f;
    if (changed || opts.force) { render(); renderFloorSel(); }
    if (changed && H.onFloorChange) H.onFloorChange(f, opts);
  }
  function stepFloor(dir) {
    const i = CA.FLOORS_ASC.indexOf(floor) + dir;
    if (i >= 0 && i < CA.FLOORS_ASC.length) setFloor(CA.FLOORS_ASC[i]);
    else if (H.onFloorLimit) H.onFloorLimit(dir);
  }

  /* ---------------- Gestures ---------------- */
  function bindGestures() {
    const ptrs = new Map();
    let g = null, lpTimer = null, lastTap = 0;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

    svg.addEventListener('pointerdown', e => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        g = { type: 'pan', sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, longPressed: false, target: e.target };
        clearTimeout(lpTimer);
        lpTimer = setTimeout(() => {
          if (g && g.type === 'pan' && !g.moved && ptrs.size === 1) {
            g.longPressed = true;
            const p = clientToMap(g.sx, g.sy);
            if (p && H.onLongPress) H.onLongPress(floor, p.x, p.y);
          }
        }, 600);
      } else if (ptrs.size === 2) {
        clearTimeout(lpTimer);
        const [a, b] = [...ptrs.values()];
        g = { type: 'two', d0: dist(a, b) || 1, a0: ang(a, b), m0y: (a.y + b.y) / 2, base: Object.assign({}, view), decided: null, dY: 0, fired: false };
      }
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    });

    svg.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g) return;
      if (g.type === 'pan' && ptrs.size === 1) {
        const dx = e.clientX - g.lx, dy = e.clientY - g.ly;
        if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) {
          g.moved = true; clearTimeout(lpTimer);
          if (H.onUserPan) H.onUserPan();
        }
        if (g.moved) { const k = unitsPerPx(); view.tx += dx * k; view.ty += dy * k; applyView(); }
        g.lx = e.clientX; g.ly = e.clientY;
      } else if (g.type === 'two' && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const ratio = dist(a, b) / g.d0, dA = angDiff(ang(a, b), g.a0), dY = (a.y + b.y) / 2 - g.m0y;
        if (!g.decided) {
          if (Math.abs(dY) > 40 && Math.abs(ratio - 1) < 0.15 && Math.abs(dA) < 12) g.decided = 'swipe';
          else if (Math.abs(ratio - 1) > 0.08 || Math.abs(dA) > 8) { g.decided = 'pinch'; if (H.onUserPan) H.onUserPan(); }
        }
        if (g.decided === 'pinch') setScaleRot(clamp(g.base.s * ratio, 0.6, 4), g.base.r + dA, g.base);
        g.dY = dY;
      }
    });

    const end = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      clearTimeout(lpTimer);
      if (!g) return;
      if (g.type === 'two') {
        if (g.decided === 'swipe' && !g.fired) { g.fired = true; stepFloor(g.dY < 0 ? 1 : -1); }
        if (ptrs.size === 0) g = null;
        return;
      }
      if (ptrs.size === 0) {
        if (!g.moved && !g.longPressed && e.type === 'pointerup') {
          const now = Date.now();
          if (now - lastTap < 300) { zoomBy(1.6); lastTap = 0; }
          else {
            lastTap = now;
            const n = g.target && g.target.closest && g.target.closest('[data-node]');
            if (n && H.onSelectNode) H.onSelectNode(n.getAttribute('data-node'));
          }
        }
        g = null;
      }
    };
    ['pointerup', 'pointercancel'].forEach(t => svg.addEventListener(t, end));

    svg.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

    svg.addEventListener('click', e => {
      if (e.detail !== 0) return;
      const n = e.target.closest('[data-node]');
      if (n && H.onSelectNode) H.onSelectNode(n.getAttribute('data-node'));
    });

    svg.addEventListener('keydown', e => {
      const step = 40;
      switch (e.key) {
        case 'ArrowLeft':  view.tx += step; applyView(); break;
        case 'ArrowRight': view.tx -= step; applyView(); break;
        case 'ArrowUp':    view.ty += step; applyView(); break;
        case 'ArrowDown':  view.ty -= step; applyView(); break;
        case '+': case '=': zoomBy(1.25); break;
        case '-': case '_': zoomBy(0.8); break;
        case '[': rotateBy(-15); break;
        case ']': rotateBy(15); break;
        case 'n': case 'N': resetNorth(); break;
        case 'l': case 'L': toggleLegend(); break;
        case 'PageUp': stepFloor(1); break;
        case 'PageDown': stepFloor(-1); break;
        case 'Enter': case ' ': {
          const n = e.target.closest && e.target.closest('[data-node]');
          if (n && H.onSelectNode) H.onSelectNode(n.getAttribute('data-node'));
          break;
        }
        default: return;
      }
      if (e.key.startsWith('Arrow') && H.onUserPan) H.onUserPan();
      e.preventDefault();
    });
  }

  /* ---------------- Public state setters ---------------- */
  function setRoute(r) { st.route = r; st.progress = null; drawRoute(); renderFloorSel(); }
  function setProgress(idx, x, y) { st.progress = idx == null ? null : { idx, x, y }; drawRoute(); }
  function setUser(u) {
    const prevF = st.user && st.user.floor;
    st.user = Object.assign({}, u);
    drawUser();
    if (prevF !== u.floor) renderFloorSel();
  }
  function setPin(p) { st.pin = p; drawUser(); }
  function setHighlight(id) { st.highlight = id; drawPois(); }
  function setPoiFilter(set) { st.poiFilter = new Set(set); drawPois(); }
  function setNavigating(on) { svg.classList.toggle('navigating', !!on); }

  function focusNode(id) {
    const n = N[id]; if (!n) return;
    setFloor(n.floor, { silent: true });
    if (view.s < 1.5) setScaleRot(1.5, view.r);
    setHighlight(id);
    centerOn(n.x, n.y, frac());
  }
  function fitRoute() {
    const r = st.route; if (!r) return;
    const f0 = N[r.from].floor;
    setFloor(f0, { silent: true });
    const ps = r.path.map(id => N[id]).filter(n => n.floor === f0);
    const xs = ps.map(n => n.x), ys = ps.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const m = svg.getScreenCTM();
    if (m && m.a) {
      const rect = svg.getBoundingClientRect();
      const visW = rect.width / m.a, visH = (rect.height / m.a) * (1 - frac());
      setScaleRot(clamp(Math.min(visW / (maxX - minX + 160), visH / (maxY - minY + 160)), 0.6, 2.2), view.r);
    }
    centerOn((minX + maxX) / 2, (minY + maxY) / 2, frac());
  }

  return {
    init, render, setFloor, getFloor: () => floor, stepFloor,
    setRoute, setProgress, setUser, setPin, setHighlight, setPoiFilter, setNavigating,
    zoomBy, rotateBy, resetNorth, centerOn, focusNode, fitRoute, clientToMap, toggleLegend
  };
})();