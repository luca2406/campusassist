/* ==========================================================
   CampusAssist – data.js
   PROTOTYPE DATA. Geometry is SCHEMATIC (not to scale);
   room / lift / landmark positions are illustrative and must be
   verified against on-site CityU signage before the final demo.
   Coordinates: 1000 × 700 units, 1 unit = 0.5 m.
   ========================================================== */
window.CA = window.CA || {};

CA.CONFIG = {
  securityPhone: ''   // put the official Campus Security number here for a real build
};
CA.M_PER_UNIT = 0.5;
CA.LIFT_WAIT_S = 45;  // average wait at busy lift lobbies
CA.FLOORS_ASC = ['G', '1', '2', '3', '4', '5', '6', '7', '8'];
CA.FLOORS = CA.FLOORS_ASC.slice().reverse(); // selector order: top → bottom

/* Colour zones – colour + letter + pattern (WCAG 1.4.1) */
CA.ZONES = {
  P: { name: 'Purple Zone', color: '#6B3FA0', text: '#FFFFFF', pattern: 'patDiag' },
  G: { name: 'Green Zone',  color: '#1E7B3A', text: '#FFFFFF', pattern: 'patDots' },
  B: { name: 'Blue Zone',   color: '#1F5FBF', text: '#FFFFFF', pattern: null },
  Y: { name: 'Yellow Zone', color: '#F2C200', text: '#1A1A1A', pattern: 'patCross' },
  R: { name: 'Red Zone',    color: '#C62828', text: '#FFFFFF', pattern: 'patVert' }
};



CA.POI_TYPES = {
  cafe:     { icon: '☕', label: 'Café',          chip: true },
  canteen:  { icon: '🍴', label: 'Canteen',       chip: true },
  wc:       { icon: '🚻', label: 'Accessible WC', chip: true },
  lift:     { icon: '⇅',  label: 'Lift',          chip: true },
  firstaid: { icon: '➕', label: 'First aid',     chip: true },
  security: { icon: '🛡', label: 'Security',      chip: true },
  library:  { icon: '📚', label: 'Library',       chip: false },
  room:     { icon: '🚪', label: 'Room' },
  entrance: { icon: '🚇', label: 'Entrance' },
  landmark: { icon: '📍', label: 'Landmark' }
};

CA.POI_SYNONYMS = {
  wc:       ['toilet', 'toilets', 'wc', 'restroom', 'washroom', 'bathroom', 'loo'],
  cafe:     ['cafe', 'coffee'],
  canteen:  ['canteen', 'food', 'restaurant', 'eat', 'lunch', 'dinner'],
  lift:     ['lift', 'lifts', 'elevator', 'elevators'],
  firstaid: ['first aid', 'medical', 'clinic', 'nurse'],
  security: ['security', 'guard'],
  library:  ['library']
};

CA.FLOOR_NAMES = { G: 'Ground floor', 3: 'Podium · footbridge to Festival Walk', 4: 'University Concourse' };

/* ---------- Geometry (buildings rotated ~45° like the real campus) ----------
   A1(s, t) / A3(s, t) convert BUILDING-LOCAL coordinates into map units:
   s = along the long axis (− north-west end, + south-east end)
   t = across the building (− south-west side, + north-east side facing Tat Chee Avenue) */
