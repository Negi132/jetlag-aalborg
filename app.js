/* =============================================================
   Hide + Seek — Aalborg seeker map
   Every answered question becomes a polygon of "places the hider
   could still be". We intersect them all and shade the rest away.
   ============================================================= */

'use strict';

const CONFIG = {
  center: [57.0488, 9.9217],      // Aalborg, Nytorv-ish
  zoom: 12,
  playRadiusKm: 10,
  kommunekode: '851',             // Aalborg Kommune
  dawa: 'https://api.dataforsyningen.dk',
  radarPresets: [100, 250, 500, 1000, 2000, 5000, 10000] // metres
};

/* ---------- state -------------------------------------------------- */

const S = {
  playArea: null,        // GeoJSON Feature<Polygon>
  playAreaMeta: null,    // {type:'circle',center,radiusKm} | {type:'custom',name}
  constraints: [],       // see makeConstraint()
  zoneLayers: [],        // {id,name,color,geojson,layer,visible}
  me: null,              // [lng,lat] from GPS
  baseKey: 'light',
  fogOpacity: 0.62,
  seq: 1
};

/* ---------- tiny helpers ------------------------------------------- */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => 'c' + (S.seq++) + Math.random().toString(36).slice(2, 6);

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3600);
}

const fmtLL = (c) => c ? `${c[1].toFixed(5)}, ${c[0].toFixed(5)}` : '';

