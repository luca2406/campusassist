/* ==========================================================
   CampusAssist – router.js
   Graph routing (Dijkstra) with three profiles:
   fastest | stepfree (no stairs/escalators, 0.8 m/s) | covered (penalise open-air)
   ========================================================== */
CA.Router = (() => {
  'use strict';
  const N = {};
  CA.NODES.forEach(n => { N[n.id] = n; });
  const FI = f => CA.FLOORS_ASC.indexOf(f);
  const adj = {};
  CA.NODES.forEach(n => { adj[n.id] = []; });

  CA.EDGES.forEach(e => {
    const a = N[e.a], b = N[e.b];
    if (!a || !b) { console.warn('Bad edge', e); return; }
    e.len = e.type === 'walk' ? Math.hypot(a.x - b.x, a.y - b.y) * CA.M_PER_UNIT : 0;
    e.floors = Math.abs(FI(a.floor) - FI(b.floor));
    adj[e.a].push({ to: e.b, e });
    adj[e.b].push({ to: e.a, e });
  });

  const speed = mode => (mode === 'stepfree' ? 0.8 : 1.3);

  function seconds(e, mode) {
    switch (e.type) {
      case 'walk': return e.len / speed(mode);
      case 'lift': return CA.LIFT_WAIT_S + 5 * e.floors;
      case 'escalator': return 15 * e.floors;
      case 'stairs': return 20 * e.floors;
      default: return 0;
    }
  }
  function allowed(e, mode) {
    if (e.maintenance) return false;
    if (mode === 'stepfree' && (e.type === 'stairs' || e.type === 'escalator')) return false;
    return true;
  }
  function cost(e, mode) {
    let s = seconds(e, mode);
    if (mode === 'covered' && !e.covered) s *= 4;
    return s;
  }

  function shortest(from, to, mode) {
    const dist = {}, prev = {}, prevE = {}, done = new Set();
    Object.keys(N).forEach(k => { dist[k] = Infinity; });
    dist[from] = 0;
    for (;;) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
      if (u === null || u === to) break;
      done.add(u);
      for (const { to: v, e } of adj[u]) {
        if (!allowed(e, mode)) continue;
        const nd = dist[u] + cost(e, mode);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevE[v] = e; }
      }
    }
    if (dist[to] === Infinity) return null;
    const path = [to], edges = [];
    let c = to;
    while (c !== from) { edges.unshift(prevE[c]); c = prev[c]; path.unshift(c); }
    return { path, edges };
  }

  const floorLabel = f => (f === 'G' ? 'G/F' : `${f}/F`);
  function placeLabel(n) {
    if (!n.code) return n.name;
    return n.zone ? `${n.code} (${CA.ZONES[n.zone].name})` : n.code;
  }

  function turnDir(a, b, c) {
    const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
    // SVG y-axis points down → positive cross product = right turn
    const ang = Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y) * 180 / Math.PI;
    if (ang > 35) return 'right';
    if (ang < -35) return 'left';
    return null;
  }

  function buildSteps(path, edges, stopSet) {
    const steps = [{ type: 'start', at: 0, dist: 0, floor: N[path[0]].floor, text: `Head towards ${N[path[1]].name}` }];
    let acc = 0;
    edges.forEach((e, i) => {
      const a = N[path[i]], b = N[path[i + 1]];
      if (e.type !== 'walk') {
        const dir = FI(b.floor) > FI(a.floor) ? 'up' : 'down';
        steps.push({ type: e.type, at: i, dist: acc, floor: a.floor, toFloor: b.floor, landmark: a.name, label: e.label,
                     text: `Take ${e.label} ${dir} to ${floorLabel(b.floor)}` });
        acc = 0; return;
      }
      acc += e.len;
      if (i === edges.length - 1) {
        steps.push({ type: 'arrive', at: i + 1, dist: acc, floor: b.floor, landmark: placeLabel(b), text: `Arrive at ${placeLabel(b)}` });
        return;
      }
      if (stopSet.has(i + 1)) {
        steps.push({ type: 'stop', at: i + 1, dist: acc, floor: b.floor, landmark: b.name, text: `Stop at ${placeLabel(b)}` });
        acc = 0; return;
      }
      if (edges[i + 1].type === 'walk') {
        const turn = turnDir(a, b, N[path[i + 2]]);
        if (turn) {
          steps.push({ type: turn, at: i + 1, dist: acc, floor: b.floor, landmark: b.name, text: `Turn ${turn} at ${b.name}` });
          acc = 0;
        }
      }
    });
    if (steps[steps.length - 1].type !== 'arrive') {
      const last = N[path[path.length - 1]];
      steps.push({ type: 'arrive', at: path.length - 1, dist: 0, floor: last.floor, landmark: placeLabel(last), text: `Arrive at ${placeLabel(last)}` });
    }
    return steps;
  }

  /* Route through an ordered list of points (start, …stops, destination) */
  function routeVia(points, mode) {
    points = points.filter(Boolean);
    if (points.length < 2) return null;
    let path = [points[0]], edges = [];
    const stops = [];
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i] === points[i + 1]) continue;
      const r = shortest(points[i], points[i + 1], mode);
      if (!r) return null;
      path = path.concat(r.path.slice(1));
      edges = edges.concat(r.edges);
      if (i < points.length - 2) stops.push({ id: points[i + 1], idx: path.length - 1 });
    }
    if (!edges.length) return null;
    const time = edges.reduce((s, e) => s + seconds(e, mode), 0);
    const distance = edges.reduce((s, e) => s + e.len, 0);
    const steps = buildSteps(path, edges, new Set(stops.map(s => s.idx)));
    const warnings = [];
    CA.EDGES.filter(e => e.maintenance).forEach(e => {
      const bld = N[e.a].bld;
      if (path.some(id => N[id].bld === bld)) warnings.push(`${e.label} is under maintenance. This route avoids it.`);
    });
    if (mode === 'covered' && edges.some(e => !e.covered)) warnings.push('Part of this route is not covered.');
    if (mode !== 'stepfree' && edges.some(e => e.type === 'stairs' || e.type === 'escalator'))
      warnings.push('Includes stairs or an escalator. Choose Step-Free to avoid them.');
    return { from: points[0], to: points[points.length - 1], mode, path, edges, time, distance, steps, warnings, stops, points };
  }

  function nearestNode(floor, x, y) {
    let best = null, bd = Infinity;
    CA.NODES.forEach(n => {
      if (n.floor !== floor) return;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n.id; }
    });
    return best;
  }

  return { N, FI, routeVia, route: (a, b, m) => routeVia([a, b], m), seconds, speed, nearestNode, floorLabel, placeLabel };
})();