(function () {
  const rot = (cx, cy, s, t) => ({ x: Math.round(cx + 0.7071 * (s + t)), y: Math.round(cy + 0.7071 * (s - t)) });
  const A1 = (s, t) => rot(400, 520, s, t);   // YEUNG (AC1)
  const A3 = (s, t) => rot(250, 110, s, t);   // LAU (AC3)
  const box = (f, s0, s1, t0, t1) => [f(s0, t1), f(s1, t1), f(s1, t0), f(s0, t0)].map(p => [p.x, p.y]);

  CA.BUILDINGS = [
    { id: 'AC1', name: 'YEUNG (AC1)', en: 'Yeung Kin Man Academic Building', zh: '香港城市大學楊建文學術樓',
      poly: box(A1, -200, 200, -120, 120), labelAt: A1(150, 40), labelPos: 'below', floors: 'all' },
    { id: 'AC3', name: 'LAU (AC3)', en: 'Lau Ming Wai Academic Building', zh: '香港城市大學劉鳴煒學術樓',
      poly: box(A3, -110, 110, -70, 70), labelAt: A3(-95, 40), labelPos: 'above', floors: 'all' }
  ];

  /* Colour zones along YEUNG (AC1), checked against the campus map:
     north-west end (next to LAU / AC3)  →  south-east end (towards To Yuen Street)
        R Red  →  Y Yellow  →  B Blue  →  G Green  →  P Purple                    */
  const ZONE_STRIPS = [
    { zone: 'R', s: -159 },   // 1 · north-west, next to LAU (AC3)
    { zone: 'Y', s:  -81 },   // 2
    { zone: 'B', s:   -3 },   // 3
    { zone: 'G', s:   75 },   // 4
    { zone: 'P', s:  153 }    // 5 · south-east end
  ];
  CA.ZONE_ORDER = ZONE_STRIPS.map(z => z.zone);
  CA.ZONE_AREAS = ZONE_STRIPS.map(({ zone, s }) => ({
    zone,
    poly: box(A1, s - 37, s + 37, -112, 112),
    at: A1(s, -98)
  }));
  const zoneS = z => ZONE_STRIPS.find(o => o.zone === z).s;

  CA.NODES = [
    // ---- 3/F (podium / footbridge level) ----
    { id: 'mtr', floor: '3', x: 984, y: 411, name: 'MTR Kowloon Tong Exit C2', zh: '港鐵九龍塘站 C2 出口', cat: 'entrance', search: true, outdoor: true, aliases: ['mtr', 'kowloon tong', 'exit c2', 'c2 exit'] },
    { id: 'bridge', floor: '3', x: 760, y: 380, name: '3M Pedestrian Bridge', zh: '行人天橋', cat: 'junction', outdoor: true },
    { id: 'fw', floor: '3', x: 700, y: 300, name: 'Festival Walk link', zh: '又一城連接橋', cat: 'junction' },
    { id: 'ac1e3', floor: '3', ...A1(60, 120), name: 'YEUNG 3/F entrance', zh: '楊建文學術樓入口', bld: 'AC1', cat: 'entrance', search: true, aliases: ['yeung entrance', 'ac1 entrance'] },
    { id: 'aid3', floor: '3', ...A1(40, 60), name: 'First-aid station', zh: '急救站', bld: 'AC1', cat: 'firstaid', poi: 'firstaid', search: true, hours: [[8, 22]], aliases: ['first aid station'] },
    { id: 'lift7_3', floor: '3', ...A1(-60, 40), name: 'Lift 7', zh: '7號升降機', bld: 'AC1', cat: 'lift', poi: 'lift', serves: 'G–8/F' },
    { id: 'stairs_3', floor: '3', ...A1(-30, 105), name: 'Staircase S2', zh: 'S2 樓梯', bld: 'AC1', cat: 'stairs' },
    { id: 'esc_3', floor: '3', ...A1(-90, -20), name: 'Escalator', zh: '扶手電梯', bld: 'AC1', cat: 'escalator' },
    { id: 'lib3', floor: '3', ...A1(-20, -40), name: 'Run Run Shaw Library', zh: '邵逸夫圖書館', bld: 'AC1', cat: 'library', poi: 'library', search: true, hours: [[8, 22]], quiet: true, aliases: ['library', 'library entrance', 'run run shaw library', 'lib'] },
    { id: 'lift3_3', floor: '3', ...A1(60, -50), name: 'Lift 3', zh: '3號升降機', bld: 'AC1', cat: 'lift', poi: 'lift', serves: '3–6/F' },
    { id: 'sec3', floor: '3', ...A1(130, -80), name: 'Security office', zh: '保安辦事處', bld: 'AC1', cat: 'security', poi: 'security', search: true, hours: [[0, 24]], aliases: ['campus security', 'security office'] },
    { id: 'lau_lift_3', floor: '3', ...A3(60, 10), name: 'LAU Lift A', zh: 'A 號升降機', bld: 'AC3', cat: 'lift', poi: 'lift', serves: 'G–8/F' },
    { id: 'lau_stairs_3', floor: '3', ...A3(20, -40), name: 'LAU Staircase', zh: '樓梯', bld: 'AC3', cat: 'stairs' },
    { id: 'lau3_corr', floor: '3', ...A3(10, 10), name: 'LAU 3/F corridor', bld: 'AC3', cat: 'junction' },
    { id: 'lau3101', floor: '3', ...A3(-60, 20), name: 'Classroom', code: 'LAU-3101', bld: 'AC3', cat: 'room', search: true, aliases: ['3101', 'lau 3101', 'li 3101'] },

    // ---- 4/F (University Concourse) ----
    { id: 'lift7_4', floor: '4', ...A1(-60, 40), name: 'Lift 7', zh: '7號升降機', bld: 'AC1', cat: 'lift', poi: 'lift', serves: 'G–8/F' },
    { id: 'stairs_4', floor: '4', ...A1(-30, 105), name: 'Staircase S2', zh: 'S2 樓梯', bld: 'AC1', cat: 'stairs' },
    { id: 'esc_4', floor: '4', ...A1(-90, -20), name: 'Escalator', zh: '扶手電梯', bld: 'AC1', cat: 'escalator' },
    { id: 'lift3_4', floor: '4', ...A1(60, -50), name: 'Lift 3', zh: '3號升降機', bld: 'AC1', cat: 'lift', poi: 'lift', serves: '3–6/F' },
    { id: 'conc4', floor: '4', ...A1(-110, 20), name: '4/F University Concourse', zh: '大學廣場', bld: 'AC1', cat: 'junction', search: true, aliases: ['concourse', 'university concourse'] },
    { id: 'gpC', floor: '4', ...A1(-30, 20), name: 'Gathering Point C', zh: '集合點 C', bld: 'AC1', cat: 'landmark', search: true, aliases: ['gathering point c', 'pillar c'] },
    { id: 'P4302', floor: '4', ...A1(zoneS('P'), 75), name: 'Classroom', code: 'YEUNG-P4302', zone: 'P', bld: 'AC1', cat: 'room', search: true },
    { id: 'G4302', floor: '4', ...A1(zoneS('G'), 75), name: 'Classroom', code: 'YEUNG-G4302', zone: 'G', bld: 'AC1', cat: 'room', search: true },
    { id: 'B4302', floor: '4', ...A1(zoneS('B'), 75), name: 'Classroom', code: 'YEUNG-B4302', zone: 'B', bld: 'AC1', cat: 'room', search: true },
    { id: 'blueJ', floor: '4', ...A1(30, 20), name: 'Blue / Green Zone corridor', bld: 'AC1', cat: 'junction' },
    { id: 'Y4302', floor: '4', ...A1(zoneS('Y'), 75), name: 'Classroom', code: 'YEUNG-Y4302', zone: 'Y', bld: 'AC1', cat: 'room', search: true },
    { id: 'lt18', floor: '4', ...A1(-20, -75), name: 'Lecture Theatre 18', zh: '演講廳18', code: 'LT-18', bld: 'AC1', cat: 'room', search: true, aliases: ['lt18', 'lt 18', 'lecture theatre 18', 'lecture theater 18'] },
    { id: 'wc4', floor: '4', ...A1(-90, -50), name: 'Accessible toilet', zh: '暢通易達洗手間', bld: 'AC1', cat: 'wc', poi: 'wc', search: true, hours: [[0, 24]] },
    { id: 'cafe4', floor: '4', ...A1(110, -20), name: 'Café', zh: '咖啡店', bld: 'AC1', cat: 'cafe', poi: 'cafe', search: true, hours: [[8, 20]] },
    { id: 'canteen4', floor: '4', ...A1(60, -70), name: 'Canteen', zh: '食堂', bld: 'AC1', cat: 'canteen', poi: 'canteen', search: true, hours: [[7.5, 21]] },
    { id: 'bridge4', floor: '4', ...A1(-225, 100), name: 'Footbridge to LAU', zh: '往劉鳴煒學術樓天橋', cat: 'junction' },
    { id: 'lau_lift_4', floor: '4', ...A3(60, 10), name: 'LAU Lift A', zh: 'A 號升降機', bld: 'AC3', cat: 'lift', poi: 'lift', serves: 'G–8/F' },
    { id: 'lau_stairs_4', floor: '4', ...A3(20, -40), name: 'LAU Staircase', zh: '樓梯', bld: 'AC3', cat: 'stairs' }
  ];

  /* Chinese names also become search aliases → "邵逸夫圖書館" works in search & voice */
  CA.NODES.forEach(n => { if (n.zh) (n.aliases = n.aliases || []).push(n.zh); });
})();

