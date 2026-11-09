/* ==========================================================
   CampusAssist – basemap.js
   Outdoor context layer drawn in a Google-Maps-like style.
   Same coordinates as data.js (1 unit ≈ 0.5 m, x → east, y → south).
   Traced loosely from the public campus map: ILLUSTRATIVE,
   not survey-accurate. Verify on site before the final demo.
   ========================================================== */
(function () {
  'use strict';
  const rot = (cx, cy, s, t) => [Math.round(cx + 0.7071 * (s + t)), Math.round(cy + 0.7071 * (s - t))];
  const blk = (cx, cy, a, b) => [rot(cx, cy, -a, b), rot(cx, cy, a, b), rot(cx, cy, a, -b), rot(cx, cy, -a, -b)];

  CA.BASEMAP = {
    /* University land (light tan) */
    campus: [[-120, 120], [120, -50], [260, -30], [850, 510], [820, 650], [720, 810], [560, 820], [330, 720], [320, 640], [-120, 600]],

    parks: [
      { poly: [[955, 612], [1100, 712], [1100, 900], [770, 900], [905, 640]] },
      { poly: [[-160, 420], [-80, 340], [20, 440], [-60, 520]] },
      { poly: [[-40, 470], [100, 450], [170, 560], [40, 600]] },
      { poly: [[1015, -60], [1100, -60], [1100, 600], [1060, 600]] }
    ],

    /* Non-interactive surrounding buildings */
    context: [
      { id: 'FW',    kind: 'mall',   poly: [[340, -60], [1010, -60], [1010, 535]] },
      { id: 'MMW',   kind: 'campus', poly: blk(690, 520, 60, 45) },
      { id: 'LODGE', kind: 'campus', poly: blk(810, 520, 45, 35) },
      { id: 'TY',    kind: 'campus', poly: blk(690, 700, 60, 50) },
      { id: 'HFK',   kind: 'campus', poly: blk(40, 300, 70, 60) },
      { id: 'NS1',   kind: 'res',    poly: [[-110, 690], [40, 690], [40, 760], [-110, 760]] },
      { id: 'NS2',   kind: 'res',    poly: [[110, 700], [250, 690], [260, 790], [120, 800]] }
    ],

    /* cls: major | minor | service ; w = width in map units ; arrows: 'two' | 'one' */
    roads: [
      { id: 'tca', cls: 'major', w: 44, median: true, arrows: 'two', pts: [[250, -77], [1100, 685]],
        zh: '達之路', en: 'Tat Chee Avenue', labelAt: [0.4, 0.7] },
      { id: 'tys', cls: 'minor', w: 22, arrows: 'two', pts: [[948, 540], [690, 880]],
        zh: '桃源街', en: 'To Yuen Street', labelAt: [0.55] },
      { id: 'nscr', cls: 'minor', w: 24, pts: [[-160, 628], [150, 630], [255, 648], [300, 700], [305, 900]],
        zh: '南山邨道', en: 'Nam Shan Chuen Rd', labelAt: [0.25] },
      { id: 'svc', cls: 'service', w: 14, pts: [[722, 344], [600, 470]] }
    ],

    /* Context pins: cat = edu | shop | food | cafe | sport | transit | null (label only) */
    pois: [
      { x: 780, y: 150, cat: 'shop', zh: '又一城', en: 'Festival Walk', sub: 'Shopping mall · 大型購物中心' },
      { x: 933, y: 213, cat: 'transit', en: 'C1', cls: 'map-lbl--strong' },
      { x: 900, y: 330, cat: null, zh: '港鐵九龍塘站', en: 'MTR Kowloon Tong Station', cls: 'map-lbl--transit' },
      { x: 690, y: 520, cat: 'edu', zh: '蒙民偉樓', en: 'Mong Man Wai Building', pos: 'above' },
      { x: 810, y: 520, cat: 'edu', zh: '城大賓館', en: 'CityUHK Lodge', pos: 'right' },
      { x: 690, y: 700, cat: 'edu', zh: '桃源樓', en: 'To Yuen Building', pos: 'left' },
      { x: 40,  y: 300, cat: 'sport', zh: '胡法光運動中心', en: 'Hu Fa Kuang Sports Centre', pos: 'below' },
      { x: -30, y: 730, cat: null, zh: '南山邨', en: 'Nam Shan Estate', cls: 'map-lbl--soft' }
    ],

    /* Large area names (lod: 1 = only when zoomed out) */
    areas: [
      { x: 170, y: 200, zh: '香港城市大學', en: 'City University of Hong Kong', lod: 1 }
    ]
  };
})();