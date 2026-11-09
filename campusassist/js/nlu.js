/* ==========================================================
   CampusAssist – nlu.js
   Search + disambiguation + fuzzy matching + spoken-number
   normalisation + intent parsing for voice commands.
   ========================================================== */
CA.NLU = (() => {
  'use strict';
  const N = CA.Router.N;
  const stripAccents = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const norm = s => stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9\u4e00-\u9fff]/g, '');

  const places = CA.NODES.filter(n => n.search);
  places.forEach(p => {
    const k = [p.name, p.code || '', ...(p.aliases || [])];
    if (p.code) { const m = p.code.match(/^YEUNG-([PGBYR]\d{4})$/); if (m) k.push(m[1]); }
    p._keys = k.map(norm).filter(Boolean);
  });

  /* ---- spoken numbers: "B forty three oh two" → "b4302" ---- */
  const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const ZONE_WORDS = { purple: 'p', papa: 'p', green: 'g', golf: 'g', blue: 'b', bravo: 'b', yellow: 'y', yankee: 'y', red: 'r', romeo: 'r' };

  function normalizeSpoken(text) {
    const w = stripAccents(String(text || '').toLowerCase())
      .replace(/-/g, ' ').replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < w.length; i++) {
      const x = w[i], nx = w[i + 1];
      if (x in TENS) {
        if (nx in UNITS && UNITS[nx] > 0) { out.push(String(TENS[x] + UNITS[nx])); i++; }
        else out.push(String(TENS[x]));
      } else if (x in TEENS) out.push(String(TEENS[x]));
      else if (x === 'oh' || x === 'o') out.push(out.length && /\d$/.test(out[out.length - 1]) ? '0' : x);
      else if (x in UNITS) out.push(String(UNITS[x]));
      else out.push(x);
    }
    let s = out.join(' ');
    s = s.replace(/(\d)\s+(?=\d)/g, '$1');                         // "4 3 0 2" → "4302"
    s = s.replace(/\b(purple|papa|green|golf|blue|bravo|yellow|yankee|red|romeo|p|g|b|y|r)\s*(\d{4})\b/g,
                  (m, z, d) => (ZONE_WORDS[z] || z) + d);           // "blue 4302" → "b4302"
    s = s.replace(/\bl\s*t\s*(\d{1,2})\b/g, 'lt$1');                // "l t 18" → "lt18"
    return s.trim();
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 99;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }

  function poiTypeFor(q) {
    for (const [t, syn] of Object.entries(CA.POI_SYNONYMS))
      if (syn.some(w => new RegExp(`\\b${w}\\b`).test(q))) return t;
    return null;
  }

  function sortByNearest(nodes, from) {
    if (!from) return nodes;
    return nodes.map(n => {
      const r = n.id === from ? { time: 0 } : CA.Router.route(from, n.id, 'fastest');
      return { n, t: r ? r.time : Infinity };
    }).sort((a, b) => a.t - b.t).map(o => o.n);
  }

  /* Returns { kind: single|multi|poi|none, items, suggestions } */
  function search(raw, { fromNode } = {}) {
    const q = normalizeSpoken(raw), k = norm(q);
    if (!k) return { kind: 'none', q: raw, items: [], suggestions: [] };
    const kindOf = arr => (arr.length > 1 ? 'multi' : 'single');

    const exact = places.filter(p => p._keys.includes(k));
    if (exact.length) return { kind: kindOf(exact), q: raw, items: exact };

    if (/^\d{4}$/.test(k)) {                       // bare room number → every zone
      const m = places.filter(p => p.code && norm(p.code).endsWith(k));
      if (m.length) return { kind: kindOf(m), q: raw, items: m };
    }
    const t = poiTypeFor(q);                       // facility type → nearest first
    if (t) {
      const m = CA.NODES.filter(n => n.poi === t);
      if (m.length) return { kind: 'poi', q: raw, poiType: t, items: sortByNearest(m, fromNode) };
    }
    if (k.length >= 3) {
      const m = places.filter(p => p._keys.some(x => x.includes(k)));
      if (m.length) return { kind: kindOf(m), q: raw, items: m };
    }
    const sug = k.length < 3 ? [] : places
      .map(p => ({ p, d: Math.min(...p._keys.filter(x => x.length >= 3).map(x => lev(x, k)), 99) }))
      .filter(o => o.d <= 2).sort((a, b) => a.d - b.d).slice(0, 3).map(o => o.p);
    return { kind: 'none', q: raw, items: [], suggestions: sug };
  }

  const MODE_WORDS = /\b(step free|avoid (the )?stairs|wheelchair|no stairs|accessible route|stay indoors|covered|avoid (the )?rain|indoor route|fastest|quickest|please)\b/g;

  function parse(raw) {
    const t = normalizeSpoken(raw);
    let m;
    if (/\b(help|emergency|sos)\b/.test(t)) return { intent: 'help' };
    if (/^(stop|cancel|end)( navigation| route)?$/.test(t) || /\bstop navigation\b/.test(t)) return { intent: 'stop' };
    if (/\b(repeat|say (that )?again|what s next|whats next)\b/.test(t)) return { intent: 'repeat' };
    if (/\bwhere am i\b/.test(t)) return { intent: 'where_am_i' };
    if (/\b(take me|go|navigate|bring me) (here|there)\b/.test(t)) return { intent: 'navigate_here' };
    let mode = null;
    if (/\b(step ?free|avoid (the )?stairs|wheelchair|no stairs|accessible route)\b/.test(t)) mode = 'stepfree';
    else if (/\b(stay indoors|covered|avoid (the )?rain|indoor route)\b/.test(t)) mode = 'covered';
    else if (/\b(fastest|quickest)\b/.test(t)) mode = 'fastest';
    if ((m = t.match(/\b(?:take me|navigate|directions|route|go|bring me|get me|walk me)(?: me)? to (?:the )?(.+)$/)))
      return { intent: 'navigate', query: m[1].replace(MODE_WORDS, '').trim(), mode };
    if (mode) return { intent: 'set_mode', mode };
    if (/^(go|yes|yeah|start|ok|okay|confirm|lets go|let s go)$/.test(t)) return { intent: 'confirm' };
    if (/^(no|nope|wrong)$/.test(t)) return { intent: 'deny' };
    if ((m = t.match(/^(?:the )?(purple|green|blue|yellow|red|first|second|third|fourth|1|2|3|4)(?: one| zone)?$/)))
      return { intent: 'choose', choice: m[1] };
    if ((m = t.match(/\b(?:where is|where s|wheres|find|search for|search|show me|show|locate|look for)\s+(?:the )?(.+)$/)))
      return { intent: 'find', query: m[1] };
    return { intent: 'find', query: t };
  }

  return { search, parse, normalizeSpoken };
})();