/* ---------- Edges ---------- */
(function () {
  const W = (a, b, o = {}) => Object.assign({ a, b, type: 'walk', covered: true }, o);
  const V = (a, b, type, o = {}) => Object.assign({ a, b, type, covered: true }, o);
  CA.EDGES = [
    // 3/F
    W('mtr', 'bridge', { covered: false }), W('bridge', 'ac1e3', { covered: false }),
    W('mtr', 'fw'), W('fw', 'ac1e3'),
    W('ac1e3', 'aid3'), W('aid3', 'lift7_3'), W('ac1e3', 'stairs_3'), W('stairs_3', 'lift7_3'),
    W('ac1e3', 'lib3'), W('aid3', 'lib3'), W('lib3', 'esc_3'), W('lift7_3', 'esc_3'),
    W('lib3', 'lift3_3'), W('esc_3', 'lift3_3'), W('lift3_3', 'sec3'),
    W('lau_lift_3', 'lau3_corr'), W('lau_stairs_3', 'lau3_corr'), W('lau3_corr', 'lau3101'),
// 4/F  (zones NW → SE: R, Y, B, G, P)
    W('lift7_4', 'conc4'), W('esc_4', 'conc4'), W('stairs_4', 'conc4'), W('lift3_4', 'esc_4'),
    W('conc4', 'Y4302'),                         // Yellow: next to the Concourse
    W('conc4', 'gpC'), W('gpC', 'B4302'),        // Blue: by Gathering Point C
    W('gpC', 'blueJ'), W('blueJ', 'G4302'),      // Green: past the Blue/Green corridor
    W('G4302', 'P4302'),                         // Purple: far south-east end
    W('G4302', 'cafe4'), W('cafe4', 'canteen4'),
    W('canteen4', 'lt18'), W('lt18', 'esc_4'), W('lift7_4', 'wc4'), W('wc4', 'lt18'), W('lift3_4', 'canteen4'),
    W('conc4', 'bridge4'), W('bridge4', 'lau_lift_4'), W('lau_lift_4', 'lau_stairs_4'),
    // Vertical connectors
    V('lift7_3', 'lift7_4', 'lift', { label: 'Lift 7' }),
    V('esc_3', 'esc_4', 'escalator', { label: 'the escalator' }),
    V('stairs_3', 'stairs_4', 'stairs', { label: 'Staircase S2' }),
    V('lift3_3', 'lift3_4', 'lift', { label: 'Lift 3', maintenance: true }),
    V('lau_lift_3', 'lau_lift_4', 'lift', { label: 'LAU Lift A' }),
    V('lau_stairs_3', 'lau_stairs_4', 'stairs', { label: 'LAU Staircase' })
  ];
})();