function fmtDist(m) {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toString().replace(/\.0$/, '')} km` : `${Math.round(m)} m`;
}

/* Turf 7 takes a FeatureCollection; older builds take two args.
   Try both so a CDN version bump can't silently break the map. */
function boolOp(fn, a, b) {
  if (!a || !b) return null;
  try {
    const r = fn(turf.featureCollection([a, b]));
    if (r !== undefined) return r;
  } catch (_) { /* fall through */ }
  try { return fn(a, b) || null; } catch (_) { return null; }
}
const gIntersect = (a, b) => boolOp(turf.intersect, a, b);
const gDifference = (a, b) => boolOp(turf.difference, a, b);

/* How far the play area reaches, in km. Everything oversized is scaled
   from this so the app works just as well on a 1 km game as a 200 km one. */
function playSpanKm() {
  if (!S.playArea) return 25;
  const bb = turf.bbox(S.playArea);
  return Math.max(5, turf.distance(turf.point([bb[0], bb[1]]), turf.point([bb[2], bb[3]]),
                                   { units: 'kilometers' }));
}

/* A rectangle big enough to stand in for "everything else". Built around
   the play area rather than a fixed point, so this works in any city. */
function worldRect() {
  const bb = turf.bbox(S.playArea || turf.point(CONFIG.center.slice().reverse()));
  const d = Math.max(1.5, (bb[2] - bb[0]), (bb[3] - bb[1])) * 2 + 1;
  return turf.polygon([[
    [bb[0] - d, bb[1] - d], [bb[2] + d, bb[1] - d],
    [bb[2] + d, bb[3] + d], [bb[0] - d, bb[3] + d], [bb[0] - d, bb[1] - d]
  ]]);
}

/* Half-plane on one side of the perpendicular bisector of AB —
   the set of points nearer to B than to A (towardB = true).

   The bisector is a great circle, so we walk it in steps rather than
   drawing one long chord: over a few hundred km a chord bows away from
   the true bisector badly enough to put the wrong half of the map in play. */
function halfPlane(a, b, towardB) {
  const mid = turf.midpoint(turf.point(a), turf.point(b)).geometry.coordinates;
  const brg = turf.bearing(turf.point(a), turf.point(b));
  const L = Math.max(20, playSpanKm() * 1.5);
  const STEPS = 48;
  const dir = towardB ? brg : brg + 180;

  const edge = [];
  for (let i = -STEPS; i <= STEPS; i++) {
    const d = (i / STEPS) * L;
    edge.push(d === 0 ? mid
      : turf.destination(mid, Math.abs(d), d > 0 ? brg + 90 : brg - 90).geometry.coordinates);
  }
  const far = edge.slice().reverse()
    .map((p) => turf.destination(p, L * 2, dir).geometry.coordinates);

  return turf.polygon([[...edge, ...far, edge[0]]]);
}

/* Voronoi cell around points[i] — "my nearest X is this one". */
function voronoiCell(points, i) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return turf.clone(S.playArea);
  const pad = turf.buffer(S.playArea, Math.max(5, playSpanKm() * 0.5), { units: 'kilometers' });
  const bbox = turf.bbox(pad || S.playArea);
  const fcPts = turf.featureCollection(points.map((p) => turf.point(p)));
  let cells;
  try { cells = turf.voronoi(fcPts, { bbox }); } catch (_) { return null; }
  const cell = cells && cells.features && cells.features[i];
  return cell && cell.geometry ? cell : null;
}

/* ---------- constraint → polygon of possible hider locations ------- */

function constraintPolygon(c) {
  const play = S.playArea;
  const invert = (poly) => gDifference(play, poly);

  switch (c.type) {
    case 'radar': {
      const circle = turf.circle(c.center, c.radiusM / 1000, { steps: 180, units: 'kilometers' });
      return c.answer === 'yes' ? circle : invert(circle);
    }
    case 'thermometer':
      return halfPlane(c.a, c.b, c.answer === 'hotter');

    case 'measuring': {
      const r = turf.distance(turf.point(c.seeker), turf.point(c.target), { units: 'kilometers' });
      if (r <= 0) return null;
      const circle = turf.circle(c.target, r, { steps: 180, units: 'kilometers' });
      return c.answer === 'closer' ? circle : invert(circle);
    }
    case 'nearest': {
      if (c.answer === 'unreachable') {
        const circle = turf.circle(c.seeker, c.radiusM / 1000, { steps: 180, units: 'kilometers' });
        return invert(circle);
      }
      const cell = voronoiCell(c.points, c.index);
      if (!cell) return null;
      let poly = c.answer === 'no' ? invert(cell) : cell;
      if (c.radiusM && c.seeker) {
        const circle = turf.circle(c.seeker, c.radiusM / 1000, { steps: 180, units: 'kilometers' });
        poly = gIntersect(poly, circle);
      }
      return poly;
    }
    case 'zone':
    case 'area': {
      const poly = c.geometry ? turf.feature(c.geometry) : null;
      if (!poly) return null;
      return c.answer === 'yes' ? poly : invert(poly);
    }
    default:
      return null;
  }
}

function constraintLabel(c) {
  switch (c.type) {
    case 'radar':
      return { kind: 'Radar', text: `Within ${fmtDist(c.radiusM)} of the seeker`, ans: c.answer === 'yes' ? 'Yes' : 'No' };
    case 'thermometer':
      return { kind: 'Thermometer', text: `Moved ${fmtDist(c.travelM)}`, ans: c.answer === 'hotter' ? 'Hotter' : 'Colder' };
    case 'measuring':
      return { kind: 'Measuring', text: `Compared to seeker, vs ${c.targetName || 'target'}`, ans: c.answer === 'closer' ? 'Closer' : 'Further' };
    case 'nearest':
      if (c.answer === 'unreachable') return { kind: 'Tentacle', text: `Nothing within ${fmtDist(c.radiusM)}`, ans: 'Out of reach' };
      return { kind: c.radiusM ? 'Tentacle' : 'Matching', text: c.categoryName || 'Nearest point', ans: c.answer === 'no' ? 'Not a match' : (c.pointName || 'Match') };
    case 'zone':
      return { kind: 'Zone', text: c.zoneName || 'Zone', ans: c.answer === 'yes' ? 'Same zone' : 'Different zone' };
    case 'area':
      return { kind: 'Free shape', text: c.name || 'Hand-drawn area', ans: c.answer === 'yes' ? 'Inside' : 'Outside' };
    default:
      return { kind: '?', text: '', ans: '' };
  }
}

/* ---------- map ---------------------------------------------------- */

const map = L.map('map', {
  center: CONFIG.center,
  zoom: CONFIG.zoom,
  zoomControl: false,
  attributionControl: true
});
L.control.zoom({ position: 'topright' }).addTo(map);

map.createPane('zonePane');   map.getPane('zonePane').style.zIndex = 410;
map.createPane('fogPane');    map.getPane('fogPane').style.zIndex = 430;
map.createPane('evidPane');   map.getPane('evidPane').style.zIndex = 450;
map.createPane('drawPane');   map.getPane('drawPane').style.zIndex = 470;

const BASES = {
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }),
  streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery &copy; Esri'
  })
};
BASES.light.addTo(map);

const fogLayer = L.layerGroup([], { pane: 'fogPane' }).addTo(map);
const evidLayer = L.layerGroup([], { pane: 'evidPane' }).addTo(map);
const drawLayer = L.layerGroup([], { pane: 'drawPane' }).addTo(map);
let meMarker = null;

/* ---------- play area ---------------------------------------------- */

function setCircularPlayArea(centerLatLng, radiusKm) {
  const c = [centerLatLng.lng ?? centerLatLng[1], centerLatLng.lat ?? centerLatLng[0]];
  S.playArea = turf.circle(c, radiusKm, { steps: 256, units: 'kilometers' });
  S.playAreaMeta = { type: 'circle', center: c, radiusKm };
  recompute();
}

function setCustomPlayArea(feature, name) {
  S.playArea = turf.feature(feature.geometry);
  S.playAreaMeta = { type: 'custom', name, geometry: feature.geometry };
  recompute();
  map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [30, 30] });
}

/* ---------- the core: intersect everything, shade the rest ---------- */

function recompute() {
  if (!S.playArea) return;

  let possible = turf.clone(S.playArea);
  let dead = false;

  for (const c of S.constraints) {
    if (!c.active) continue;
    const poly = constraintPolygon(c);
    if (!poly) { c.error = true; continue; }
    c.error = false;
    possible = gIntersect(possible, poly);
    if (!possible) { dead = true; break; }
  }

  drawFog(possible);
  drawEvidence();
  updateHud(possible, dead);
  renderLog();
  saveToUrl();
}

function drawFog(possible) {
  fogLayer.clearLayers();
  const outside = possible ? gDifference(worldRect(), possible) : worldRect();

  if (outside) {
    L.geoJSON(outside, {
      pane: 'fogPane',
      style: { color: 'transparent', weight: 0, fillColor: '#060c14', fillOpacity: S.fogOpacity, interactive: false }
    }).addTo(fogLayer);
  }
  if (possible) {
    L.geoJSON(possible, {
      pane: 'fogPane',
      style: { color: '#2ee6a8', weight: 2.5, opacity: .95, fill: false, interactive: false }
    }).addTo(fogLayer);
  }
  // play-area boundary, always visible as a faint hairline
  L.geoJSON(S.playArea, {
    pane: 'fogPane',
    style: { color: '#ffffff', weight: 1, opacity: .35, dashArray: '3 5', fill: false, interactive: false }
  }).addTo(fogLayer);
}

/* Thin outlines showing what each answer actually did. */
function drawEvidence() {
  evidLayer.clearLayers();
  const A = '#ffb020';

  for (const c of S.constraints) {
    if (!c.active) continue;

    if (c.type === 'radar') {
      L.circle([c.center[1], c.center[0]], {
        pane: 'evidPane', radius: c.radiusM,
        color: A, weight: 1.6, opacity: .9, dashArray: c.answer === 'yes' ? null : '5 4', fill: false, interactive: false
      }).addTo(evidLayer);
      dot(c.center, A);
    }
    if (c.type === 'thermometer') {
      L.polyline([[c.a[1], c.a[0]], [c.b[1], c.b[0]]], {
        pane: 'evidPane', color: A, weight: 2, opacity: .9, interactive: false
      }).addTo(evidLayer);
      dot(c.a, A, true); dot(c.b, A);
    }
    if (c.type === 'measuring') {
      dot(c.target, A);
      dot(c.seeker, A, true);
      L.polyline([[c.seeker[1], c.seeker[0]], [c.target[1], c.target[0]]], {
        pane: 'evidPane', color: A, weight: 1.2, opacity: .6, dashArray: '3 4', interactive: false
      }).addTo(evidLayer);
    }
    if (c.type === 'nearest' && c.points) {
      c.points.forEach((p, i) => dot(p, i === c.index && c.answer !== 'no' ? '#2ee6a8' : A, i !== c.index));
      if (c.radiusM && c.seeker) {
        L.circle([c.seeker[1], c.seeker[0]], {
          pane: 'evidPane', radius: c.radiusM, color: A, weight: 1.2, opacity: .55, dashArray: '4 4', fill: false, interactive: false
        }).addTo(evidLayer);
      }
    }
  }

  function dot(coord, color, hollow) {
    L.circleMarker([coord[1], coord[0]], {
      pane: 'evidPane', radius: 4.5, color, weight: 2,
      fillColor: hollow ? '#0d141d' : color, fillOpacity: 1, interactive: false
    }).addTo(evidLayer);
  }
}

function updateHud(possible, dead) {
  const hud = $('#hud');
  const total = turf.area(S.playArea) / 1e6;
  const left = possible ? turf.area(possible) / 1e6 : 0;

  hud.classList.toggle('is-dead', !!dead || left === 0);
  $('#hudArea').textContent = dead || left === 0 ? '0'
    : left < 1 ? left.toFixed(2)
    : left < 100 ? left.toFixed(1)
    : Math.round(left).toString();
  $('#hudPct').textContent = total ? `${((left / total) * 100).toFixed(left / total < 0.01 ? 2 : 0)}%` : '—';
  $('#hudCount').textContent = S.constraints.filter((c) => c.active).length;

  if (dead) toastOnce('No area left. One of the answers must be logged wrong — toggle them off in the Log to find it.', true);
}
let _deadShown = false;
function toastOnce(msg, bad) {
  if (_deadShown) return;
  _deadShown = true;
  toast(msg, bad);
  setTimeout(() => { _deadShown = false; }, 6000);
}

/* ---------- point picking ------------------------------------------ */

const picker = { slot: null, onPick: null };

function beginPick(slotEl, onPick) {
  $$('.slot').forEach((s) => s.classList.remove('is-picking'));
  slotEl.classList.add('is-picking');
  picker.slot = slotEl;
  picker.onPick = onPick;
  if (window.innerWidth <= 820) closeSheet();
}
function endPick() {
  if (picker.slot) picker.slot.classList.remove('is-picking');
  picker.slot = null; picker.onPick = null;
}

map.on('click', (e) => {
  const coord = [e.latlng.lng, e.latlng.lat];
  if (drawing.on) { drawing.push(coord); return; }
  if (picker.onPick) {
    const fn = picker.onPick;
    endPick();
    fn(coord);
    if (window.innerWidth <= 820) openSheet();
  }
});

/* ---------- freehand polygon drawing -------------------------------- */

const drawing = { on: false, pts: [], done: null, label: '' };

function startDrawing(label, done) {
  drawing.on = true; drawing.pts = []; drawing.done = done; drawing.label = label;
  $('#drawHintText').textContent = label;
  $('#drawHint').hidden = false;
  $('#drawFinish').disabled = true;
  drawLayer.clearLayers();
  if (window.innerWidth <= 820) closeSheet();
}
drawing.push = function (coord) {
  drawing.pts.push(coord);
  $('#drawFinish').disabled = drawing.pts.length < 3;
  renderDrawing();
};
function renderDrawing() {
  drawLayer.clearLayers();
  const latlngs = drawing.pts.map((p) => [p[1], p[0]]);
  if (latlngs.length >= 2) {
    L.polygon(latlngs, { pane: 'drawPane', color: '#ffb020', weight: 2, fillOpacity: .12, interactive: false }).addTo(drawLayer);
  }
  latlngs.forEach((ll) => L.circleMarker(ll, {
    pane: 'drawPane', radius: 4, color: '#ffb020', fillColor: '#0d141d', fillOpacity: 1, weight: 2, interactive: false
  }).addTo(drawLayer));
}
function stopDrawing() {
  drawing.on = false; drawing.pts = []; drawing.done = null;
  $('#drawHint').hidden = true;
  drawLayer.clearLayers();
}
$('#drawUndo').addEventListener('click', () => {
  drawing.pts.pop();
  $('#drawFinish').disabled = drawing.pts.length < 3;
  renderDrawing();
});
$('#drawFinish').addEventListener('click', () => {
  if (drawing.pts.length < 3) return;
  const ring = drawing.pts.concat([drawing.pts[0]]);
  const poly = turf.polygon([ring]);
  const cb = drawing.done;
  stopDrawing();
  if (cb) cb(poly);
  if (window.innerWidth <= 820) openSheet();
});

/* ---------- tool forms ---------------------------------------------- */

let activeTool = null;
const draft = {};

const TOOLS = {
  radar: {
    title: 'Radar',
    q: '“Are you within ___ of me?”',
    build: radarForm
  },
  thermometer: {
    title: 'Thermometer',
    q: '“After travelling ___, am I hotter or colder?”',
    build: thermoForm
  },
  measuring: {
    title: 'Measuring',
    q: '“Compared to me, are you closer to or further from ___?”',
    build: measuringForm
  },
  nearest: {
    title: 'Matching / tentacles',
    q: '“Is your nearest ___ the same as mine?”',
    build: nearestForm
  },
  zone: {
    title: 'Zone match',
    q: 'Same district, parish or postal code as the seeker?',
    build: zoneForm
  },
  area: {
    title: 'Free shape',
    q: 'For photo clues, sightlines, hunches — anything you can draw.',
    build: areaForm
  }
};

$$('.tool').forEach((btn) => btn.addEventListener('click', () => selectTool(btn.dataset.tool)));

function selectTool(key) {
  if (activeTool === key) { activeTool = null; endPick(); stopDrawing(); renderToolForm(); return; }
  activeTool = key;
  for (const k of Object.keys(draft)) delete draft[k];
  endPick(); stopDrawing();
  renderToolForm();
}

function renderToolForm() {
  $$('.tool').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === activeTool));
  const box = $('#toolForm');
  const empty = $('#askEmpty');
  if (!activeTool) { box.hidden = true; box.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  box.hidden = false;
  box.innerHTML = `<p class="form-title">${TOOLS[activeTool].title}</p><p class="form-q">${TOOLS[activeTool].q}</p>`;
  TOOLS[activeTool].build(box);
}

/* Reusable point slot */
function slot(box, key, label, opts = {}) {
  const el = document.createElement('button');
  el.className = 'slot' + (draft[key] ? ' is-set' : '');
  el.innerHTML = `<span class="slot-dot"></span>
    <span class="slot-body">
      <span class="slot-label">${label}</span><br>
      <span class="slot-coord">${draft[key] ? fmtLL(draft[key]) : 'Tap, then tap the map'}</span>
    </span>
    ${opts.gps === false ? '' : '<span class="slot-gps" data-gps>GPS</span>'}`;
  el.addEventListener('click', (ev) => {
    if (ev.target.hasAttribute('data-gps')) {
      ev.stopPropagation();
      locate((coord) => { draft[key] = coord; renderToolForm(); });
      return;
    }
    beginPick(el, (coord) => { draft[key] = coord; renderToolForm(); if (opts.after) opts.after(coord); });
  });
  box.appendChild(el);
  return el;
}

function answerSeg(box, options, key = 'answer') {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = '<label>Answer</label>';
  const seg = document.createElement('div');
  seg.className = 'seg';
  options.forEach(([val, text]) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.className = draft[key] === val ? 'is-active' : '';
    b.addEventListener('click', () => { draft[key] = val; renderToolForm(); });
    seg.appendChild(b);
  });
  wrap.appendChild(seg);
  box.appendChild(wrap);
}

function actions(box, ready, onAdd) {
  const wrap = document.createElement('div');
  wrap.className = 'form-actions';
  const add = document.createElement('button');
  add.className = 'solid-btn';
  add.textContent = 'Log answer';
  add.disabled = !ready;
  add.addEventListener('click', onAdd);
  const cancel = document.createElement('button');
  cancel.className = 'ghost-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => selectTool(activeTool));
  wrap.append(add, cancel);
  box.appendChild(wrap);
}

function commit(c) {
  c.id = uid();
  c.active = true;
  S.constraints.unshift(c);
  activeTool = null;
  renderToolForm();
  recompute();
  switchTab('log');
  toast('Answer logged.');
}

/* --- radar --- */
function radarForm(box) {
  slot(box, 'center', 'Where you asked from');

  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = '<label>Radius</label>';
  const chips = document.createElement('div');
  chips.className = 'chips';
  CONFIG.radarPresets.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'chip' + (draft.radiusM === m ? ' is-active' : '');
    b.textContent = fmtDist(m);
    b.addEventListener('click', () => { draft.radiusM = m; renderToolForm(); });
    chips.appendChild(b);
  });
  f.appendChild(chips);
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '10'; inp.step = '10';
  inp.placeholder = 'or type metres';
  if (draft.radiusM) inp.value = draft.radiusM;
  inp.addEventListener('change', () => { draft.radiusM = Number(inp.value) || null; renderToolForm(); });
  f.appendChild(inp);
  box.appendChild(f);

  answerSeg(box, [['yes', 'Yes'], ['no', 'No']]);
  actions(box, draft.center && draft.radiusM && draft.answer, () =>
    commit({ type: 'radar', center: draft.center, radiusM: draft.radiusM, answer: draft.answer }));
}

/* --- thermometer --- */
function thermoForm(box) {
  slot(box, 'a', 'Start point');
  slot(box, 'b', 'End point');

  if (draft.a && draft.b) {
    const m = Math.round(turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000);
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = `You travelled ${fmtDist(m)} in a straight line.`;
    box.appendChild(p);
  }
  answerSeg(box, [['hotter', 'Hotter'], ['colder', 'Colder']]);
  actions(box, draft.a && draft.b && draft.answer, () => {
    const m = Math.round(turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000);
    commit({ type: 'thermometer', a: draft.a, b: draft.b, travelM: m, answer: draft.answer });
  });
}

/* --- measuring --- */
function measuringForm(box) {
  slot(box, 'seeker', 'Where you asked from');
  slot(box, 'target', 'The thing being measured', { gps: false });

  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = '<label>What is it?</label>';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.placeholder = 'e.g. nearest hospital';
  inp.value = draft.targetName || '';
  inp.addEventListener('input', () => { draft.targetName = inp.value; });
  f.appendChild(inp);
  box.appendChild(f);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'Drop the pin on the map icon you both measured to. Works for point features; for coastlines and borders, draw a free shape instead.';
  box.appendChild(note);

  answerSeg(box, [['closer', 'Closer'], ['further', 'Further']]);
  actions(box, draft.seeker && draft.target && draft.answer, () =>
    commit({ type: 'measuring', seeker: draft.seeker, target: draft.target, targetName: draft.targetName, answer: draft.answer }));
}

/* --- matching / tentacles (Voronoi) --- */
function nearestForm(box) {
  draft.points = draft.points || [];

  const f0 = document.createElement('div');
  f0.className = 'field';
  f0.innerHTML = '<label>Category</label>';
  const nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'e.g. museums, parks, stations';
  nameInp.value = draft.categoryName || '';
  nameInp.addEventListener('input', () => { draft.categoryName = nameInp.value; });
  f0.appendChild(nameInp);
  box.appendChild(f0);

  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = `<label>Candidate locations (${draft.points.length})</label>`;
  draft.points.forEach((p, i) => {
    const row = document.createElement('button');
    row.className = 'slot' + (draft.index === i ? ' is-set' : '');
    row.innerHTML = `<span class="slot-dot"></span>
      <span class="slot-body"><span class="slot-label">${draft.index === i ? 'Seeker’s nearest' : 'Point ' + (i + 1)}</span><br>
      <span class="slot-coord">${fmtLL(p)}</span></span>
      <span class="slot-gps" data-del>Remove</span>`;
    row.addEventListener('click', (ev) => {
      if (ev.target.hasAttribute('data-del')) {
        ev.stopPropagation();
        draft.points.splice(i, 1);
        if (draft.index === i) draft.index = null;
        else if (draft.index > i) draft.index--;
        renderToolForm();
        return;
      }
      draft.index = i; renderToolForm();
    });
    f.appendChild(row);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'ghost-btn wide';
  addBtn.textContent = 'Add a location';
  addBtn.addEventListener('click', () => {
    beginPick(addBtn, (coord) => { draft.points.push(coord); renderToolForm(); });
  });
  f.appendChild(addBtn);
  box.appendChild(f);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Add every one of these inside the play area, then tap the one nearest to you. The map splits into nearest-point territories.';
  box.appendChild(hint);

  const f2 = document.createElement('div');
  f2.className = 'field';
  f2.innerHTML = '<label>Tentacle radius (optional)</label>';
  const rin = document.createElement('input');
  rin.type = 'number'; rin.placeholder = 'metres — leave blank for a matching question';
  if (draft.radiusM) rin.value = draft.radiusM;
  rin.addEventListener('change', () => { draft.radiusM = Number(rin.value) || null; renderToolForm(); });
  f2.appendChild(rin);
  box.appendChild(f2);
  if (draft.radiusM) slot(box, 'seeker', 'Tentacle centre (you)');

  answerSeg(box, [['yes', 'Match'], ['no', 'No match']]);

  const ready = draft.points.length > 0 && draft.answer && draft.index != null &&
                (!draft.radiusM || draft.seeker);
  actions(box, ready, () => commit({
    type: 'nearest',
    points: draft.points.slice(),
    index: draft.index,
    categoryName: draft.categoryName,
    radiusM: draft.radiusM || null,
    seeker: draft.seeker || null,
    answer: draft.answer
  }));
}

/* --- zone --- */
function zoneForm(box) {
  const zones = [];
  S.zoneLayers.forEach((zl) => {
    (zl.geojson.features || []).forEach((ft, i) => zones.push({ zl, ft, i }));
  });

  if (!zones.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Load a zone layer first — see the Zones tab.';
    box.appendChild(p);
    return;
  }

  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = '<label>Which zone is the seeker in?</label>';
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">Choose a zone…</option>' + zones.map((z, i) =>
    `<option value="${i}"${String(draft.zoneIdx) === String(i) ? ' selected' : ''}>${escapeHtml(zoneName(z.ft))} — ${escapeHtml(z.zl.name)}</option>`).join('');
  sel.addEventListener('change', () => { draft.zoneIdx = sel.value; renderToolForm(); });
  f.appendChild(sel);
  box.appendChild(f);

  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'Or just tap a zone on the map to pick it.';
  box.appendChild(p);

  answerSeg(box, [['yes', 'Same zone'], ['no', 'Different zone']]);
  actions(box, draft.zoneIdx !== '' && draft.zoneIdx != null && draft.answer, () => {
    const z = zones[Number(draft.zoneIdx)];
    commit({ type: 'zone', geometry: z.ft.geometry, zoneName: zoneName(z.ft), answer: draft.answer });
  });
}

/* --- free shape --- */
function areaForm(box) {
  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = '<label>What does this shape mean?</label>';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.placeholder = 'e.g. visible from the photo';
  inp.value = draft.name || '';
  inp.addEventListener('input', () => { draft.name = inp.value; });
  f.appendChild(inp);
  box.appendChild(f);

  const b = document.createElement('button');
  b.className = 'ghost-btn wide';
  b.textContent = draft.geometry ? 'Redraw shape' : 'Draw the shape';
  b.addEventListener('click', () => startDrawing('Tap the corners of your shape', (poly) => {
    draft.geometry = poly.geometry; renderToolForm(); openSheet();
  }));
  box.appendChild(b);

  if (draft.geometry) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Shape ready.';
    box.appendChild(p);
  }

  answerSeg(box, [['yes', 'Hider is inside'], ['no', 'Hider is outside']]);
  actions(box, draft.geometry && draft.answer, () =>
    commit({ type: 'area', geometry: draft.geometry, name: draft.name, answer: draft.answer }));
}

/* ---------- log ------------------------------------------------------ */

function renderLog() {
  const list = $('#logList');
  list.innerHTML = '';
  $('#logEmpty').hidden = S.constraints.length > 0;

  S.constraints.forEach((c) => {
    const L2 = constraintLabel(c);
    const el = document.createElement('div');
    el.className = 'log-item' + (c.active ? '' : ' is-off');
    el.innerHTML = `
      <div class="log-body">
        <div class="log-kind">${L2.kind}${c.error ? ' · unusable' : ''}</div>
        <div class="log-text">${escapeHtml(L2.text)} → <span class="log-answer">${escapeHtml(L2.ans)}</span></div>
      </div>
      <div class="log-actions">
        <button class="icon-btn" data-act="toggle" title="${c.active ? 'Mute' : 'Unmute'}">${c.active ? '◉' : '○'}</button>
        <button class="icon-btn del" data-act="del" title="Delete">✕</button>
      </div>`;
    el.querySelector('[data-act=toggle]').addEventListener('click', () => {
      c.active = !c.active; recompute();
    });
    el.querySelector('[data-act=del]').addEventListener('click', () => {
      S.constraints = S.constraints.filter((x) => x.id !== c.id); recompute();
    });
    list.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ---------- zones ---------------------------------------------------- */

const ZONE_COLORS = ['#7c9cf5', '#f57cae', '#7cf5d0', '#f5d17c', '#b97cf5', '#7cf58a'];

function zoneName(ft) {
  const p = ft.properties || {};
  return p.navn || p.name || p.nr || p.kode || p.postnr || 'Zone';
}

function addZoneLayer(name, geojson) {
  const feats = (geojson.type === 'FeatureCollection' ? geojson.features : [geojson])
    .filter((f) => f && f.geometry && /Polygon/.test(f.geometry.type));
  if (!feats.length) { toast('No polygons found in that file.', true); return; }

  const color = ZONE_COLORS[S.zoneLayers.length % ZONE_COLORS.length];
  const fcol = { type: 'FeatureCollection', features: feats };

  const layer = L.geoJSON(fcol, {
    pane: 'zonePane',
    style: { color, weight: 1.4, opacity: .85, fillColor: color, fillOpacity: .05 },
    onEachFeature: (ft, lyr) => {
      lyr.bindTooltip(zoneName(ft), { className: 'zone-tip', sticky: true });
      lyr.on('click', (e) => {
        if (activeTool !== 'zone') return;
        L.DomEvent.stopPropagation(e);
        const all = [];
        S.zoneLayers.forEach((zl) => (zl.geojson.features || []).forEach((f2) => all.push(f2)));
        const idx = all.findIndex((f2) => f2 === ft);
        if (idx >= 0) { draft.zoneIdx = String(idx); renderToolForm(); openSheet(); }
      });
    }
  }).addTo(map);

  const rec = { id: uid(), name, color, geojson: fcol, layer, visible: true };
  S.zoneLayers.push(rec);
  renderZoneLayers();
  toast(`${name}: ${feats.length} zones loaded.`);
}

function renderZoneLayers() {
  const box = $('#zoneLayers');
  box.innerHTML = '';
  S.zoneLayers.forEach((zl) => {
    const row = document.createElement('div');
    row.className = 'zone-row';
    row.innerHTML = `<span class="zone-swatch" style="background:${zl.color}"></span>
      <span class="zone-name">${escapeHtml(zl.name)}</span>
      <span class="zone-count">${zl.geojson.features.length}</span>
      <button class="icon-btn" data-act="vis">${zl.visible ? '◉' : '○'}</button>
      <button class="icon-btn del" data-act="del">✕</button>`;
    row.querySelector('[data-act=vis]').addEventListener('click', () => {
      zl.visible = !zl.visible;
      if (zl.visible) zl.layer.addTo(map); else map.removeLayer(zl.layer);
      renderZoneLayers();
    });
    row.querySelector('[data-act=del]').addEventListener('click', () => {
      map.removeLayer(zl.layer);
      S.zoneLayers = S.zoneLayers.filter((x) => x.id !== zl.id);
      renderZoneLayers();
    });
    box.appendChild(row);
  });
}

async function loadDawa(kind, btn) {
  const urls = {
    postnumre: `${CONFIG.dawa}/postnumre?kommunekode=${CONFIG.kommunekode}&format=geojson&landpostnumre`,
    sogne: `${CONFIG.dawa}/sogne?kommunekode=${CONFIG.kommunekode}&format=geojson`,
    kommune: `${CONFIG.dawa}/kommuner/0${CONFIG.kommunekode}?format=geojson`
  };
  const names = { postnumre: 'Postal districts', sogne: 'Parishes', kommune: 'Aalborg Kommune' };
  const status = $('#zoneStatus');
  btn.classList.add('is-busy');
  status.hidden = false; status.classList.remove('is-bad');
  status.textContent = 'Fetching from Dataforsyningen…';
  try {
    const res = await fetch(urls[kind]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const gj = await res.json();
    addZoneLayer(names[kind], gj);
    status.hidden = true;
  } catch (err) {
    status.classList.add('is-bad');
    status.textContent = 'Could not reach Dataforsyningen. Download the GeoJSON on a laptop and load it with “Load a GeoJSON file” — the URL is in the README.';
  } finally {
    btn.classList.remove('is-busy');
  }
}

$$('[data-load]').forEach((b) => b.addEventListener('click', () => loadDawa(b.dataset.load, b)));

$('#zoneFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try { addZoneLayer(file.name.replace(/\.(geo)?json$/i, ''), JSON.parse(r.result)); }
    catch (_) { toast('That file is not valid GeoJSON.', true); }
  };
  r.readAsText(file);
  e.target.value = '';
});

$('#drawZoneBtn').addEventListener('click', () => {
  startDrawing('Tap the corners of the zone', (poly) => {
    const name = prompt('Name this zone', 'My zone') || 'My zone';
    poly.properties = { navn: name };
    addZoneLayer(name, { type: 'FeatureCollection', features: [poly] });
    openSheet();
  });
});

/* ---------- geolocation ---------------------------------------------- */

function locate(cb) {
  if (!navigator.geolocation) { toast('This browser has no location access.', true); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coord = [pos.coords.longitude, pos.coords.latitude];
      S.me = coord;
      showMe(coord, pos.coords.accuracy);
      if (cb) cb(coord);
    },
    () => toast('Could not get your location. Check location permission for this page.', true),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
  );
}

function showMe(coord, acc) {
  if (meMarker) map.removeLayer(meMarker);
  meMarker = L.layerGroup([
    L.circle([coord[1], coord[0]], { radius: Math.min(acc || 40, 200), color: '#2ee6a8', weight: 1, fillColor: '#2ee6a8', fillOpacity: .12 }),
    L.circleMarker([coord[1], coord[0]], { radius: 6, color: '#0d141d', weight: 2.5, fillColor: '#2ee6a8', fillOpacity: 1 })
  ]).addTo(map);
}

$('#locateBtn').addEventListener('click', () => locate((c) => map.setView([c[1], c[0]], Math.max(map.getZoom(), 15))));

/* ---------- tabs & sheet ---------------------------------------------- */

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
}
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

const panel = $('#panel');
const sheetBtn = $('#sheetToggle');
function openSheet() { panel.classList.add('is-open'); sheetBtn.setAttribute('aria-expanded', 'true'); }
function closeSheet() { panel.classList.remove('is-open'); sheetBtn.setAttribute('aria-expanded', 'false'); }
sheetBtn.addEventListener('click', () => panel.classList.contains('is-open') ? closeSheet() : openSheet());

/* ---------- game settings --------------------------------------------- */

$('#applyRadius').addEventListener('click', () => {
  const km = Number($('#playRadius').value);
  if (!km || km <= 0) return;
  setCircularPlayArea(map.getCenter(), km);
  toast(`Play area set: ${km} km around the map centre.`);
});

$('#playAreaKommune').addEventListener('click', async () => {
  try {
    const res = await fetch(`${CONFIG.dawa}/kommuner/0${CONFIG.kommunekode}?format=geojson`);
    const gj = await res.json();
    const ft = gj.type === 'FeatureCollection' ? gj.features[0] : gj;
    setCustomPlayArea(ft, 'Aalborg Kommune');
    toast('Play area set to Aalborg Kommune.');
  } catch (_) {
    toast('Could not fetch the municipality outline.', true);
  }
});

$('#baseSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  Object.values(BASES).forEach((l) => map.removeLayer(l));
  BASES[b.dataset.base].addTo(map);
  S.baseKey = b.dataset.base;
  $$('#baseSeg button').forEach((x) => x.classList.toggle('is-active', x === b));
});

$('#fogRange').addEventListener('input', (e) => {
  S.fogOpacity = Number(e.target.value) / 100;
  recompute();
});

$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Delete every logged answer?')) return;
  S.constraints = [];
  recompute();
  toast('Cleared.');
});

/* ---------- save / share ----------------------------------------------- */

function serialize() {
  return {
    v: 1,
    playAreaMeta: S.playAreaMeta,
    base: S.baseKey,
    fog: S.fogOpacity,
    constraints: S.constraints.map((c) => {
      const o = Object.assign({}, c);
      delete o.error;
      if (o.geometry) {
        try { o.geometry = turf.simplify(turf.feature(o.geometry), { tolerance: 0.0004, highQuality: false }).geometry; }
        catch (_) { /* keep as-is */ }
      }
      return o;
    })
  };
}

function deserialize(data) {
  if (!data || !data.constraints) return false;
  S.constraints = data.constraints;
  S.seq = S.constraints.length + 1;
  if (typeof data.fog === 'number') { S.fogOpacity = data.fog; $('#fogRange').value = Math.round(data.fog * 100); }
  const m = data.playAreaMeta;
  if (m && m.type === 'circle') {
    S.playArea = turf.circle(m.center, m.radiusKm, { steps: 256, units: 'kilometers' });
    S.playAreaMeta = m;
    $('#playRadius').value = m.radiusKm;
  } else if (m && m.type === 'custom' && m.geometry) {
    S.playArea = turf.feature(m.geometry);
    S.playAreaMeta = m;
  }
  recompute();
  try { map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [24, 24] }); } catch (_) {}
  return true;
}

function b64encode(str) {
  return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

let _saveTimer = null;
function saveToUrl() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const s = b64encode(JSON.stringify(serialize()));
      if (s.length < 30000) history.replaceState(null, '', '#g=' + s);
    } catch (_) { /* not fatal */ }
  }, 400);
}

function loadFromUrl() {
  const h = location.hash;
  if (!h.startsWith('#g=')) return false;
  try { return deserialize(JSON.parse(b64decode(h.slice(3)))); }
  catch (_) { return false; }
}

$('#copyLink').addEventListener('click', async () => {
  const url = location.href;
  try { await navigator.clipboard.writeText(url); toast('Link copied. Send it to your co-seeker.'); }
  catch (_) { prompt('Copy this link:', url); }
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hideseek-aalborg-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      if (deserialize(JSON.parse(r.result))) toast('Game loaded.');
      else toast('That file has no game in it.', true);
    } catch (_) { toast('Could not read that file.', true); }
  };
  r.readAsText(file);
  e.target.value = '';
});

/* ---------- boot -------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drawing.on) { stopDrawing(); return; }
  if (picker.slot) { endPick(); return; }
  if (activeTool) selectTool(activeTool);
});

setCircularPlayArea(L.latLng(CONFIG.center[0], CONFIG.center[1]), CONFIG.playRadiusKm);
if (!loadFromUrl()) recompute();
renderToolForm();

/* Exposed so you can poke at a live game from the browser console:
   HS.S.constraints, HS.map.setView(...), HS.addZoneLayer('Bus zones', geojson) … */
window.HS = {
  map, S, CONFIG, draft, drawing,
  recompute, addZoneLayer, setCircularPlayArea, setCustomPlayArea,
  serialize, deserialize, b64encode, b64decode,
  constraintPolygon, halfPlane, voronoiCell
};
