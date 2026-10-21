/* Dash Express artwork. Plain SVG built with createElementNS (no innerHTML), shared by the pupil app.
   Colours that carry meaning come from the pupil's garage choice; outlines use the page ink so
   everything reads in light and dark mode. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#1b1f3b';
  const SKIN = '#f2c29b';

  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) if (k) el.append(k);
    return el;
  }
  const line = (extra) => ({ stroke: INK, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra });

  let uid = 0;
  // 'rainbow' is a gradient, so it needs a definition inside each svg that uses it.
  function paintFor(paint) {
    if (paint !== 'rainbow') return { fill: paint || '#ffd23f', defs: null };
    const id = 'rb' + ++uid;
    const stops = ['#ff6b6b', '#ff9f1c', '#ffd23f', '#3ecf8e', '#4aa8ff', '#8b5cf6'];
    const grad = sv('linearGradient', { id, x1: '0', x2: '1', y1: '0', y2: '0' }, stops.map((c, i) => sv('stop', { offset: String(i / (stops.length - 1)), 'stop-color': c })));
    return { fill: 'url(#' + id + ')', defs: sv('defs', null, grad) };
  }

  function star(x, y, r, fill) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push((x + Math.cos(a) * rr).toFixed(1) + ',' + (y + Math.sin(a) * rr).toFixed(1));
    }
    return sv('polygon', line({ points: pts.join(' '), fill, 'stroke-width': 1.6 }));
  }

  function sticker(id, x, y) {
    if (!id || id === 'none') return null;
    if (id === 'star') return star(x, y, 8, '#ffd23f');
    if (id === 'bolt') return sv('polygon', line({ points: `${x + 2},${y - 9} ${x - 6},${y + 1} ${x - 1},${y + 1} ${x - 3},${y + 9} ${x + 6},${y - 2} ${x + 1},${y - 2}`, fill: '#ffd23f', 'stroke-width': 1.6 }));
    if (id === 'heart') return sv('path', line({ d: `M${x} ${y + 7} C${x - 12} ${y - 2} ${x - 5} ${y - 11} ${x} ${y - 4} C${x + 5} ${y - 11} ${x + 12} ${y - 2} ${x} ${y + 7}z`, fill: '#ff6b6b', 'stroke-width': 1.6 }));
    if (id === 'quote') return sv('g', null, sv('circle', line({ cx: x, cy: y, r: 8, fill: '#fff', 'stroke-width': 1.6 })), sv('text', { x, y: y + 5, 'text-anchor': 'middle', 'font-size': '14', 'font-weight': '700', 'font-family': 'Fredoka, sans-serif', fill: INK }, '“'));
    if (id === 'flag') {
      const sq = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) sq.push(sv('rect', { x: x - 9 + c * 6, y: y - 6 + r * 6, width: 6, height: 6, fill: (r + c) % 2 ? '#fff' : INK }));
      return sv('g', null, sq, sv('rect', line({ x: x - 9, y: y - 6, width: 18, height: 12, fill: 'none', 'stroke-width': 1.4 })));
    }
    return null;
  }

  function rider(x, y, helmet, jacket) {
    const g = sv('g');
    g.append(sv('rect', line({ x: x - 8, y: y + 8, width: 16, height: 20, rx: 5, fill: jacket })));
    g.append(sv('circle', line({ cx: x, cy: y, r: 9, fill: SKIN })));
    g.append(sv('circle', { cx: x + 3, cy: y - 1, r: 1.3, fill: INK }));
    g.append(sv('path', { d: `M${x + 1} ${y + 3.5} q3 2.5 6 0`, fill: 'none', stroke: INK, 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
    if (helmet === 'cap') {
      g.append(sv('path', line({ d: `M${x - 9.5} ${y - 1} a9.5 9.5 0 0 1 19 0z`, fill: '#e63946' })));
      g.append(sv('rect', line({ x: x + 2, y: y - 3, width: 12, height: 3.2, rx: 1.4, fill: '#e63946', 'stroke-width': 1.6 })));
    } else if (helmet === 'round' || helmet === 'visor' || helmet === 'star') {
      g.append(sv('path', line({ d: `M${x - 11} ${y + 3} a11 11 0 0 1 22 0z`, fill: helmet === 'star' ? '#ffd23f' : '#4aa8ff' })));
      if (helmet === 'visor') g.append(sv('rect', line({ x: x - 1, y: y - 2, width: 12, height: 5, rx: 2, fill: '#2b3a67', 'stroke-width': 1.5 })));
      if (helmet === 'star') g.append(star(x, y - 6, 4.2, '#fff'));
    }
    return g;
  }

  const wheel = (cx, cy, r) => sv('g', null, sv('circle', line({ cx, cy, r, fill: '#2f3354' })), sv('circle', { cx, cy, r: r * 0.4, fill: '#cfd6ea', stroke: INK, 'stroke-width': 1.5 }));
  const parcel = (x, y, w = 22, h = 18) => sv('g', null, sv('rect', line({ x, y, width: w, height: h, rx: 2, fill: '#d9a066' })), sv('path', { d: `M${x + w / 2} ${y} v${h}M${x} ${y + h / 2} h${w}`, stroke: INK, 'stroke-width': 1.4, fill: 'none' }));

  // A vehicle in a 160 x 90 box. look = { paint, helmet, sticker }.
  function vehicleSvg(id, look, size) {
    const l = look || {};
    const { fill, defs } = paintFor(l.paint);
    const svg = sv('svg', { viewBox: '0 0 160 90', width: size || 160, height: Math.round(((size || 160) * 90) / 160), role: 'img', 'aria-label': 'Your ride', focusable: 'false' });
    if (defs) svg.append(defs);
    svg.append(sv('ellipse', { cx: 80, cy: 84, rx: 62, ry: 3.5, fill: 'rgba(27,31,59,.18)' }));
    let sx = 80;
    let sy = 60;
    if (id === 'bike') {
      svg.append(wheel(38, 66, 15), wheel(122, 66, 15));
      svg.append(sv('path', line({ d: 'M38 66 L70 66 L58 40 M70 66 L96 40 M58 40 L96 40 M96 40 L122 66 M96 40 L92 30 M92 30 L102 30', fill: 'none', 'stroke-width': 4 })));
      svg.append(sv('path', { d: 'M38 66 L70 66 L58 40 M70 66 L96 40 M58 40 L96 40 M96 40 L122 66', fill: 'none', stroke: fill, 'stroke-width': 2 }));
      svg.append(parcel(20, 36, 24, 20));
      svg.append(sv('path', line({ d: 'M74 42 L68 66 M80 42 L88 62', fill: 'none', 'stroke-width': 5 })));
      svg.append(rider(76, 16, l.helmet, fill));
      sx = 32;
      sy = 46;
    } else if (id === 'scooter') {
      svg.append(wheel(38, 72, 9), wheel(122, 72, 9));
      svg.append(sv('rect', line({ x: 36, y: 62, width: 88, height: 8, rx: 4, fill })));
      svg.append(sv('path', line({ d: 'M122 70 L114 26 L106 26', fill: 'none', 'stroke-width': 4 })));
      svg.append(parcel(44, 44, 22, 18));
      svg.append(sv('path', line({ d: 'M84 40 L76 62 M90 40 L100 62', fill: 'none', 'stroke-width': 5 })));
      svg.append(rider(86, 14, l.helmet, fill));
      sx = 55;
      sy = 53;
    } else if (id === 'van') {
      svg.append(sv('rect', line({ x: 14, y: 22, width: 92, height: 48, rx: 6, fill })));
      svg.append(sv('path', line({ d: 'M106 36 L128 36 Q142 38 146 52 L146 70 L106 70z', fill })));
      svg.append(sv('path', line({ d: 'M112 41 L127 41 Q137 43 140 52 L112 52z', fill: '#cfe8ff', 'stroke-width': 2 })));
      svg.append(wheel(42, 72, 12), wheel(122, 72, 12));
      svg.append(sv('circle', { cx: 121, cy: 47, r: 4.5, fill: SKIN, stroke: INK, 'stroke-width': 1.5 }));
      svg.append(sv('text', { x: 58, y: 53, 'text-anchor': 'middle', 'font-size': '15', 'font-weight': '700', 'font-family': 'Fredoka, sans-serif', fill: INK }, 'DASH'));
      sx = 30;
      sy = 36;
    } else if (id === 'truck') {
      svg.append(sv('rect', line({ x: 6, y: 14, width: 100, height: 56, rx: 6, fill })));
      svg.append(sv('path', line({ d: 'M108 34 L130 34 Q146 36 150 52 L150 70 L108 70z', fill })));
      svg.append(sv('path', line({ d: 'M114 39 L130 39 Q141 41 144 51 L114 51z', fill: '#cfe8ff', 'stroke-width': 2 })));
      svg.append(wheel(30, 72, 12), wheel(74, 72, 12), wheel(128, 72, 12));
      svg.append(sv('circle', { cx: 124, cy: 46, r: 4.5, fill: SKIN, stroke: INK, 'stroke-width': 1.5 }));
      svg.append(sv('text', { x: 56, y: 48, 'text-anchor': 'middle', 'font-size': '17', 'font-weight': '700', 'font-family': 'Fredoka, sans-serif', fill: INK }, 'DASH'));
      sx = 24;
      sy = 28;
    } else if (id === 'rocket') {
      svg.append(sv('path', line({ d: 'M8 46 L34 36 L30 46 L34 56z', fill: '#ff9f1c' })));
      svg.append(sv('path', line({ d: 'M22 46 L36 41 L34 46 L36 51z', fill: '#ffd23f', 'stroke-width': 1.5 })));
      svg.append(sv('path', line({ d: 'M40 30 L58 12 L78 30z M40 62 L58 80 L78 62z', fill: '#ff6b6b' })));
      svg.append(sv('path', line({ d: 'M36 46 Q72 14 148 46 Q72 78 36 46z', fill })));
      svg.append(sv('circle', line({ cx: 104, cy: 44, r: 12, fill: '#cfe8ff' })));
      svg.append(sv('circle', line({ cx: 104, cy: 45, r: 6.5, fill: SKIN, 'stroke-width': 1.6 })));
      if (l.helmet && l.helmet !== 'none') svg.append(sv('path', line({ d: 'M97 43 a7 7 0 0 1 14 0z', fill: l.helmet === 'star' ? '#ffd23f' : l.helmet === 'cap' ? '#e63946' : '#4aa8ff', 'stroke-width': 1.6 })));
      sx = 64;
      sy = 46;
    } else {
      // on foot: a runner with a parcel
      svg.append(sv('path', line({ d: 'M70 52 L58 76 M70 52 L86 74', fill: 'none', 'stroke-width': 5 })));
      svg.append(sv('rect', line({ x: 52, y: 72, width: 14, height: 8, rx: 3, fill: '#2f3354', 'stroke-width': 2 })));
      svg.append(sv('rect', line({ x: 82, y: 70, width: 14, height: 8, rx: 3, fill: '#2f3354', 'stroke-width': 2 })));
      svg.append(rider(70, 16, l.helmet, fill));
      svg.append(parcel(84, 36, 26, 22));
      sx = 97;
      sy = 47;
    }
    const st = sticker(l.sticker, sx, sy);
    if (st) svg.append(st);
    return svg;
  }

  // Dot, the depot boss: a round yellow face with a courier cap.
  function dotSvg(size) {
    const s = size || 56;
    return sv('svg', { viewBox: '0 0 64 64', width: s, height: s, 'aria-hidden': 'true', focusable: 'false' },
      sv('circle', line({ cx: 32, cy: 36, r: 22, fill: '#ffd23f' })),
      sv('path', line({ d: 'M10 30 a22 22 0 0 1 44 0z', fill: '#e63946' })),
      sv('rect', line({ x: 30, y: 24, width: 28, height: 6, rx: 3, fill: '#e63946' })),
      sv('circle', { cx: 24, cy: 38, r: 2.6, fill: INK }), sv('circle', { cx: 40, cy: 38, r: 2.6, fill: INK }),
      sv('path', { d: 'M23 46 q9 8 18 0', fill: 'none', stroke: INK, 'stroke-width': 2.6, 'stroke-linecap': 'round' }),
      sv('circle', { cx: 32, cy: 17, r: 3.4, fill: '#fff', stroke: INK, 'stroke-width': 1.6 }),
    );
  }

  const BCOL = ['#e4572e', '#2c68e0', '#12805f', '#c2410c', '#6741d9', '#0b7285', '#b88200', '#a8326b', '#0f766e', '#7c3aed', '#b45309', '#1d4ed8'];
  // A small shopfront for each district; the colour and roof change with the number.
  function buildingSvg(n, state) {
    const col = state === 'locked' ? '#9aa1bd' : BCOL[(n - 1) % 12];
    const svg = sv('svg', { viewBox: '0 0 72 60', width: 72, height: 60, 'aria-hidden': 'true', focusable: 'false' });
    svg.append(sv('rect', line({ x: 10, y: 22, width: 52, height: 34, fill: col })));
    const roof = n % 3;
    if (roof === 0) svg.append(sv('path', line({ d: 'M6 24 L36 6 L66 24z', fill: '#fff' })));
    else if (roof === 1) svg.append(sv('rect', line({ x: 6, y: 12, width: 60, height: 12, rx: 2, fill: '#fff' })));
    else svg.append(sv('path', line({ d: 'M8 24 Q36 -2 64 24z', fill: '#fff' })));
    svg.append(sv('rect', line({ x: 30, y: 38, width: 12, height: 18, rx: 2, fill: '#ffe9a8', 'stroke-width': 2 })));
    svg.append(sv('rect', line({ x: 15, y: 30, width: 11, height: 10, rx: 1.5, fill: '#cfe8ff', 'stroke-width': 2 })));
    svg.append(sv('rect', line({ x: 46, y: 30, width: 11, height: 10, rx: 1.5, fill: '#cfe8ff', 'stroke-width': 2 })));
    svg.append(sv('text', { x: 36, y: 21, 'text-anchor': 'middle', 'font-size': '10', 'font-weight': '700', 'font-family': 'Fredoka, sans-serif', fill: INK }, String(n)));
    if (state === 'locked') {
      svg.append(sv('rect', line({ x: 26, y: 32, width: 20, height: 16, rx: 3, fill: '#ffd23f' })));
      svg.append(sv('path', line({ d: 'M30 32 v-5 a6 6 0 0 1 12 0 v5', fill: 'none' })));
    }
    return svg;
  }

  // Three stars out of three, as a row.
  function starsRow(n, size) {
    const s = size || 22;
    const wrap = document.createElement('span');
    wrap.className = 'stars';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', n + ' out of 3 stars');
    for (let i = 0; i < 3; i++) {
      const svg = sv('svg', { viewBox: '0 0 24 24', width: s, height: s, 'aria-hidden': 'true', focusable: 'false' }, star(12, 12.5, 11, i < n ? '#ffd23f' : 'rgba(150,157,190,.35)'));
      wrap.append(svg);
    }
    return wrap;
  }

  const envelope = (full) =>
    sv('svg', { viewBox: '0 0 28 20', width: 28, height: 20, 'aria-hidden': 'true', focusable: 'false' },
      sv('rect', line({ x: 2, y: 2, width: 24, height: 16, rx: 3, fill: full ? '#fff' : 'rgba(150,157,190,.3)', 'stroke-width': 2 })),
      sv('path', line({ d: 'M3 4 L14 12 L25 4', fill: 'none', 'stroke-width': 2 })),
    );

  window.DashArt = { sv, vehicleSvg, dotSvg, buildingSvg, starsRow, envelope };
})();