/* ---------- Edges ---------- */
(function () {
  const W = (a, b, o = {}) => Object.assign({ a, b, type: 'walk', covered: true }, o);
  const V = (a, b, type, o = {}) => Object.assign({ a, b, type, covered: true }, o);
  CA.EDGES = [
    // 3/F
    W('mtr', 'bridge', { covered: false }), W('bridge', 'ac1e3', { covered: false }),
    W('mtr', 'fw'), W('fw', 'ac1e3'),
    W('ac1e3', 'aid3'), W('aid3', 'lift7_3'), W('ac1e3', 'stairs_3'), W('stairs_3', 'lift7_3'),
    W('ac1e3', 'lib3'), W('aid3', 'lib3'), W('lib3', 'esc_3'), W('lift7_3', 'esc_3'),
    W('lib3', 'lift3_3'), W('esc_3', 'lift3_3'), W('lift3_3', 'sec3'),
    W('lau_lift_3', 'lau3_corr'), W('lau_stairs_3', 'lau3_corr'), W('lau3_corr', 'lau3101'),
    // 4/F
    W('lift7_4', 'conc4'), W('esc_4', 'conc4'), W('stairs_4', 'conc4'), W('lift3_4', 'esc_4'),
    W('conc4', 'P4302'), W('conc4', 'G4302'), W('conc4', 'gpC'), W('gpC', 'blueJ'),
    W('blueJ', 'B4302'), W('blueJ', 'Y4302'), W('Y4302', 'cafe4'), W('cafe4', 'canteen4'),
    W('canteen4', 'lt18'), W('lt18', 'esc_4'), W('lift7_4', 'wc4'), W('wc4', 'lt18'), W('lift3_4', 'canteen4'),
    W('blueJ', 'bridge4'), W('bridge4', 'lau_lift_4'), W('lau_lift_4', 'lau_stairs_4'),
    // Vertical connectors
    V('lift7_3', 'lift7_4', 'lift', { label: 'Lift 7' }),
    V('esc_3', 'esc_4', 'escalator', { label: 'the escalator' }),
    V('stairs_3', 'stairs_4', 'stairs', { label: 'Staircase S2' }),
    V('lift3_3', 'lift3_4', 'lift', { label: 'Lift 3', maintenance: true }),
    V('lau_lift_3', 'lau_lift_4', 'lift', { label: 'LAU Lift A' }),
    V('lau_stairs_3', 'lau_stairs_4', 'stairs', { label: 'LAU Staircase' })
  ];
})();

