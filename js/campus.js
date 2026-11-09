/* =====================================================================
   CampusAssist · campus.js  (Part 1 of 2)
   Campus data model + graph builder + routing engine + fuzzy search + i18n
   ⚠ Coordinates, room codes and lift details are ILLUSTRATIVE.
     Verify against the real CityU layout before presenting.
   Map units ≈ metres. SVG coordinates: x → east, y → south.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 1. FLOORS ---------------- */
  const FLOORS = ['G', '1', '2', '3', '4', '5', '6'];
  const floorIndex = (f) => FLOORS.indexOf(f);
  const floorLabel = (f) => (f === 'G' ? 'G/F' : f + '/F');

  /* ---------------- 2. BUILDINGS (OAI: task objects) ---------------- */
  const BUILDINGS = {
    AC1: { id: 'AC1', code: 'YEUNG', name: 'Yeung Kin Man Academic Building (AC1)', short: 'AC1', zh: '楊建文學術樓',
           floors: FLOORS, poly: [[90, 200], [310, 200], [310, 380], [90, 380]], label: [200, 396] },
    AC2: { id: 'AC2', code: 'AC2', name: 'Academic 2 (AC2)', short: 'AC2', zh: '學術樓二',
           floors: ['G', '1', '2', '3', '4', '5'], poly: [[40, 90], [150, 90], [150, 180], [40, 180]], label: [95, 82] },
    AC3: { id: 'AC3', code: 'LAU', name: 'Lau Ming Wai Academic Building (AC3)', short: 'AC3', zh: '劉鳴煒學術樓',
           floors: FLOORS, poly: [[220, 40], [375, 40], [375, 170], [220, 170]], label: [297, 32] },
    FW:  { id: 'FW', code: 'MTR', name: 'MTR Kowloon Tong / Festival Walk', short: 'MTR', zh: '港鐵九龍塘站',
           floors: ['G', '3'], poly: [[300, 478], [395, 478], [395, 550], [300, 550]], label: [348, 538] }
  };

  /* AC1 colour-coded sectors (Recognition rather than recall) */
  const ZONES = [
    { id: 'Y', name: 'Yellow Zone', zh: '黃區', zhs: '黄区', poly: [[90, 200], [200, 200], [200, 290], [90, 290]], chip: [104, 214] },
    { id: 'B', name: 'Blue Zone',   zh: '藍區', zhs: '蓝区', poly: [[200, 200], [310, 200], [310, 290], [200, 290]], chip: [296, 214] },
    { id: 'G', name: 'Green Zone',  zh: '綠區', zhs: '绿区', poly: [[90, 290], [200, 290], [200, 380], [90, 380]], chip: [104, 366] },
    { id: 'P', name: 'Purple Zone', zh: '紫區', zhs: '紫区', poly: [[200, 290], [310, 290], [310, 380], [200, 380]], chip: [296, 366] }
  ];

  /* ---------------- 3. INDOOR CORRIDOR TEMPLATES (repeated per floor) ---------------- */
  const CORRIDORS = {
    AC1: {
      points: [
        { k: 'C', x: 200, y: 290, name: 'the central atrium' },
        { k: 'N', x: 200, y: 215, name: 'the north lift lobby' },
        { k: 'S', x: 200, y: 365, name: 'the south lobby' },
        { k: 'E', x: 295, y: 290, name: 'the east entrance' },
        { k: 'W', x: 110, y: 290, name: 'the west corridor' }
      ],
      links: [['W', 'C'], ['C', 'E'], ['C', 'N'], ['C', 'S']]
    },
    AC2: {
      points: [
        { k: 'C', x: 95, y: 135, name: 'the AC2 lobby' },
        { k: 'S', x: 95, y: 172, name: 'the AC2 south door' }
      ],
      links: [['C', 'S']]
    },
    AC3: {
      points: [
        { k: 'W', x: 235, y: 105, name: 'the AC3 west wing' },
        { k: 'C', x: 295, y: 105, name: 'the AC3 lift lobby' },
        { k: 'E', x: 358, y: 105, name: 'the AC3 east wing' },
        { k: 'S', x: 295, y: 160, name: 'the AC3 south entrance' }
      ],
      links: [['W', 'C'], ['C', 'E'], ['C', 'S']]
    }
  };

  /* ---------------- 4. OUTDOOR NODES & LINKS ---------------- */
  const OUTDOOR_NODES = [
    { id: 'MTR-C2', x: 352, y: 510, f: 'G', b: 'FW',  label: 'MTR Exit C2' },
    { id: 'BR-1',   x: 350, y: 466, f: '3', b: 'OUT', label: 'the bridge landing' },
    { id: 'BR-2',   x: 322, y: 330, f: '3', b: 'OUT', label: 'the end of the pedestrian bridge' },
    { id: 'PLZ',    x: 200, y: 432, f: 'G', b: 'OUT', label: 'the open plaza' },
    { id: 'PATH-N', x: 200, y: 188, f: 'G', b: 'OUT', label: 'the north walkway' }
  ];

  /* kind: walk | ramp | stairs (floors:0 = outdoor steps) ; door: auto | manual */
  const LINKS = [
    { a: 'MTR-C2', b: 'PLZ',     covered: false, label: 'open-air walkway to the plaza', labelRev: 'open-air walkway to MTR Exit C2' },
    { a: 'PLZ',    b: 'AC1-G-S', kind: 'ramp', covered: false, door: 'auto', label: 'ramp up to the AC1 south entrance', labelRev: 'ramp down to the plaza' },
    { a: 'MTR-C2', b: 'AC1-G-E', kind: 'stairs', floors: 0, covered: false, label: 'outdoor steps to the AC1 east door', labelRev: 'outdoor steps down to MTR Exit C2' },
    { a: 'AC1-G-N', b: 'PATH-N', covered: false, door: 'auto', label: 'AC1 north doors to the walkway', labelRev: 'AC1 north doors' },
    { a: 'PATH-N', b: 'AC2-G-S', covered: false },
    { a: 'PATH-N', b: 'AC3-G-S', covered: false },
    { a: 'BR-1',   b: 'BR-2',    covered: true, label: 'pedestrian bridge (3M) towards AC1', labelRev: 'pedestrian bridge (3M) towards the MTR' },
    { a: 'BR-2',   b: 'AC1-3-E', covered: true, door: 'auto', label: 'AC1 east entrance (automatic doors)', labelRev: 'AC1 east exit to the bridge' },
    { a: 'AC1-3-W', b: 'AC2-3-S', covered: true, door: 'manual', label: 'covered link bridge to AC2 (heavy door)', labelRev: 'covered link bridge to AC1 (heavy door)' },
    { a: 'AC1-3-N', b: 'AC3-3-S', covered: true, door: 'auto', label: 'covered link bridge to AC3', labelRev: 'covered link bridge to AC1' }
  ];

  /* ---------------- 5. VERTICAL CONNECTORS ---------------- */
  const ALL = FLOORS;
  const VERTICALS = [
    { id: 'AC1-LA',  type: 'lift',      name: 'Lift A',        building: 'AC1', x: 185, y: 272, attach: 'C', floors: ALL },
    { id: 'AC1-LB',  type: 'lift',      name: 'Lift Bank B',   building: 'AC1', x: 222, y: 228, attach: 'N', floors: ['G', '3', '4', '5', '6'], note: 'Does not stop at 1/F or 2/F' },
    { id: 'AC1-LC',  type: 'lift',      name: 'Lift C',        building: 'AC1', x: 284, y: 352, attach: 'E', floors: ALL, closed: true, note: 'Out of service (maintenance)' },
    { id: 'AC1-ST1', type: 'stairs',    name: 'Staircase 1',   building: 'AC1', x: 118, y: 308, attach: 'W', floors: ALL },
    { id: 'AC1-ES',  type: 'escalator', name: 'the escalators', building: 'AC1', x: 216, y: 352, attach: 'S', floors: ['G', '1', '2', '3'] },
    { id: 'AC2-L',   type: 'lift',      name: 'AC2 Lift',      building: 'AC2', x: 122, y: 118, attach: 'C', floors: BUILDINGS.AC2.floors },
    { id: 'AC2-ST',  type: 'stairs',    name: 'AC2 Staircase', building: 'AC2', x: 60,  y: 152, attach: 'C', floors: BUILDINGS.AC2.floors },
    { id: 'AC3-L',   type: 'lift',      name: 'AC3 Lifts',     building: 'AC3', x: 312, y: 88,  attach: 'C', floors: ALL },
    { id: 'AC3-ST',  type: 'stairs',    name: 'AC3 Staircase', building: 'AC3', x: 240, y: 150, attach: 'W', floors: ALL },
    { id: 'FW-L',    type: 'lift',      name: 'the bridge lift',   building: 'FW', x: 378, y: 492, attach: { G: 'MTR-C2', 3: 'BR-1' }, floors: ['G', '3'] },
    { id: 'FW-ST',   type: 'stairs',    name: 'the bridge stairs', building: 'FW', x: 326, y: 494, attach: { G: 'MTR-C2', 3: 'BR-1' }, floors: ['G', '3'] }
  ];
  const VERTICAL_BY_ID = Object.fromEntries(VERTICALS.map((v) => [v.id, v]));

  /* ---------------- 6. PLACES (searchable destinations) ---------------- */
  const PLACES = [
    { id: 'lt18', name: 'LT-18', cat: 'lecture', b: 'AC1', f: '4', x: 140, y: 236, attach: 'W',
      aliases: ['lt18', 'lecture theatre 18', 'lecture theater 18'], zh: '演講廳18', zhs: '演讲厅18',
      hours: ['08:00', '22:00'], access: ['4 wheelchair spaces', 'Hearing loop'], photo: 'Double wooden doors beside the yellow feature wall.' },
    { id: 'lt8', name: 'LT-8', cat: 'lecture', b: 'AC1', f: '3', x: 240, y: 330, attach: 'S',
      aliases: ['lt8', 'lecture theatre 8'], zh: '演講廳8', zhs: '演讲厅8',
      hours: ['08:00', '22:00'], access: ['Wheelchair spaces', 'Step-free entrance'], photo: 'Glass doors facing the purple wall, opposite the escalators.' },
    { id: 'b4302', name: 'YEUNG-B4302', cat: 'classroom', b: 'AC1', f: '4', x: 265, y: 236, attach: 'E',
      aliases: ['b4302', '4302', 'yeung b4302', 'ac1 4302'], hours: ['08:00', '22:00'], access: ['Step-free'], photo: 'Blue door with the room number in braille.' },
    { id: 'p3101', name: 'YEUNG-P3101', cat: 'classroom', b: 'AC1', f: '3', x: 286, y: 316, attach: 'E',
      aliases: ['p3101', '3101', 'yeung p3101'], hours: ['08:00', '22:00'], access: ['Step-free'], photo: 'First door on the right after the purple sign.' },
    { id: 'lau3101', name: 'LAU-3101', cat: 'classroom', b: 'AC3', f: '3', x: 345, y: 128, attach: 'E',
      aliases: ['lau3101', '3101', 'ac3 3101'], hours: ['08:00', '22:00'], access: ['Step-free', 'Automatic door'], photo: 'Room at the end of the AC3 east wing, next to the water fountain.' },
    { id: 'lau5201', name: 'LAU-5201 Computer Lab', cat: 'lab', b: 'AC3', f: '5', x: 250, y: 72, attach: 'W',
      aliases: ['lau5201', '5201', 'computer lab', 'lab'], zh: '電腦實驗室', zhs: '电脑实验室',
      hours: ['09:00', '21:00'], access: ['Height-adjustable desks'], photo: 'Grey door with a card reader, opposite the AC3 staircase.' },
    { id: 'library', name: 'Run Run Shaw Library', cat: 'library', b: 'AC1', f: '3', x: 140, y: 336, attach: 'W', quiet: true,
      aliases: ['library', 'lib', 'run run shaw', 'rrs library'], zh: '邵逸夫圖書館', zhs: '邵逸夫图书馆',
      hours: ['08:00', '22:00'], access: ['Step-free entrance', 'Accessible study room', 'Screen-reader PCs'], photo: 'Turnstiles behind the green glass wall.' },
    { id: 'cafe4', name: 'Café (AC1 4/F)', cat: 'cafe', b: 'AC1', f: '4', x: 256, y: 334, attach: 'S',
      aliases: ['cafe', 'coffee', 'café'], zh: '咖啡店', zhs: '咖啡店', hours: ['08:00', '20:00'], access: ['Step-free', 'Low counter'], photo: 'Coffee counter with purple seating.' },
    { id: 'canteen1', name: 'AC1 Canteen', cat: 'canteen', b: 'AC1', f: 'G', x: 150, y: 352, attach: 'W',
      aliases: ['canteen', 'ac1 canteen'], zh: 'AC1 飯堂', zhs: 'AC1 饭堂', hours: ['07:30', '21:00'], access: ['Step-free', 'Accessible tables'], photo: 'Large hall with green tables beside the south lobby.' },
    { id: 'canteen2', name: 'AC2 Canteen', cat: 'canteen', b: 'AC2', f: 'G', x: 70, y: 112, attach: 'C',
      aliases: ['ac2 canteen'], zh: 'AC2 飯堂', zhs: 'AC2 饭堂', hours: ['11:00', '20:00'], access: ['Step-free'], photo: 'Canteen just inside the AC2 entrance.' },
    { id: 'canteen3', name: 'AC3 Canteen', cat: 'canteen', b: 'AC3', f: '1', x: 350, y: 72, attach: 'E',
      aliases: ['ac3 canteen'], zh: 'AC3 飯堂', zhs: 'AC3 饭堂', hours: ['08:00', '21:00'], access: ['Step-free'], photo: 'Glass-walled canteen in the AC3 east wing.' },
    { id: 'firstaid', name: 'First Aid Room', cat: 'firstaid', b: 'AC1', f: 'G', x: 252, y: 250, attach: 'N',
      aliases: ['first aid', 'aid', 'medical'], zh: '急救室', zhs: '急救室', hours: '24h', access: ['Step-free', 'Wheelchair available'], photo: 'White door with a green cross, next to Lift Bank B.' },
    { id: 'health', name: 'Student Health Centre', cat: 'firstaid', b: 'AC2', f: '1', x: 122, y: 160, attach: 'C',
      aliases: ['health centre', 'clinic', 'doctor', 'medical centre'], zh: '學生健康中心', zhs: '学生健康中心', hours: ['09:00', '17:30'], access: ['Step-free'], photo: 'Reception desk on the left after the AC2 lift.' },
    { id: 'security', name: 'Security Control Centre', cat: 'security', b: 'AC1', f: 'G', x: 282, y: 322, attach: 'E',
      aliases: ['security', 'guard', 'lost and found'], zh: '保安控制中心', zhs: '保安控制中心', hours: '24h', access: ['Step-free'], photo: 'Counter with CCTV screens near the AC1 east door.' },
    { id: 'wc-ac1-3', name: 'Accessible Toilet (AC1 3/F)', cat: 'toilet', b: 'AC1', f: '3', x: 188, y: 308, attach: 'C',
      aliases: [], hours: '24h', access: ['Wheelchair accessible', 'Emergency call bell', 'Baby change'], photo: 'Sliding door to the right of Lift A.' },
    { id: 'wc-ac1-4', name: 'Accessible Toilet (AC1 4/F)', cat: 'toilet', b: 'AC1', f: '4', x: 212, y: 308, attach: 'C',
      aliases: [], hours: '24h', access: ['Wheelchair accessible', 'Emergency call bell'], photo: 'Sliding door to the right of Lift A.' },
    { id: 'wc-ac3-3', name: 'Toilets (AC3 3/F)', cat: 'toilet', b: 'AC3', f: '3', x: 280, y: 148, attach: 'S',
      aliases: [], hours: '24h', access: ['Wheelchair accessible'], photo: 'Beside the AC3 south entrance.' },
    { id: 'gso', name: 'Global Services Office', cat: 'office', b: 'AC1', f: '2', x: 252, y: 232, attach: 'N',
      aliases: ['gso', 'exchange office', 'global services', 'international office'], zh: '環球事務處', zhs: '环球事务处',
      hours: ['09:00', '17:30'], access: ['Step-free', 'Low counter'], photo: 'Open office with world-map wall graphic.' },
    { id: 'mtr', name: 'MTR Kowloon Tong · Exit C2', cat: 'transport', b: 'FW', f: 'G', x: 352, y: 510, node: 'MTR-C2',
      aliases: ['mtr', 'kowloon tong', 'station', 'exit c2', 'festival walk'], zh: '九龍塘站 C2 出口', zhs: '九龙塘站 C2 出口',
      hours: ['05:30', '01:00'], access: ['Lift to bridge level'], photo: 'Exit C2 sign beside the bridge lift.' }
  ];
  const PLACE_BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));

  const CATEGORIES = {
    lecture:   { icon: '🎓', en: 'Lecture theatre', zh: '演講廳', zhs: '演讲厅' },
    classroom: { icon: '🏫', en: 'Classroom', zh: '課室', zhs: '课室' },
    lab:       { icon: '💻', en: 'Laboratory', zh: '實驗室', zhs: '实验室' },
    library:   { icon: '📚', en: 'Library', zh: '圖書館', zhs: '图书馆' },
    cafe:      { icon: '☕', en: 'Café', zh: '咖啡店', zhs: '咖啡店' },
    canteen:   { icon: '🍴', en: 'Canteen', zh: '飯堂', zhs: '饭堂' },
    toilet:    { icon: '🚻', en: 'Toilet', zh: '洗手間', zhs: '洗手间' },
    firstaid:  { icon: '✚', en: 'First aid / health', zh: '急救／醫療', zhs: '急救／医疗' },
    security:  { icon: '🛡', en: 'Security', zh: '保安', zhs: '保安' },
    office:    { icon: '🏢', en: 'Office', zh: '辦事處', zhs: '办事处' },
    transport: { icon: '🚇', en: 'Transport', zh: '交通', zhs: '交通' },
    lift:      { icon: '🛗', en: 'Lift', zh: '升降機', zhs: '电梯' },
    stairs:    { icon: '🪜', en: 'Stairs', zh: '樓梯', zhs: '楼梯' },
    escalator: { icon: '↗', en: 'Escalator', zh: '扶手電梯', zhs: '扶梯' }
  };
  const QUICK_GROUPS = {
    rooms: ['lecture', 'classroom', 'lab'], food: ['cafe', 'canteen'], toilets: ['toilet'],
    lifts: ['lift'], firstaid: ['firstaid', 'security']
  };
  const CATEGORY_WORDS = {
    toilet: ['toilet', 'toilets', 'washroom', 'restroom', 'wc', 'bathroom', '洗手間', '廁所', '厕所', '卫生间'],
    canteen: ['canteen', 'food', 'eat', 'lunch', 'dinner', 'restaurant', '飯堂', '饭堂', '餐廳', '餐厅', '食飯'],
    cafe: ['cafe', 'café', 'coffee', 'drink', '咖啡'],
    firstaid: ['first aid', 'medical', 'clinic', 'doctor', 'health', 'nurse', '急救', '醫療', '医疗'],
    security: ['security', 'guard', 'help desk', '保安'],
    library: ['library', 'study', '圖書館', '图书馆'],
    lecture: ['lecture', 'lecture theatre', '演講廳', '演讲厅'],
    lab: ['lab', 'laboratory', 'computer', '實驗室', '实验室'],
    office: ['office', '辦公室', '办公室'],
    transport: ['mtr', 'train', 'station', '港鐵', '港铁', '地鐵', '地铁']
  };

  /* Library = quiet zone → auto haptic-only output */
  const QUIET_ZONES = [
    { id: 'lib', b: 'AC1', f: '3', name: 'Run Run Shaw Library', poly: [[90, 290], [200, 290], [200, 380], [90, 380]] }
  ];

  /* ---------------- 7. TIMING & MODALITY CONSTANTS ---------------- */
  const TIMING = {
    speed: { walking: 1.3, stepfree: 1.0, luggage: 1.1 },   // m/s
    liftWait: 25, liftPerFloor: 4, stairsPerFloor: 15, escalatorPerFloor: 12,
    manualDoorPenalty: 30, uncoveredFactor: 4, uncoveredPenalty: 45,
    offRouteThreshold: 15                                   // metres
  };

  /* Haptic grammar from the design report: 1 = straight, 2 = left, 3 = right, rumble = off-route */
  const HAPTICS = {
    straight: [120], left: [120, 90, 120], right: [120, 90, 120, 90, 120],
    level: [250, 120, 250], offroute: [600], arrive: [900], confirm: [40], warn: [80, 60, 80]
  };
  const HAPTIC_LABEL = { straight: '●', left: '● ●', right: '● ● ●', level: '▬ ▬', offroute: '▬▬▬', arrive: '▬▬▬▬', confirm: '·', warn: '● ●' };

  /* Earcons (Web Audio): pitch encodes meaning (high = turn, low = warning) */
  const EARCONS = {
    turn:        { freqs: [880, 1175], dur: 0.12, type: 'sine' },
    level:       { freqs: [660, 880, 660], dur: 0.12, type: 'triangle' },
    offroute:    { freqs: [330, 247], dur: 0.26, type: 'square' },
    arrive:      { freqs: [523, 659, 784, 1047], dur: 0.14, type: 'sine' },
    listenStart: { freqs: [660, 990], dur: 0.08, type: 'sine' },
    listenStop:  { freqs: [990, 660], dur: 0.08, type: 'sine' },
    confirm:     { freqs: [784], dur: 0.08, type: 'sine' },
    error:       { freqs: [220], dur: 0.3, type: 'sawtooth' }
  };

  const STEP_ICONS = {
    depart: '📍', straight: '⬆', left: '↰', right: '↱', up: '⏫', down: '⏬', arrive: '🏁',
    via: '⬆', ramp: '♿', stairs: '🪜', bridge: '🌉', door: '🚪'
  };
  const STEP_FEEDBACK = {   // which haptic/earcon each step kind triggers
    depart: ['confirm', 'confirm'], straight: ['straight', 'turn'], via: ['straight', 'turn'],
    left: ['left', 'turn'], right: ['right', 'turn'], up: ['level', 'level'], down: ['level', 'level'],
    arrive: ['arrive', 'arrive']
  };

  /* ---------------- 8. I18N ---------------- */
  const I18N = {
    en: {
      skipToSearch: 'Skip to search', searchPlaceholder: 'Search room or place', holdToSpeak: 'Hold to speak',
      whereTo: 'Where to?', quickRooms: 'Rooms', quickFood: 'Food', quickToilets: 'Toilets', quickLifts: 'Lifts', quickFirstAid: 'First aid',
      savedRecent: 'Saved & recent', exploreCampus: 'Explore campus & facilities', emergency: 'Emergency Assist', legend: 'Map legend',
      routeTo: 'Route to', fastest: 'Fastest', stepfree: 'Step-free', covered: 'Covered', floorSteps: 'Floor-by-floor steps',
      addStop: 'Add stop', saveRoute: 'Save route', start: 'Start', mapView: 'Map', arView: 'AR',
      repeat: 'Repeat', pause: 'Pause', resume: 'Resume', end: 'End',
      demoTitle: 'Demo simulator (no indoor positioning in browser)', demoWalk: 'Auto-walk', demoStep: 'Next step', demoOffRoute: 'Simulate wrong turn',
      explore: 'Explore', navigate: 'Navigate', moreInfo: 'More info', openNow: 'Open now', closedNow: 'Closed now', allBuildings: 'All buildings',
      arrivedTitle: 'You have arrived', saveShortcut: 'Save shortcut', navigateBack: 'Navigate back', done: 'Done', rateRoute: 'Was this route helpful?',
      listening: 'Listening…', typeInstead: 'Type instead', cancel: 'Cancel', back: 'Back', continue: 'Continue', skip: 'Skip',
      settings: 'Settings', recalculating: 'Off route – recalculating…', quietOn: 'Quiet zone – voice muted, vibration on',
      youAreHere: 'You are here', next: 'Next',
      obTitle: 'Welcome to CampusAssist', obLead: 'Three quick questions so we can suggest the right routes. You can change these any time in Settings.',
      obLang: '1. Choose language', obMove: '2. How do you usually move around?', obGuide: '3. How should we guide you?',
      mobWalking: 'Walking', mobWalkingHint: 'Fastest routes, stairs allowed', mobStepfree: 'Wheelchair / step-free',
      mobStepfreeHint: 'Ramps, lifts and automatic doors only', mobLuggage: 'With luggage or trolley', mobLuggageHint: 'Avoid stairs and escalators',
      prefVoice: 'Spoken directions', prefHaptic: 'Vibration cues', prefLarge: 'Large text', prefContrast: 'High contrast',
      emTitle: 'Emergency Assist', emCall: 'Hold 3 s to call Campus Security', emFirstAid: 'Nearest first aid', emShare: 'Share my location', emHelp: 'I need physical help',
      noResults: 'No matches. Try a room code like "LT-18" or browse below.', browse: 'Browse by category', recentSearches: 'Recent searches',
      chooseDest: 'Choose destination', chooseOrigin: "I'm at…", chooseStop: 'Add a stop',
      stepDepart: 'Start at {from}.', stepWalk: 'Continue {dist} m to {landmark}.', stepTurn: 'In {dist} m, turn {dir} at {landmark}.',
      stepLevel: 'Take {name} {dir} to {floor}.', stepVia: '{label} ({dist} m).', stepArrive: 'In {dist} m, arrive at {place}.',
      left: 'left', right: 'right', up: 'up', down: 'down',
      warnClosed: '{name} is out of service – this route avoids it.', warnRestricted: '{name} does not stop at {floor}.',
      infoStairs: 'Includes stairs or steps. Choose Step-free if you need it.', infoUncovered: '{dist} m of this route is outdoors (not covered).',
      infoManualDoor: 'Includes a heavy manual door.'
    },
    'zh-HK': {
      skipToSearch: '跳至搜尋', searchPlaceholder: '搜尋課室或地點', holdToSpeak: '按住說話',
      whereTo: '想去哪裡？', quickRooms: '課室', quickFood: '餐飲', quickToilets: '洗手間', quickLifts: '升降機', quickFirstAid: '急救',
      savedRecent: '已儲存及最近', exploreCampus: '探索校園及設施', emergency: '緊急求助', legend: '地圖圖例',
      routeTo: '前往', fastest: '最快', stepfree: '無障礙', covered: '有蓋', floorSteps: '逐層路線步驟',
      addStop: '加入中途站', saveRoute: '儲存路線', start: '開始', mapView: '地圖', arView: 'AR',
      repeat: '重複', pause: '暫停', resume: '繼續', end: '結束',
      demoTitle: '示範模擬器（瀏覽器未能室內定位）', demoWalk: '自動行走', demoStep: '下一步', demoOffRoute: '模擬走錯路',
      explore: '探索', navigate: '導航', moreInfo: '更多資料', openNow: '現正開放', closedNow: '現已關閉', allBuildings: '所有大樓',
      arrivedTitle: '你已到達', saveShortcut: '儲存捷徑', navigateBack: '導航返回', done: '完成', rateRoute: '這條路線有幫助嗎？',
      listening: '正在聆聽…', typeInstead: '改用輸入', cancel: '取消', back: '返回', continue: '繼續', skip: '略過',
      settings: '設定', recalculating: '已偏離路線 – 重新計算中…', quietOn: '寧靜區 – 已靜音，改用震動',
      youAreHere: '你在這裡', next: '下一步',
      obTitle: '歡迎使用 CampusAssist', obLead: '回答三條簡單問題，讓我們建議合適路線。你可隨時在設定中更改。',
      obLang: '1. 選擇語言', obMove: '2. 你通常如何移動？', obGuide: '3. 你希望如何接收指示？',
      mobWalking: '步行', mobWalkingHint: '最快路線，可走樓梯', mobStepfree: '輪椅／無障礙', mobStepfreeHint: '只使用斜道、升降機及自動門',
      mobLuggage: '攜帶行李或手推車', mobLuggageHint: '避開樓梯及扶手電梯',
      prefVoice: '語音指示', prefHaptic: '震動提示', prefLarge: '大字體', prefContrast: '高對比',
      emTitle: '緊急求助', emCall: '按住 3 秒致電校園保安', emFirstAid: '最近急救站', emShare: '分享我的位置', emHelp: '我需要人手協助',
      noResults: '找不到結果。試試輸入房號如「LT-18」或按類別瀏覽。', browse: '按類別瀏覽', recentSearches: '最近搜尋',
      chooseDest: '選擇目的地', chooseOrigin: '我現在在…', chooseStop: '加入中途站',
      stepDepart: '由{from}出發。', stepWalk: '繼續前行 {dist} 米至{landmark}。', stepTurn: '{dist} 米後，在{landmark}{dir}轉。',
      stepLevel: '乘搭{name}{dir}至{floor}。', stepVia: '經{label}（{dist} 米）。', stepArrive: '{dist} 米後到達{place}。',
      left: '向左', right: '向右', up: '上', down: '落',
      warnClosed: '{name}暫停服務 – 此路線已避開。', warnRestricted: '{name}不停 {floor}。',
      infoStairs: '此路線包括樓梯或梯級。如有需要請選擇「無障礙」。', infoUncovered: '此路線有 {dist} 米位於室外（無上蓋）。',
      infoManualDoor: '途經一道較重的手推門。'
    },
    'zh-CN': {
      skipToSearch: '跳至搜索', searchPlaceholder: '搜索教室或地点', holdToSpeak: '按住说话',
      whereTo: '想去哪里？', quickRooms: '教室', quickFood: '餐饮', quickToilets: '洗手间', quickLifts: '电梯', quickFirstAid: '急救',
      savedRecent: '已保存及最近', exploreCampus: '探索校园及设施', emergency: '紧急求助', legend: '地图图例',
      routeTo: '前往', fastest: '最快', stepfree: '无障碍', covered: '有盖', floorSteps: '逐层路线步骤',
      addStop: '添加途经点', saveRoute: '保存路线', start: '开始', mapView: '地图', arView: 'AR',
      repeat: '重复', pause: '暂停', resume: '继续', end: '结束',
      demoTitle: '演示模拟器（浏览器无法室内定位）', demoWalk: '自动行走', demoStep: '下一步', demoOffRoute: '模拟走错路',
      explore: '探索', navigate: '导航', moreInfo: '更多信息', openNow: '正在营业', closedNow: '已关闭', allBuildings: '所有大楼',
      arrivedTitle: '您已到达', saveShortcut: '保存快捷方式', navigateBack: '导航返回', done: '完成', rateRoute: '这条路线有帮助吗？',
      listening: '正在聆听…', typeInstead: '改为输入', cancel: '取消', back: '返回', continue: '继续', skip: '跳过',
      settings: '设置', recalculating: '已偏离路线 – 正在重新计算…', quietOn: '安静区 – 已静音，改用振动',
      youAreHere: '您在这里', next: '下一步',
      obTitle: '欢迎使用 CampusAssist', obLead: '回答三个简单问题，以便我们推荐合适路线。您可随时在设置中更改。',
      obLang: '1. 选择语言', obMove: '2. 您通常如何移动？', obGuide: '3. 您希望如何接收指引？',
      mobWalking: '步行', mobWalkingHint: '最快路线，可走楼梯', mobStepfree: '轮椅／无障碍', mobStepfreeHint: '仅使用坡道、电梯及自动门',
      mobLuggage: '携带行李或手推车', mobLuggageHint: '避开楼梯及扶梯',
      prefVoice: '语音指引', prefHaptic: '振动提示', prefLarge: '大字体', prefContrast: '高对比度',
      emTitle: '紧急求助', emCall: '按住 3 秒致电校园保安', emFirstAid: '最近急救站', emShare: '分享我的位置', emHelp: '我需要人手协助',
      noResults: '没有结果。试试输入房号如"LT-18"或按类别浏览。', browse: '按类别浏览', recentSearches: '最近搜索',
      chooseDest: '选择目的地', chooseOrigin: '我现在在…', chooseStop: '添加途经点',
      stepDepart: '从{from}出发。', stepWalk: '继续前行 {dist} 米至{landmark}。', stepTurn: '{dist} 米后，在{landmark}{dir}转。',
      stepLevel: '乘坐{name}{dir}至{floor}。', stepVia: '经{label}（{dist} 米）。', stepArrive: '{dist} 米后到达{place}。',
      left: '向左', right: '向右', up: '上', down: '下',
      warnClosed: '{name}暂停服务 – 此路线已避开。', warnRestricted: '{name}不停 {floor}。',
      infoStairs: '此路线包括楼梯或台阶。如有需要请选择"无障碍"。', infoUncovered: '此路线有 {dist} 米位于室外（无遮盖）。',
      infoManualDoor: '途经一道较重的手推门。'
    }
  };
  function fmt(lang, key, vars) {
    const dict = I18N[lang] || I18N.en;
    let s = dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }

  /* ---------------- 9. GEOMETRY HELPERS ---------------- */
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /* Strict interior → corridor nodes on zone borders return null */
  function zoneAt(b, x, y) {
    if (b !== 'AC1') return null;
    for (const z of ZONES) {
      const xs = z.poly.map((p) => p[0]), ys = z.poly.map((p) => p[1]);
      if (x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys)) return z.id;
    }
    return null;
  }
  const zoneById = (id) => ZONES.find((z) => z.id === id) || null;
  function quietZoneAt(f, x, y) {
    return QUIET_ZONES.find((q) => q.f === f && pointInPoly(x, y, q.poly)) || null;
  }

  /* ---------------- 10. GRAPH BUILDER ---------------- */
  function buildGraph() {
    const nodes = new Map();
    const adj = new Map();
    const addNode = (id, n) => { nodes.set(id, Object.assign({ id }, n)); adj.set(id, []); };
    const addEdge = (a, b, props) => {
      props = props || {};
      const A = nodes.get(a), B = nodes.get(b);
      if (!A || !B) { console.warn('[CampusAssist] Bad edge', a, b); return; }
      const dist = props.dist != null ? props.dist : Math.round(Math.hypot(A.x - B.x, A.y - B.y));
      const base = Object.assign({ kind: 'walk', covered: true, door: null, floors: 0 }, props, { dist });
      adj.get(a).push(Object.assign({}, base, { from: a, to: b }));
      adj.get(b).push(Object.assign({}, base, { from: b, to: a, label: props.labelRev || props.label }));
    };

    // Corridors, repeated on every floor of each building
    Object.entries(CORRIDORS).forEach(([b, c]) => {
      BUILDINGS[b].floors.forEach((f) => {
        c.points.forEach((p) => addNode(`${b}-${f}-${p.k}`, { x: p.x, y: p.y, f, b, kind: 'corridor', label: p.name }));
        c.links.forEach(([p, q]) => addEdge(`${b}-${f}-${p}`, `${b}-${f}-${q}`));
      });
    });

    OUTDOOR_NODES.forEach((n) => addNode(n.id, Object.assign({ kind: 'outdoor' }, n)));

    // Vertical connectors: lifts = any floor to any floor; stairs/escalators = consecutive floors
    VERTICALS.forEach((v) => {
      v.floors.forEach((f) => {
        const id = `${v.id}@${f}`;
        addNode(id, { x: v.x, y: v.y, f, b: v.building, kind: v.type, vertical: v.id, label: v.name, closed: !!v.closed });
        const att = typeof v.attach === 'string' ? `${v.building}-${f}-${v.attach}` : v.attach[f];
        addEdge(id, att, {});
      });
      for (let i = 0; i < v.floors.length; i++) {
        for (let j = i + 1; j < v.floors.length; j++) {
          if (v.type !== 'lift' && j !== i + 1) continue;
          const fi = v.floors[i], fj = v.floors[j];
          addEdge(`${v.id}@${fi}`, `${v.id}@${fj}`, {
            kind: v.type, dist: 0, floors: Math.abs(floorIndex(fj) - floorIndex(fi)), vertical: v.id, closed: !!v.closed
          });
        }
      }
    });

    LINKS.forEach((l) => addEdge(l.a, l.b, l));

    PLACES.forEach((p) => {
      const id = 'place:' + p.id;
      addNode(id, { x: p.x, y: p.y, f: p.f, b: p.b, kind: 'place', place: p.id, label: p.name });
      if (p.node) addEdge(id, p.node, { dist: 3 });
      else addEdge(id, `${p.b}-${p.f}-${p.attach}`, {});
    });

    return { nodes, adj };
  }

  /* ---------------- 11. ROUTING ENGINE (Dijkstra) ---------------- */
  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(item) {
      const a = this.a; a.push(item); let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
  }

  /* Real travel time (seconds), without preference penalties */
  function edgeTime(e, speed) {
    switch (e.kind) {
      case 'lift': return TIMING.liftWait + TIMING.liftPerFloor * e.floors;
      case 'escalator': return TIMING.escalatorPerFloor * e.floors;
      case 'stairs': return e.floors > 0 ? TIMING.stairsPerFloor * e.floors : e.dist / speed + 6;
      case 'ramp': return (e.dist / speed) * 1.15;
      default: return e.dist / speed;
    }
  }
  /* Search cost = time + user-preference penalties (constraints) */
  function edgeCost(e, o) {
    if (e.closed && !o.ignoreClosed) return Infinity;
    const stepFree = o.mode === 'stepfree' || o.stepFree;
    if (stepFree && (e.kind === 'stairs' || e.kind === 'escalator')) return Infinity;
    let t = edgeTime(e, o.speed);
    if (stepFree && e.door === 'manual') t += TIMING.manualDoorPenalty;
    if (o.mode === 'covered' && !e.covered) t = t * TIMING.uncoveredFactor + TIMING.uncoveredPenalty;
    if (o.avoid && o.avoid.has(e.to)) t += 9999;
    return t;
  }

  function dijkstra(graph, from, to, o) {
    if (!graph.nodes.has(from) || !graph.nodes.has(to)) return null;
    const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
    const heap = new MinHeap(); heap.push([0, from]);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (done.has(u)) continue;
      done.add(u);
      if (u === to) break;
      for (const e of graph.adj.get(u)) {
        if (done.has(e.to)) continue;
        const c = edgeCost(e, o);
        if (!Number.isFinite(c)) continue;
        const nd = d + c;
        if (nd < (dist.has(e.to) ? dist.get(e.to) : Infinity)) {
          dist.set(e.to, nd); prev.set(e.to, { from: u, edge: e }); heap.push([nd, e.to]);
        }
      }
    }
    if (!done.has(to)) return null;
    const path = [to], edges = [];
    let cur = to;
    while (cur !== from) { const p = prev.get(cur); edges.unshift(p.edge); path.unshift(p.from); cur = p.from; }
    return { path, edges, cost: dist.get(to) };
  }

  function routeStats(graph, path, edges, o) {
    const s = { time: 0, dist: 0, lifts: 0, stairs: 0, escalators: 0, uncovered: 0, manualDoors: 0, floors: [], buildings: [] };
    edges.forEach((e) => {
      s.time += edgeTime(e, o.speed);
      if (e.kind === 'lift') s.lifts++;
      else if (e.kind === 'stairs') s.stairs++;
      else if (e.kind === 'escalator') s.escalators++;
      else s.dist += e.dist;
      if (!e.covered) s.uncovered += e.dist;
      if (e.door === 'manual') s.manualDoors++;
    });
    path.forEach((id) => {
      const n = graph.nodes.get(id);
      const key = `${n.b}|${n.f}`;
      if (!s.floors.length || s.floors[s.floors.length - 1] !== key) s.floors.push(key);
      if (!s.buildings.includes(n.b)) s.buildings.push(n.b);
    });
    s.time = Math.round(s.time); s.dist = Math.round(s.dist); s.uncovered = Math.round(s.uncovered);
    return s;
  }

  function routeWarnings(graph, from, to, edges, o, stats, lang) {
    const out = [];
    const T = (k, v) => fmt(lang, k, v);
    // Would the unrestricted route use a closed lift? → tell the user we avoided it
    const ideal = dijkstra(graph, from, to, Object.assign({}, o, { ignoreClosed: true }));
    if (ideal) {
      const usedClosed = [...new Set(ideal.edges.filter((e) => e.closed).map((e) => e.vertical))];
      usedClosed.forEach((vid) => out.push({ level: 'warn', icon: '⚠️', text: T('warnClosed', { name: VERTICAL_BY_ID[vid].name }) }));
    }
    // Lifts in the destination building that skip the destination floor
    const dest = graph.nodes.get(to);
    if (stats.lifts > 0 && dest) {
      VERTICALS.filter((v) => v.type === 'lift' && v.building === dest.b && !v.closed && !v.floors.includes(dest.f))
        .forEach((v) => out.push({ level: 'warn', icon: '🛗', text: T('warnRestricted', { name: v.name, floor: floorLabel(dest.f) }) }));
    }
    if (!(o.mode === 'stepfree' || o.stepFree) && stats.stairs > 0) out.push({ level: 'info', icon: '🪜', text: T('infoStairs') });
    if (stats.uncovered > 0) out.push({ level: o.mode === 'covered' ? 'warn' : 'info', icon: '☂', text: T('infoUncovered', { dist: stats.uncovered }) });
    if (stats.manualDoors > 0) out.push({ level: 'info', icon: '🚪', text: T('infoManualDoor') });
    return out;
  }

  /* ---------------- 12. TURN-BY-TURN STEP GENERATOR (landmark-based) ---------------- */
  function turnDir(a, b, c) {
    const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
    if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) return null;
    const ang = (Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y) * 180) / Math.PI;
    if (Math.abs(ang) < 35) return null;
    return ang > 0 ? 'right' : 'left';   // y-down coordinates: positive = clockwise = right
  }
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  function viaIcon(e) {
    if (e.kind === 'ramp') return 'ramp';
    if (e.kind === 'stairs') return 'stairs';
    if (/bridge/i.test(e.label || '')) return 'bridge';
    if (e.door) return 'door';
    return 'via';
  }

  function buildSteps(graph, path, edges, lang) {
    const T = (k, v) => fmt(lang, k, v);
    const N = (id) => graph.nodes.get(id);
    const r5 = (m) => Math.max(5, Math.round(m / 5) * 5);
    const isVert = (e) => e.kind === 'lift' || e.kind === 'escalator' || (e.kind === 'stairs' && e.floors > 0);
    const steps = [];
    const push = (kind, text, fromIdx, toIdx, extra) => {
      extra = extra || {};
      const n = N(path[toIdx]);
      steps.push(Object.assign({
        kind, text, fromIdx, toIdx, node: path[toIdx], f: n.f, b: n.b, x: n.x, y: n.y,
        zone: zoneAt(n.b, n.x, n.y), icon: STEP_ICONS[extra.icon || kind] || '⬆',
        feedback: STEP_FEEDBACK[kind] || STEP_FEEDBACK.straight
      }, extra));
    };

    if (!edges.length) { push('arrive', T('stepArrive', { dist: 0, place: N(path[0]).label }), 0, 0); return steps; }
    push('depart', T('stepDepart', { from: N(path[0]).label }), 0, 0);

    let acc = 0, seg = 0;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const a = N(path[i]), b = N(path[i + 1]);

      if (isVert(e)) {                                   // level change → special card
        let j = i;
        while (j + 1 < edges.length && isVert(edges[j + 1]) && edges[j + 1].vertical === e.vertical) j++;
        if (acc > 0) push('straight', T('stepWalk', { dist: r5(acc), landmark: a.label }), seg, i, { dist: acc });
        const end = N(path[j + 1]);
        const up = floorIndex(end.f) > floorIndex(a.f);
        const v = VERTICAL_BY_ID[e.vertical];
        push(up ? 'up' : 'down',
          T('stepLevel', { name: v ? v.name : e.kind, dir: T(up ? 'up' : 'down'), floor: floorLabel(end.f) }),
          i, j + 1, { level: true, vertical: e.vertical, verticalType: e.kind, fromFloor: a.f });
        acc = 0; seg = j + 1; i = j;
        continue;
      }

      if (e.label) {                                     // named segment: bridge, ramp, doors, steps
        if (acc > 0) push('straight', T('stepWalk', { dist: r5(acc), landmark: a.label }), seg, i, { dist: acc });
        push('via', T('stepVia', { label: cap(e.label), dist: r5(e.dist) }), i, i + 1, { dist: e.dist, icon: viaIcon(e) });
        acc = 0; seg = i + 1;
        continue;
      }

      acc += e.dist;
      const next = edges[i + 1];
      if (next && !isVert(next) && i + 2 < path.length) {
        const turn = turnDir(a, b, N(path[i + 2]));
        if (turn) {
          push(turn, T('stepTurn', { dist: r5(acc), dir: T(turn), landmark: b.label }), seg, i + 1, { dist: acc });
          acc = 0; seg = i + 1;
        }
      }
    }
    const last = N(path[path.length - 1]);
    push('arrive', T('stepArrive', { dist: r5(acc), place: last.label }), seg, path.length - 1, { dist: acc });
    return steps;
  }

  /* Public route API */
  function findRoute(graph, from, to, options) {
    options = options || {};
    const lang = options.lang || 'en';
    const o = {
      mode: options.mode || 'fastest',
      stepFree: !!options.stepFree,
      speed: TIMING.speed[options.profile] || TIMING.speed.walking,
      avoid: options.avoid || null
    };
    const stops = [from].concat(options.vias || [], [to]);
    let path = [], edges = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = dijkstra(graph, stops[i], stops[i + 1], o);
      if (!seg) return null;
      const segPath = seg.path.slice();
      if (path.length) segPath.shift();
      path = path.concat(segPath); edges = edges.concat(seg.edges);
    }
    const stats = routeStats(graph, path, edges, o);
    return {
      from, to, mode: o.mode, stepFree: o.mode === 'stepfree' || o.stepFree, path, edges, stats,
      warnings: routeWarnings(graph, from, to, edges, o, stats, lang),
      steps: buildSteps(graph, path, edges, lang)
    };
  }

  /* Nearest routable node on a floor (long-press "take me here", reroute, "I'm at…") */
  function nearestNode(graph, f, x, y, filter) {
    let best = null, bd = Infinity;
    graph.nodes.forEach((n) => {
      if (n.f !== f || n.kind === 'place') return;
      if (filter && !filter(n)) return;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n.id; }
    });
    return best;
  }

  /* ---------------- 13. FUZZY SEARCH (error-tolerant input) ---------------- */
  const QUERY_PREFIX = /^(where\s*is|where's|wheres|take\s*me\s*to|navigate\s*to|go\s*to|find|show\s*me|how\s*do\s*i\s*get\s*to|i\s*want\s*to\s*go\s*to|帶我去|带我去|我想去|我要去|去)\s*/i;
  const QUERY_SUFFIX = /(在哪裡|在哪里|喺邊度|喺邊|在哪|點去|点去|怎么走|怎麼走)$/;
  function cleanQuery(q) {
    return String(q || '').trim().replace(/[?？!！。.]+$/, '').replace(QUERY_PREFIX, '')
      .replace(QUERY_SUFFIX, '').replace(/^the\s+/i, '').trim();
  }
  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFKC').replace(/[\s\-_.·,'"()/]/g, '');
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  /* Returns [{place, score, reason}] sorted. Score ≥ 100 = exact. */
  function searchPlaces(raw) {
    const q = normalize(cleanQuery(raw));
    if (!q) return [];
    const out = [];
    PLACES.forEach((p) => {
      let score = 0, reason = '';
      const cands = [p.name, p.id, p.zh, p.zhs].concat(p.aliases || []).filter(Boolean);
      cands.forEach((c0) => {
        const c = normalize(c0);
        if (c === q) { if (score < 100) { score = 100; reason = 'exact'; } }
        else if (q.length >= 2 && c.startsWith(q)) { if (score < 85) { score = 85; reason = 'starts with'; } }
        else if (q.length >= 3 && c.includes(q)) { if (score < 70) { score = 70; reason = 'contains'; } }
        else if (q.length >= 3 && Math.abs(c.length - q.length) <= 2) {
          const d = lev(c, q);
          if (d === 1 && score < 55) { score = 55; reason = 'similar'; }
          else if (d === 2 && q.length >= 5 && score < 40) { score = 40; reason = 'similar'; }
        }
      });
      const words = (CATEGORY_WORDS[p.cat] || []).map(normalize);
      if (words.some((w) => w === q || (w.length >= 3 && q.includes(w))) && score < 65) { score = 65; reason = 'category'; }
      if (score) out.push({ place: p, score, reason });
    });
    return out.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
  }

  /* ---------------- 14. OPENING HOURS ---------------- */
  const toMin = (h) => { const [H, M] = h.split(':').map(Number); return H * 60 + M; };
  function isOpen(p, d) {
    if (!p || !p.hours) return null;
    if (p.hours === '24h') return true;
    d = d || new Date();
    const o = toMin(p.hours[0]), c = toMin(p.hours[1]), m = d.getHours() * 60 + d.getMinutes();
    return c > o ? m >= o && m < c : m >= o || m < c;   // supports past-midnight closing
  }
  function hoursText(p) {
    if (!p || !p.hours) return '';
    return p.hours === '24h' ? '24 hours' : `${p.hours[0]}–${p.hours[1]}`;
  }

  /* ---------------- 15. EXPORT ---------------- */
  global.Campus = Object.freeze({
    FLOORS, floorIndex, floorLabel, BUILDINGS, ZONES, CORRIDORS, OUTDOOR_NODES, LINKS,
    VERTICALS, VERTICAL_BY_ID, PLACES, PLACE_BY_ID, CATEGORIES, QUICK_GROUPS, CATEGORY_WORDS,
    QUIET_ZONES, TIMING, HAPTICS, HAPTIC_LABEL, EARCONS, STEP_ICONS, I18N,
    DEFAULT_ORIGIN: 'MTR-C2',
    fmt, pointInPoly, zoneAt, zoneById, quietZoneAt,
    buildGraph, findRoute, nearestNode, edgeTime,
    searchPlaces, cleanQuery, normalize, isOpen, hoursText,
    placeNode: (id) => 'place:' + id
  });
})(window);