CA.TIMETABLE = [
  { node: 'B4302', course: 'CS3483 Multimodal Interface Design', dayName: 'Mon', time: '15:00' }
];

/* ---------- i18n (static UI labels; dynamic guidance is EN in this prototype) ---------- */
CA.I18N = {
  en: {
    skip: 'Skip to controls', tabMap: 'Map', tabSaved: 'Saved', tabProfile: 'Profile',
    emergency: 'EMERGENCY ASSIST', searchPh: 'Search room, LT, facility', recent: 'Recent',
    fastest: 'Fastest', stepfree: 'Step-Free', covered: 'Covered', start: 'START',
    directions: 'Directions', save: 'Save', saved: 'Saved', end: 'End', steps: 'Steps', go: 'Go',
    favourites: 'Favourites', timetable: 'Timetable', profileTitle: 'Profile & accessibility',
    savedTitle: 'Saved places', holdHint: 'Press and hold for 1.5 s to open Emergency Assist'
  },
  zh: {
    skip: '跳到控制項', tabMap: '地圖', tabSaved: '已儲存', tabProfile: '個人設定',
    emergency: '緊急求助', searchPh: '搜尋課室、演講廳、設施', recent: '最近',
    fastest: '最快', stepfree: '無障礙', covered: '有蓋', start: '開始',
    directions: '路線', save: '儲存', saved: '已儲存', end: '結束', steps: '步驟', go: '前往',
    favourites: '我的最愛', timetable: '時間表', profileTitle: '個人及無障礙設定',
    savedTitle: '已儲存地點', holdHint: '按住 1.5 秒以開啟緊急求助'
  }
};