/* =============================================================
   Hide + Seek — Aalborg seeker map
   Every answered question becomes a polygon of "places the hider
   could still be". We intersect them all and shade the rest away.
   ============================================================= */

'use strict';

const FT = 0.3048;          // metres per foot
const MI = 1609.344;        // metres per mile

const CONFIG = {
  center: [57.0488, 9.9217],
  zoom: 12,
  playRadiusMi: 6,
  kommunekode: '851',       // Aalborg
  komnr: 851,
  dawa: 'https://api.dataforsyningen.dk'
};

/* Radar values from the US deck, plus the short ones a city game needs.
   Stored in metres; the label is what actually gets shown. */
const RADAR_PRESETS = [
  { label: '250 ft',  m: 250 * FT },
  { label: '500 ft',  m: 500 * FT },
  { label: '1000 ft', m: 1000 * FT },
  { label: '1500 ft', m: 1500 * FT },
  { label: '¼ mi',    m: 0.25 * MI },
  { label: '½ mi',    m: 0.5 * MI },
  { label: '1 mi',    m: 1 * MI },
  { label: '3 mi',    m: 3 * MI },
  { label: '5 mi',    m: 5 * MI }
];

/* ---------- data sources ------------------------------------------
   All of these are editable in the Layers tab, because a service can
   rename a layer and you do not want to be editing code on a bus.  */

const PLANDATA = 'https://geoserver.plandata.dk/geoserver/wfs';

/* Aalborg's own WebGIS. Its WFS is the real source for zones 2 and 3 — the
   traced outlines are only a stand-in. If your browser can reach it, use it:
   live geometry needs no tracing and no placement, because it arrives with
   real coordinates. */
const KORTINFO = 'https://drift.kortinfo.net/Wfs.aspx?Site=Aalborg&Page=kortHjemmeside';
const SOURCE_CONFIG_VERSION = 2;

const DEFAULT_SOURCES = {
  zone1: {
    name: 'Zone 1 · Byzone / Landzone',
    note: 'Official Aalborg KortInfo layer TL1433667.',
    kind: 'wfs', url: KORTINFO,
    typeName: 'ugis:TL1433667', cql: '', nameField: '', style: 'zonekort'
  },
  zone2: {
    name: 'Zone 2 · Midtbyen / Nørresundby / Vest / Øst',
    note: 'Official Aalborg KortInfo layer TL445984. Its four named polygons define the default play area.',
    kind: 'wfs', url: KORTINFO,
    typeName: 'ugis:TL445984', cql: '', nameField: '', style: 'areas'
  },
  zone3: {
    name: 'Zone 3 · By- og bydele',
    note: 'Official Aalborg KortInfo layer TL445987. District names are auto-detected instead of using its Zone 2 parent field.',
    kind: 'wfs', url: KORTINFO,
    typeName: 'ugis:TL445987', cql: '', nameField: '', style: 'plain'
  },
  zone4: {
    name: 'Zone 4 · Kommuneplanrammer',
    note: 'Official Aalborg KortInfo layer TL445981. Uncovered or unclassified land is shown as X · Uden kommuneplanramme.',
    kind: 'wfs', url: KORTINFO,
    typeName: 'ugis:TL445981', cql: '', nameField: '', style: 'rammer'
  }
};

/* ---------- categorical styling ------------------------------------
   Zone 1 needs byzone and landzone to be told apart at a glance, and
   zone 4 uses the municipality's own land-use legend.                */

const ZONEKORT_STYLE = [
  { key: 'byzone',           label: 'Byzone (city)',    color: '#e0554f' },
  { key: 'landzone',         label: 'Landzone (rural)', color: '#4fae5a' },
  { key: 'sommerhusområde',  label: 'Sommerhusområde',  color: '#e8a33d' }
];
const ZONEKORT_LAND = ZONEKORT_STYLE[1];

const RAMME_STYLE = [
  { key: 'D', match: 'blandet bolig',        label: 'D · Blandet bolig og erhverv', color: '#f0c4df' },
  { key: 'H', match: 'let erhverv',          label: 'H · Let erhvervsområde',       color: '#c0c1de' },
  { key: 'M', match: 'særlige virksomheder', label: 'M · Særlige virksomheder',     color: '#5757a5' },
  { key: 'O', match: 'offentlig service',    label: 'O · Offentlig service',        color: '#f2efa2' },
  { key: 'T', match: 'tekniske anlæg',       label: 'T · Tekniske anlæg',           color: '#c9c9c9' },
  { key: 'S', match: 'sommerhus',            label: 'S · Sommerhusområde',          color: '#f5dcc7' },
  { key: 'G', match: 'råstof',               label: 'G · Råstofområde',             color: '#f0da9a' },
  { key: 'R', match: 'rekreativt',           label: 'R · Rekreativt område',        color: '#7cbd6d' },
  { key: 'C', match: 'centerområde',         label: 'C · Centerområde',             color: '#8e5fa8' },
  { key: 'I', match: 'industriområde',       label: 'I · Industriområde',           color: '#4a93d2' },
  { key: 'L', match: 'landsby',              label: 'L · Landsby',                  color: '#a5714e' },
  { key: 'B', match: 'boligområde',          label: 'B · Boligområde',              color: '#f0a184' }
];
/* A real, selectable Zone 4 category for everything inside the play area that
   is not covered by a recognised kommuneplanramme. X is unused by Aalborg's
   official land-use letters, so it cannot be confused with a real category. */
const RAMME_OTHER = {
  key: 'X', label: 'X · Uden kommuneplanramme', color: '#566b7f'
};
const RAMME_LEGEND = [...RAMME_STYLE, RAMME_OTHER];

/* Which land-use category a kommuneplanramme belongs to. Services differ on
   field names, so try the words first, then the letter buried in the plan
   number (Aalborg numbers rammer like "1.1.C2"). */
function rammeCategory(props) {
  if (props && props.__zone4Other) return RAMME_OTHER;
  const vals = Object.values(props || {}).filter((v) => typeof v === 'string');
  const hay = vals.join(' | ').toLowerCase();
  for (const c of RAMME_STYLE) if (hay.includes(c.match)) return c;

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    const str = String(v).trim();
    if (/^[BCDGHILMORST]$/.test(str) && /anvend|kategori|type|ramme/i.test(k)) {
      return RAMME_STYLE.find((c) => c.key === str) || null;
    }
  }
  for (const v of vals) {
    const m = v.match(/(?:^|[.\s_-])([BCDGHILMORST])\s?\d/);
    if (m) return RAMME_STYLE.find((c) => c.key === m[1]) || RAMME_OTHER;
  }
  return RAMME_OTHER;
}

function zonekortCategory(props) {
  const hay = Object.values(props || {}).filter((v) => typeof v === 'string')
    .join(' | ').toLowerCase();
  // Check byzone and sommerhus first; anything else is landzone.
  for (const c of ZONEKORT_STYLE) if (c.key !== 'landzone' && hay.includes(c.key)) return c;
  if (hay.includes('landzone')) return ZONEKORT_LAND;
  const z = props && (props.zone ?? props.zonekode);
  if (z != null && ZONEKORT_STYLE[Number(z) - 1]) return ZONEKORT_STYLE[Number(z) - 1];
  // Plandata's zonekort often ships only byzone and sommerhus polygons —
  // landzone is the default status, so treat unlabelled areas as landzone
  // rather than leaving them uncoloured.
  return ZONEKORT_LAND;
}

function categoryFor(styleKey, props) {
  if (styleKey === 'rammer') return rammeCategory(props);
  if (styleKey === 'zonekort') return zonekortCategory(props);
  if (styleKey === 'areas') return areaCategory(props);
  return null;
}

/* NT's route map runs on GC2, which exposes every layer over SQL and WMS. */
const GC2 = 'https://nt.vidi.gc2.io';

/* NT's own feed needs credentials we don't have, so the routes that
   actually load come from OpenStreetMap via Overpass. Aalborg's city and
   regional buses are mapped there as route relations with a `ref` (the
   line number), which is exactly what the transit question needs. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const OVERPASS_BBOX = [56.94, 9.70, 57.18, 10.25];   // S, W, N, E — greater Aalborg

const ROUTE_SOURCES = {
  bus:   { name: 'Bus routes', meta: 'OpenStreetMap · tappable', kind: 'overpass',
           filter: '["route"="bus"]' },
  train: { name: 'Train lines', meta: 'OpenStreetMap · tappable', kind: 'overpass',
           filter: '["route"~"^(train|light_rail)$"]' },
  ntgc2: { name: 'NT route data (if open)', meta: 'rutekortweb · often needs a login',
           kind: 'gc2', table: 'rutekortweb.ntmap_bybus_murl' }
};

const WMS_PRESETS = [
  { name: 'NT route map', url: `${GC2}/wms/nt/rutekortweb`,
    layers: 'ntmap_bybus_murl,ntmap_regionalbus_murl,ntmap_xbus_murl,ntmap_lokalbus_murl,ntmap_tog_murl' }
];

/* ---------- state -------------------------------------------------- */

const S = {
  units: 'imperial',
  playArea: null,
  playAreaMeta: null,
  constraints: [],
  layers: [],            // {id,name,color,kind:'poly'|'line',geojson,layer,visible}
  wms: [],               // {id,name,url,layers,visible,leaflet,opacity}
  sources: JSON.parse(JSON.stringify(DEFAULT_SOURCES)),
  zone2Official: null, // cached official Zone 2 geometry used by the play area
  cal: null,          // where the traced zones sit on the map
  calMode: false,     // dragging the overlay rather than the map
  roadIndex: null,    // loaded road network, for boundary snapping
  snapOn: false,      // whether boundaries are snapped to it
  snapM: 70,          // how far a boundary point may be pulled
  renames: {},        // district index -> your own name
  me: null,
  baseKey: 'light',
  fogOpacity: 0.62,
  seq: 1
};

/* ---------- helpers ------------------------------------------------ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => 'c' + (S.seq++) + Math.random().toString(36).slice(2, 6);

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('is-bad', !!bad);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 4200);
}

const fmtLL = (c) => c ? `${c[1].toFixed(5)}, ${c[0].toFixed(5)}` : '';

function trimNum(s) {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/* Distance, in whatever units the deck uses. */
function fmtDist(m) {
  if (m == null) return '';
  if (S.units === 'metric') {
    return m < 1000 ? `${Math.round(m)} m` : `${trimNum((m / 1000).toFixed(2))} km`;
  }
  const ft = m / FT;
  if (ft < 1000) return `${Math.round(ft / 5) * 5} ft`;
  const mi = m / MI;
  return `${trimNum(mi < 10 ? mi.toFixed(2) : mi.toFixed(1))} mi`;
}

/* Area for the headline readout: [number, unit label]. */
function fmtArea(m2) {
  const metric = S.units === 'metric';
  const v = metric ? m2 / 1e6 : m2 / (MI * MI);
  const unit = metric ? 'km²' : 'mi²';
  if (v === 0) return ['0', unit];
  const n = v >= 100 ? Math.round(v).toString()
          : v >= 10 ? v.toFixed(1)
          : v >= 1 ? v.toFixed(2)
          : v.toFixed(3);
  return [n, unit];
}

/* Text input → metres. Small box is feet (or metres); big box is miles (or km). */
const smallToM = (n) => S.units === 'metric' ? n : n * FT;
const mToSmall = (m) => S.units === 'metric' ? m : m / FT;
const bigToM   = (n) => S.units === 'metric' ? n * 1000 : n * MI;
const mToBig   = (m) => S.units === 'metric' ? m / 1000 : m / MI;
const smallUnit = () => S.units === 'metric' ? 'm' : 'ft';
const bigUnit   = () => S.units === 'metric' ? 'km' : 'mi';

function boolOp(fn, a, b) {
  if (!a || !b) return null;
  try {
    const r = fn(turf.featureCollection([a, b]));
    if (r !== undefined) return r;
  } catch (_) { /* older signature */ }
  try { return fn(a, b) || null; } catch (_) { return null; }
}
const gIntersect = (a, b) => boolOp(turf.intersect, a, b);
const gDifference = (a, b) => boolOp(turf.difference, a, b);

function playSpanKm() {
  if (!S.playArea) return 25;
  const bb = turf.bbox(S.playArea);
  return Math.max(5, turf.distance(turf.point([bb[0], bb[1]]), turf.point([bb[2], bb[3]]),
                                   { units: 'kilometers' }));
}

function worldRect() {
  const bb = turf.bbox(S.playArea || turf.point(CONFIG.center.slice().reverse()));
  const d = Math.max(1.5, (bb[2] - bb[0]), (bb[3] - bb[1])) * 2 + 1;
  return turf.polygon([[
    [bb[0] - d, bb[1] - d], [bb[2] + d, bb[1] - d],
    [bb[2] + d, bb[3] + d], [bb[0] - d, bb[3] + d], [bb[0] - d, bb[1] - d]
  ]]);
}

/* The perpendicular bisector is a great circle, so walk it in steps.
   Over a few hundred km a single chord bows far enough off the true
   bisector to put the wrong half of the map back in play. */
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
        poly = gIntersect(poly, turf.circle(c.seeker, c.radiusM / 1000, { steps: 180, units: 'kilometers' }));
      }
      return poly;
    }
    case 'transit': {
      let buf;
      try {
        buf = turf.buffer(turf.feature(c.geometry), c.bufferM / 1000,
                          { units: 'kilometers', steps: 8 });
      } catch (_) { return null; }
      if (!buf) return null;
      return c.answer === 'yes' ? buf : invert(buf);
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
      return { kind: 'Radar', text: `Within ${c.label || fmtDist(c.radiusM)} of the seeker`,
               ans: c.answer === 'yes' ? 'Yes' : 'No' };
    case 'thermometer':
      return { kind: 'Thermometer', text: `Moved ${fmtDist(c.travelM)}`,
               ans: c.answer === 'hotter' ? 'Hotter' : 'Colder' };
    case 'measuring':
      return { kind: 'Measuring', text: `Compared to seeker, vs ${c.targetName || 'target'}`,
               ans: c.answer === 'closer' ? 'Closer' : 'Further' };
    case 'nearest':
      if (c.answer === 'unreachable')
        return { kind: 'Tentacle', text: `Nothing within ${fmtDist(c.radiusM)}`, ans: 'Out of reach' };
      return { kind: c.radiusM ? 'Tentacle' : 'Matching', text: c.categoryName || 'Nearest point',
               ans: c.answer === 'no' ? 'Not a match' : (c.pointName || 'Match') };
    case 'transit':
      return { kind: 'Transit line', text: `${c.lineName || 'Route'} · ${fmtDist(c.bufferM)} either side`,
               ans: c.answer === 'yes' ? 'Same route' : 'Different route' };
    case 'zone':
      return { kind: 'Zone', text: c.zoneName || 'Zone',
               ans: c.answer === 'yes' ? 'Same zone' : 'Different zone' };
    case 'area':
      return { kind: 'Free shape', text: c.name || 'Hand-drawn area',
               ans: c.answer === 'yes' ? 'Inside' : 'Outside' };
    default:
      return { kind: '?', text: '', ans: '' };
  }
}

/* ---------- map ---------------------------------------------------- */

const map = L.map('map', {
  center: CONFIG.center, zoom: CONFIG.zoom, zoomControl: false
});
L.control.zoom({ position: 'topright' }).addTo(map);

map.createPane('wmsPane');    map.getPane('wmsPane').style.zIndex = 350;
map.createPane('zonePane');   map.getPane('zonePane').style.zIndex = 410;
map.createPane('fogPane');    map.getPane('fogPane').style.zIndex = 430;
map.createPane('evidPane');   map.getPane('evidPane').style.zIndex = 450;
map.createPane('drawPane');   map.getPane('drawPane').style.zIndex = 470;

const BASES = {
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }),
  streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery &copy; Esri' })
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
  refreshDerivedLayers();
  recompute();
}

function setCustomPlayArea(feature, name) {
  S.playArea = turf.feature(feature.geometry);
  S.playAreaMeta = { type: 'custom', name, geometry: feature.geometry };
  refreshDerivedLayers();
  recompute();
  try { map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [30, 30] }); } catch (_) {}
}

/* The default: the outline of the four play zones. */
function setZonesPlayArea(fit) {
  const hull = zonesPlayArea();
  if (!hull) return false;
  S.playArea = turf.feature(hull.geometry);
  S.playAreaMeta = { type: 'zones', source: hasOfficialZonesPlayArea() ? 'kortinfo' : 'fallback' };
  refreshDerivedLayers();
  recompute();
  if (fit !== false) {
    try { map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [20, 20] }); } catch (_) {}
  }
  return true;
}

/* Built-in zone layers are clipped to the play area, so they must be
   rebuilt whenever it moves. Same for the landzone backdrop. */
function refreshDerivedLayers() {
  for (const rec of S.layers.slice()) {
    let gj = null;
    if (rec.derived) gj = rec.derived === 'areas' ? buildAreaZones() : buildDistrictZones();
    else if (rec.baseGeojson && ['zonekort', 'rammer'].includes(rec.style)) gj = rec.baseGeojson;
    if (!gj) continue;
    const wasVisible = rec.visible;
    const fresh = addLayer(rec.name, gj, {
      key: rec.key, nameField: rec.nameField, style: rec.style, derived: rec.derived,
      sourceKey: rec.sourceKey, baseGeojson: rec.baseGeojson || gj
    });
    if (fresh && !wasVisible) setLayerVisible(fresh, false);
  }
}

/* ---------- the core ------------------------------------------------ */

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
    L.geoJSON(outside, { pane: 'fogPane',
      style: { color: 'transparent', weight: 0, fillColor: '#060c14',
               fillOpacity: S.fogOpacity, interactive: false } }).addTo(fogLayer);
  }
  if (possible) {
    L.geoJSON(possible, { pane: 'fogPane',
      style: { color: '#2ee6a8', weight: 2.5, opacity: .95, fill: false, interactive: false } })
      .addTo(fogLayer);
  }
  L.geoJSON(S.playArea, { pane: 'fogPane',
    style: { color: '#ffffff', weight: 1, opacity: .35, dashArray: '3 5',
             fill: false, interactive: false } }).addTo(fogLayer);
}

function drawEvidence() {
  evidLayer.clearLayers();
  const A = '#ffb020';

  const dot = (coord, color, hollow) => L.circleMarker([coord[1], coord[0]], {
    pane: 'evidPane', radius: 4.5, color, weight: 2,
    fillColor: hollow ? '#0d141d' : color, fillOpacity: 1, interactive: false
  }).addTo(evidLayer);

  for (const c of S.constraints) {
    if (!c.active) continue;

    if (c.type === 'radar') {
      L.circle([c.center[1], c.center[0]], { pane: 'evidPane', radius: c.radiusM,
        color: A, weight: 1.6, opacity: .9,
        dashArray: c.answer === 'yes' ? null : '5 4', fill: false, interactive: false })
        .addTo(evidLayer);
      dot(c.center, A);
    }
    if (c.type === 'thermometer') {
      L.polyline([[c.a[1], c.a[0]], [c.b[1], c.b[0]]], { pane: 'evidPane',
        color: A, weight: 2, opacity: .9, interactive: false }).addTo(evidLayer);
      dot(c.a, A, true); dot(c.b, A);
    }
    if (c.type === 'measuring') {
      dot(c.target, A); dot(c.seeker, A, true);
      L.polyline([[c.seeker[1], c.seeker[0]], [c.target[1], c.target[0]]], { pane: 'evidPane',
        color: A, weight: 1.2, opacity: .6, dashArray: '3 4', interactive: false }).addTo(evidLayer);
    }
    if (c.type === 'nearest' && c.points) {
      c.points.forEach((p, i) => dot(p, i === c.index && c.answer !== 'no' ? '#2ee6a8' : A, i !== c.index));
      if (c.radiusM && c.seeker) {
        L.circle([c.seeker[1], c.seeker[0]], { pane: 'evidPane', radius: c.radiusM,
          color: A, weight: 1.2, opacity: .55, dashArray: '4 4', fill: false, interactive: false })
          .addTo(evidLayer);
      }
    }
    if (c.type === 'transit' && c.geometry) {
      L.geoJSON(c.geometry, { pane: 'evidPane',
        style: { color: A, weight: 3, opacity: .9, dashArray: c.answer === 'yes' ? null : '6 5' },
        interactive: false }).addTo(evidLayer);
    }
  }
}

function updateHud(possible, dead) {
  const hud = $('#hud');
  const totalM2 = turf.area(S.playArea);
  const leftM2 = possible ? turf.area(possible) : 0;
  const [num, unit] = fmtArea(dead ? 0 : leftM2);

  hud.classList.toggle('is-dead', !!dead || leftM2 === 0);
  $('#hudArea').textContent = num;
  $('#hudUnit').textContent = unit;
  const ratio = totalM2 ? leftM2 / totalM2 : 0;
  $('#hudPct').textContent = totalM2 ? `${(ratio * 100).toFixed(ratio < 0.01 ? 2 : 0)}%` : '—';
  $('#hudCount').textContent = S.constraints.filter((c) => c.active).length;

  if (dead) toastOnce('No area left. One of the answers must be logged wrong — mute them one at a time in the Log to find it.', true);
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

/* ---------- freehand drawing ---------------------------------------- */

const drawing = { on: false, pts: [], done: null, label: '', line: false };

function startDrawing(label, done, asLine) {
  drawing.on = true; drawing.pts = []; drawing.done = done;
  drawing.label = label; drawing.line = !!asLine;
  $('#drawHintText').textContent = label;
  $('#drawHint').hidden = false;
  $('#drawFinish').disabled = true;
  $('#drawFinish').textContent = asLine ? 'Finish line' : 'Finish shape';
  drawLayer.clearLayers();
  if (window.innerWidth <= 820) closeSheet();
}
drawing.push = function (coord) {
  drawing.pts.push(coord);
  $('#drawFinish').disabled = drawing.pts.length < (drawing.line ? 2 : 3);
  renderDrawing();
};
function renderDrawing() {
  drawLayer.clearLayers();
  const latlngs = drawing.pts.map((p) => [p[1], p[0]]);
  if (latlngs.length >= 2) {
    if (drawing.line) {
      L.polyline(latlngs, { pane: 'drawPane', color: '#ffb020', weight: 3, interactive: false })
        .addTo(drawLayer);
    } else {
      L.polygon(latlngs, { pane: 'drawPane', color: '#ffb020', weight: 2,
        fillOpacity: .12, interactive: false }).addTo(drawLayer);
    }
  }
  latlngs.forEach((ll) => L.circleMarker(ll, { pane: 'drawPane', radius: 4,
    color: '#ffb020', fillColor: '#0d141d', fillOpacity: 1, weight: 2, interactive: false })
    .addTo(drawLayer));
}
function stopDrawing() {
  drawing.on = false; drawing.pts = []; drawing.done = null;
  $('#drawHint').hidden = true;
  drawLayer.clearLayers();
}
$('#drawUndo').addEventListener('click', () => {
  drawing.pts.pop();
  $('#drawFinish').disabled = drawing.pts.length < (drawing.line ? 2 : 3);
  renderDrawing();
});
$('#drawFinish').addEventListener('click', () => {
  const min = drawing.line ? 2 : 3;
  if (drawing.pts.length < min) return;
  const feat = drawing.line
    ? turf.lineString(drawing.pts.slice())
    : turf.polygon([drawing.pts.concat([drawing.pts[0]])]);
  const cb = drawing.done;
  stopDrawing();
  if (cb) cb(feat);
  if (window.innerWidth <= 820) openSheet();
});

/* ---------- tool forms ---------------------------------------------- */

let activeTool = null;
const draft = {};

const TOOLS = {
  radar:       { title: 'Radar',       q: '“Are you within ___ of me?”', build: radarForm },
  thermometer: { title: 'Thermometer', q: '“After travelling ___, am I hotter or colder?”', build: thermoForm },
  measuring:   { title: 'Measuring',   q: '“Compared to me, are you closer to or further from ___?”', build: measuringForm },
  nearest:     { title: 'Matching / tentacles', q: '“Is your nearest ___ the same as mine?”', build: nearestForm },
  transit:     { title: 'Transit line', q: '“Will the bus I am on stop at your station?”', build: transitForm },
  zone:        { title: 'Zone match',  q: 'Same administrative zone as the seeker?', build: zoneForm },
  area:        { title: 'Free shape',  q: 'For photo clues, sightlines, hunches — anything you can draw.', build: areaForm }
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
  box.innerHTML = `<p class="form-title">${TOOLS[activeTool].title}</p>
                   <p class="form-q">${TOOLS[activeTool].q}</p>`;
  TOOLS[activeTool].build(box);
}

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
    beginPick(el, (coord) => { draft[key] = coord; renderToolForm(); });
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

/* number input measured in the "small" unit (feet / metres) */
function smallInput(box, key, label, placeholder) {
  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = `<label>${label} (${smallUnit()})</label>`;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '1'; inp.step = '10';
  inp.placeholder = placeholder || '';
  if (draft[key]) inp.value = Math.round(mToSmall(draft[key]));
  inp.addEventListener('change', () => {
    draft[key] = inp.value ? smallToM(Number(inp.value)) : null;
    renderToolForm();
  });
  f.appendChild(inp);
  box.appendChild(f);
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
  RADAR_PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'chip' + (draft.label === p.label ? ' is-active' : '');
    b.textContent = p.label;
    b.addEventListener('click', () => {
      draft.radiusM = p.m; draft.label = p.label; renderToolForm();
    });
    chips.appendChild(b);
  });
  f.appendChild(chips);
  box.appendChild(f);

  const custom = document.createElement('div');
  custom.className = 'field';
  custom.innerHTML = `<label>Or type a radius (${smallUnit()})</label>`;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = '1'; inp.step = '10';
  inp.placeholder = S.units === 'metric' ? 'metres' : 'feet';
  if (draft.radiusM && /^\d+ /.test(draft.label || '')) inp.value = Math.round(mToSmall(draft.radiusM));
  inp.addEventListener('change', () => {
    draft.radiusM = inp.value ? smallToM(Number(inp.value)) : null;
    // Remember how it was typed, so a 1500 ft radar never redisplays as 0.28 mi.
    draft.label = inp.value ? `${Number(inp.value)} ${smallUnit()}` : null;
    renderToolForm();
  });
  custom.appendChild(inp);
  box.appendChild(custom);

  answerSeg(box, [['yes', 'Yes'], ['no', 'No']]);
  actions(box, draft.center && draft.radiusM && draft.answer, () =>
    commit({ type: 'radar', center: draft.center, radiusM: draft.radiusM,
             label: draft.label || null, answer: draft.answer }));
}

/* --- thermometer --- */
function thermoForm(box) {
  slot(box, 'a', 'Start point');
  slot(box, 'b', 'End point');

  if (draft.a && draft.b) {
    const m = turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000;
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = `You travelled ${fmtDist(m)} in a straight line.`;
    box.appendChild(p);
  }
  answerSeg(box, [['hotter', 'Hotter'], ['colder', 'Colder']]);
  actions(box, draft.a && draft.b && draft.answer, () => {
    const m = turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000;
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
  note.textContent = 'Drop the pin on the map icon you both measured to. For coastlines, the Limfjord and borders, draw a free shape instead — a single pin cannot represent a line.';
  box.appendChild(note);

  answerSeg(box, [['closer', 'Closer'], ['further', 'Further']]);
  actions(box, draft.seeker && draft.target && draft.answer, () =>
    commit({ type: 'measuring', seeker: draft.seeker, target: draft.target,
             targetName: draft.targetName, answer: draft.answer }));
}

/* --- matching / tentacles --- */
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
  hint.textContent = 'Add every one of these inside the play area, then tap the one nearest to you.';
  box.appendChild(hint);

  smallInput(box, 'radiusM', 'Tentacle radius — leave blank for a plain matching question', '');
  if (draft.radiusM) slot(box, 'seeker', 'Tentacle centre (you)');

  answerSeg(box, [['yes', 'Match'], ['no', 'No match']]);

  const ready = draft.points.length > 0 && draft.answer && draft.index != null &&
                (!draft.radiusM || draft.seeker);
  actions(box, ready, () => commit({
    type: 'nearest', points: draft.points.slice(), index: draft.index,
    categoryName: draft.categoryName, radiusM: draft.radiusM || null,
    seeker: draft.seeker || null, answer: draft.answer
  }));
}

/* --- transit line --- */
function transitForm(box) {
  const lineLayers = S.layers.filter((l) => l.kind === 'line');

  if (!draft.bufferM) draft.bufferM = 0.25 * MI;

  const pick = document.createElement('div');
  pick.className = 'field';
  pick.innerHTML = '<label>Route</label>';
  const status = document.createElement('div');
  status.className = 'slot' + (draft.lineGeom ? ' is-set' : '');
  status.innerHTML = `<span class="slot-dot"></span>
    <span class="slot-body"><span class="slot-label">${draft.lineName || 'No route selected'}</span><br>
    <span class="slot-coord">${draft.lineGeom ? 'Tap another route to change it' : (lineLayers.length ? 'Tap a route on the map' : 'No route layer loaded')}</span></span>`;
  pick.appendChild(status);
  box.appendChild(pick);

  const draw = document.createElement('button');
  draw.className = 'ghost-btn wide';
  draw.textContent = draft.lineGeom ? 'Trace a different route by hand' : 'Trace the route by hand';
  draw.addEventListener('click', () => startDrawing('Tap along the route, stop to stop', (line) => {
    draft.lineGeom = line.geometry;
    draft.lineName = draft.lineName || 'Traced route';
    renderToolForm(); openSheet();
  }, true));
  box.appendChild(draw);

  const nf = document.createElement('div');
  nf.className = 'field';
  nf.innerHTML = '<label>Route name</label>';
  const nin = document.createElement('input');
  nin.type = 'text'; nin.placeholder = 'e.g. line 2';
  nin.value = draft.lineName || '';
  nin.addEventListener('input', () => { draft.lineName = nin.value; });
  nf.appendChild(nin);
  box.appendChild(nf);

  smallInput(box, 'bufferM', 'How far either side of the route', '');
  const h = document.createElement('p');
  h.className = 'hint';
  h.textContent = 'The hider has to be at a stop on the route, so allow a short walk either side. A quarter mile is a sensible default.';
  box.appendChild(h);

  answerSeg(box, [['yes', 'Same route'], ['no', 'Different route']]);
  actions(box, draft.lineGeom && draft.bufferM && draft.answer, () =>
    commit({ type: 'transit', geometry: draft.lineGeom, lineName: draft.lineName,
             bufferM: draft.bufferM, answer: draft.answer }));
}

/* --- zone --- */
function zoneForm(box) {
  const zones = [];
  S.layers.filter((l) => l.kind === 'poly').forEach((zl) => {
    (zl.geojson.features || []).forEach((ft) => zones.push({ zl, ft }));
  });

  if (!zones.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Load a zone layer first — see the Layers tab.';
    box.appendChild(p);
    return;
  }

  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = '<label>Which zone is the seeker in?</label>';
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="">Choose a zone…</option>' + zones.map((z, i) =>
    `<option value="${i}"${String(draft.zoneIdx) === String(i) ? ' selected' : ''}>${escapeHtml(featureName(z.ft, z.zl))} — ${escapeHtml(z.zl.name)}</option>`).join('');
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
    commit({ type: 'zone', geometry: z.ft.geometry,
             zoneName: featureName(z.ft, z.zl), answer: draft.answer });
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

/* ---------- GML ------------------------------------------------------
   Plandata and GeoServer hand back GeoJSON on request. KortInfo is an
   older stack and answers in GML whatever you ask for, so parse that too
   rather than failing at the last step. */

function parseGml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagNameNS('*', 'ServiceException').length) {
    const m = doc.getElementsByTagNameNS('*', 'ServiceException')[0];
    throw new Error((m.textContent || 'service exception').trim().slice(0, 140));
  }
  const numbers = (el) => (el.textContent || '').trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));

  function ringsOf(node) {
    const out = [];
    // posList (GML3) and coordinates (GML2) both appear in the wild
    for (const tag of ['posList', 'coordinates']) {
      for (const el of Array.from(node.getElementsByTagNameNS('*', tag))) {
        const v = numbers(el);
        const ring = [];
        for (let i = 0; i + 1 < v.length; i += 2) ring.push([v[i], v[i + 1]]);
        if (ring.length >= 4) {
          if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
            ring.push(ring[0].slice());
          }
          out.push(ring);
        }
      }
      if (out.length) break;
    }
    return out;
  }

  const features = [];
  const members = Array.from(doc.getElementsByTagNameNS('*', 'featureMember'))
    .concat(Array.from(doc.getElementsByTagNameNS('*', 'member')));
  const hosts = members.length ? members : [doc.documentElement];

  for (const host of hosts) {
    const props = {};
    for (const el of Array.from(host.getElementsByTagNameNS('*', '*'))) {
      if (el.children.length) continue;
      const name = el.localName || el.nodeName.replace(/^.*:/, '');
      if (/^(posList|coordinates|pos|lowerCorner|upperCorner)$/.test(name)) continue;
      const t = (el.textContent || '').trim();
      if (t && t.length < 120 && props[name] === undefined) props[name] = t;
    }
    const polys = Array.from(host.getElementsByTagNameNS('*', 'Polygon'));
    const rings = polys.length ? polys.map(ringsOf).filter((r) => r.length)
                              : (ringsOf(host).length ? [ringsOf(host)] : []);
    for (const r of rings) {
      features.push({ type: 'Feature', properties: props,
                      geometry: { type: 'Polygon', coordinates: r } });
    }
    if (!polys.length) {
      for (const ls of Array.from(host.getElementsByTagNameNS('*', 'LineString'))) {
        const r = ringsOf(ls);
        if (r.length) features.push({ type: 'Feature', properties: props,
          geometry: { type: 'LineString', coordinates: r[0] } });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/* ---------- coordinate handling -------------------------------------
   Danish services love UTM32 and sometimes hand back lat/lng in the
   wrong order. Both are silent failures — the zones just land in the
   sea — so normalise on the way in.                                   */

if (typeof proj4 !== 'undefined') {
  proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
}

function normaliseCoords(gj) {
  let sample = null;
  turf.coordEach(gj, (c) => { if (!sample) sample = c.slice(); });
  if (!sample) return { gj, note: '' };

  // Projected metres (UTM32): values far outside degree range.
  if (Math.abs(sample[0]) > 180 || Math.abs(sample[1]) > 90) {
    if (typeof proj4 === 'undefined') {
      throw new Error('Data came back in a projected coordinate system and proj4 did not load.');
    }
    turf.coordEach(gj, (c) => {
      const [lng, lat] = proj4('EPSG:25832', 'EPSG:4326', [c[0], c[1]]);
      c[0] = lng; c[1] = lat;
    });
    return { gj, note: 'reprojected from UTM32' };
  }

  // Axis order: in Denmark longitude is ~8–13 and latitude ~54–58, so a
  // first ordinate above 40 means the pair arrived as lat,lng.
  if (sample[0] > 40 && Math.abs(sample[1]) < 40) {
    turf.coordEach(gj, (c) => { const t = c[0]; c[0] = c[1]; c[1] = t; });
    return { gj, note: 'axis order corrected' };
  }
  return { gj, note: '' };
}

const NAME_KEYS = ['navn', 'name', 'plannavn', 'zonestatus', 'linjenavn', 'rutenavn',
                   'rute', 'linje', 'linienavn', 'linienummer', 'rutenr', 'betegnelse',
                   'titel', 'plannr', 'nr', 'kode', 'postnr'];

function featureName(ft, layer) {
  const p = ft.properties || {};
  if (p.__displayName != null && String(p.__displayName).trim()) return String(p.__displayName);
  if (layer && layer.nameField && p[layer.nameField] != null) return String(p[layer.nameField]);
  for (const k of NAME_KEYS) {
    const hit = Object.keys(p).find((x) => x.toLowerCase() === k);
    if (hit && p[hit] != null && String(p[hit]).trim()) return String(p[hit]);
  }
  const first = Object.entries(p).find(([, v]) => typeof v === 'string' && v.trim());
  return first ? first[1] : 'Unnamed';
}

function labelValue(v) {
  if (!['string', 'number'].includes(typeof v)) return '';
  const text = String(v).trim();
  return text && text.length <= 160 ? text : '';
}

function zone2LikeLabel(value) {
  const n = normaliseZoneText(value);
  return PLAY_ZONE_ALIASES.some((z) => z.aliases.some((a) => n === a || n.includes(a)));
}

/* KortInfo layers often carry both a parent-area name and the feature's own
   name. A generic "navn" lookup therefore made Zone 3 display Midtbyen,
   Øst Aalborg, etc. repeatedly. Pick a label column from the entire layer:
   a district field must have substantially more than four distinct values,
   while IDs, dates, geometry metadata and parent-area fields are penalised. */
function rankedNameFields(features, sourceKey) {
  const keys = new Set();
  for (const ft of features || []) {
    for (const [key, value] of Object.entries(ft.properties || {})) {
      if (!key.startsWith('__') && labelValue(value)) keys.add(key);
    }
  }
  const total = Math.max(1, (features || []).length);
  return [...keys].map((key) => {
    const values = (features || []).map((ft) => labelValue((ft.properties || {})[key])).filter(Boolean);
    const distinct = new Set(values.map((v) => normaliseZoneText(v))).size;
    const coverage = values.length / total;
    const alpha = values.filter((v) => /[A-Za-zÆØÅæøå]/.test(v)).length / Math.max(1, values.length);
    const sensible = values.filter((v) => v.length >= 2 && v.length <= 70 && !/^https?:/i.test(v)).length /
                     Math.max(1, values.length);
    const k = normaliseZoneText(key);
    let score = coverage * 80 + alpha * 35 + sensible * 25 + Math.min(distinct, 80) * 3;

    if (/^(navn|name|titel|betegnelse)$/.test(k)) score += 45;
    if (/navn|name|titel|betegnelse/.test(k)) score += 25;
    if (sourceKey === 'zone3') {
      if (/bydel|distrikt|delomrade|lokalomrade|bynavn|stednavn/.test(k)) score += 150;
      if (/kommuneplan|hovedomrade|storomrade|zone ?2|parent|overordnet/.test(k)) score -= 170;
      if (distinct <= 4) score -= 180;
      else score += Math.min(120, distinct * 4);
    } else if (sourceKey === 'zone4') {
      if (/ramme.*navn|plannavn|omrade.*navn/.test(k)) score += 110;
      if (/ramme.*nr|plannr|plannummer|rammekode/.test(k)) score += 80;
    }
    if (/^(id|fid|gid|objectid|ogc fid|shape|areal|area|length|dato|date|status|aktiv)$/.test(k)) score -= 220;
    if (/id$|uuid|guid|timestamp|oprettet|rettet|version|geometri|geometry/.test(k)) score -= 110;
    if (values.some((v) => /^\d{6,}$/.test(v))) score -= 55;
    return { key, score, distinct, coverage };
  }).sort((a, b) => b.score - a.score || b.distinct - a.distinct);
}

function inferNameField(features, sourceKey) {
  const ranked = rankedNameFields(features, sourceKey);
  return ranked.length ? ranked[0].key : '';
}

function prepareSourceLabels(gj, sourceKey, configuredField) {
  const features = gj && gj.type === 'FeatureCollection' ? gj.features
                 : gj && gj.type === 'Feature' ? [gj] : [];
  if (!features.length) return '';
  const ranked = rankedNameFields(features, sourceKey);
  const requested = configuredField && ranked.find((r) => r.key === configuredField);
  const primary = requested ? requested.key : (ranked[0] ? ranked[0].key : '');
  const candidates = [primary, ...ranked.map((r) => r.key)].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const ft of features) {
    const props = ft.properties || (ft.properties = {});
    let value = labelValue(props[primary]);
    // Zone 3's parent-area field has only the four Zone 2 names. Even if the
    // server calls that field "navn", prefer the first district-like value.
    if (sourceKey === 'zone3' && zone2LikeLabel(value)) {
      value = candidates.map((k) => labelValue(props[k]))
        .find((v) => v && !zone2LikeLabel(v)) || value;
    }
    if (!value) value = candidates.map((k) => labelValue(props[k])).find(Boolean) || 'Unnamed';
    props.__displayName = value;
  }
  return '__displayName';
}

/* ---------- layers ---------------------------------------------------- */

const LAYER_COLORS = ['#7c9cf5', '#f57cae', '#7cf5d0', '#f5d17c', '#b97cf5', '#7cf58a'];

/* ---------- traced Aalborg zones -------------------------------------
   The outlines in data.js are real boundaries traced from the KortInfo
   screenshots, stored in the screenshots' pixel space. A screenshot can
   tell you the shape of a boundary but not where on Earth it sits, so
   the pixel-to-degree transform starts as an estimate and is corrected
   once, by hand, in the Calibrate control.                            */

const mercY = (lat) => (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const invMercY = (my) => (180 / Math.PI) * (2 * Math.atan(Math.exp(my * Math.PI / 180)) - Math.PI / 2);

/* The overlays are the right shape already — only where they sit and how big
   they are needs setting, and only once. Placement is three numbers: the map
   position of the overlay's anchor point, and a scale multiplier. */
function anchorPx() {
  const z = (window.ZONE2_PX || []).find((r) => r.n === 1) || (window.ZONE2_PX || [])[0];
  if (!z) return [446, 401];
  let sx = 0, sy = 0;
  for (const [x, y] of z.ring) { sx += x; sy += y; }
  return [sx / z.ring.length, sy / z.ring.length];
}

function defaultCal() {
  const p = window.PLACEMENT || { lat: 57.048, lng: 9.9187, scale: 1 };
  return { lat: p.lat, lng: p.lng, mul: p.scale };
}

function georef() {
  const c = S.cal || defaultCal();
  const [ax, ay] = anchorPx();
  const s = (window.BASE_PX_DEG || 0.00031) * (c.mul || 1);
  return { s, lng0: c.lng - s * ax, my0: mercY(c.lat) + s * ay };
}

const pxToLngLat = (x, y, gr) => [gr.lng0 + gr.s * x, invMercY(gr.my0 - gr.s * y)];

function ringToPolygon(ring, props, gr, snapper) {
  const coords = snapper ? snapper.mapRing(ring, gr)
                         : ring.map(([x, y]) => pxToLngLat(x, y, gr));
  if (coords.length < 4) return null;
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first.slice());
  try { return turf.polygon([coords], props); } catch (_) { return null; }
}

/* Zone 2: the four play zones, straight from the traced outlines. */
/* Zone 2: the four play zones, straight from the traced outlines. */
function buildAreaZones() {
  const gr = georef();
  const snapper = (S.roadIndex && S.snapOn) ? snapRingsToRoads(S.roadIndex, S.snapM || 70) : null;
  const out = [];
  for (const z of window.ZONE2_PX || []) {
    const f = ringToPolygon(z.ring, { navn: `${z.n}. ${z.name}`, area: z.n }, gr, snapper);
    if (f) out.push(f);
  }
  return out.length ? { type: 'FeatureCollection', features: out } : null;
}

/* Zone 3: the city districts, with the names read off the screenshot's
   own labels. Renames live in S.renames, keyed by index. */
function buildDistrictZones() {
  const gr = georef();
  const snapper = (S.roadIndex && S.snapOn) ? snapRingsToRoads(S.roadIndex, S.snapM || 70) : null;
  const out = [];
  (window.ZONE3_PX || []).forEach((z, i) => {
    const nm = (S.renames && S.renames[i]) || z.name || `District ${i + 1}`;
    const f = ringToPolygon(z.ring, { navn: nm, idx: i }, gr, snapper);
    if (f) out.push(f);
  });
  if (snapper) S.lastSnap = snapper.stats();
  return out.length ? { type: 'FeatureCollection', features: out } : null;
}

/* The four official Zone 2 polygons are also the default play area. The
   source has changed names/field casing over time, so identify the areas from
   every scalar property rather than relying on one brittle name field. */
const PLAY_ZONE_ALIASES = [
  { area: 1, name: 'Midtbyen', aliases: ['midtbyen'] },
  { area: 2, name: 'Nørresundby', aliases: ['norresundby'] },
  { area: 3, name: 'Vest Aalborg', aliases: ['vest aalborg', 'aalborg vest'] },
  { area: 4, name: 'Øst Aalborg', aliases: ['ost aalborg', 'aalborg ost'] }
];

function normaliseZoneText(value) {
  return String(value == null ? '' : value)
    .toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function playZoneDef(featureOrProps) {
  const props = featureOrProps && featureOrProps.properties
    ? featureOrProps.properties : (featureOrProps || {});
  if (props.area != null) {
    const byNumber = PLAY_ZONE_ALIASES.find((z) => z.area === Number(props.area));
    if (byNumber) return byNumber;
  }
  const hay = normaliseZoneText(Object.values(props)
    .filter((v) => ['string', 'number'].includes(typeof v)).join(' | '));
  return PLAY_ZONE_ALIASES.find((z) => z.aliases.some((a) => hay.includes(a))) || null;
}

function prepareOfficialZone2(gj) {
  if (!gj) return null;
  const raw = gj.type === 'FeatureCollection' ? gj.features
            : gj.type === 'Feature' ? [gj] : [];
  const features = raw.filter((f) => f && f.geometry && /Polygon/.test(f.geometry.type));
  for (const ft of features) {
    const def = playZoneDef(ft);
    if (!def) continue;
    ft.properties = Object.assign({}, ft.properties, {
      area: def.area,
      navn: def.name,
      playZone: true
    });
  }
  return { type: 'FeatureCollection', features };
}

function officialPlayZoneFeatures(gj) {
  const prepared = prepareOfficialZone2(gj);
  if (!prepared) return [];
  const recognised = prepared.features.filter((ft) => !!playZoneDef(ft));
  const areas = new Set(recognised.map((ft) => playZoneDef(ft).area));
  // Keep every polygon part belonging to the four areas; some WFS/GML
  // replies represent a multipart area as several Polygon features.
  if (areas.size === PLAY_ZONE_ALIASES.length) return recognised;
  // TL445984 is specifically the four-area Zone 2 layer. KortInfo may omit
  // display-name properties or split MultiSurface features into several
  // Polygon members, but every polygon in this exact layer still belongs to
  // one of the four requested areas.
  const trustedDefault = typeof S !== 'undefined' && S.sources && S.sources.zone2
    && S.sources.zone2.url === KORTINFO
    && String(S.sources.zone2.typeName).toLowerCase() === 'ugis:tl445984';
  if (trustedDefault && prepared.features.length) return prepared.features;
  // For a custom source, accept an unnamed response only when it is exactly
  // four polygons; otherwise require the four names to avoid widening play.
  return prepared.features.length === PLAY_ZONE_ALIASES.length ? prepared.features : [];
}

function officialZone2Data() {
  if (S.zone2Official) return S.zone2Official;
  const layer = layerByKey('src:zone2');
  return layer ? layer.geojson : null;
}

/* Prefer the exact KortInfo geometry. The traced geometry remains a startup
   and outage fallback so a temporarily unavailable municipal server never
   makes the game unusable. */
function zonesPlayArea() {
  const official = officialPlayZoneFeatures(officialZone2Data());
  if (official.length) return unionAll(official);
  const fallback = buildAreaZones();
  return fallback ? unionAll(fallback.features) : null;
}

function hasOfficialZonesPlayArea() {
  return officialPlayZoneFeatures(officialZone2Data()).length > 0;
}

const AREA_STYLE = () => Object.entries(window.AALBORG_AREAS || {})
  .map(([k, v]) => ({ key: k, label: `${k}. ${v.name}`, color: v.color }));

function areaCategory(props) {
  const def = playZoneDef(props);
  if (!def) return null;
  const a = (window.AALBORG_AREAS || {})[def.area];
  return a ? { key: String(def.area), label: `${def.area}. ${a.name}`, color: a.color } : null;
}

function unionAll(features) {
  const polys = features.filter((f) => f && f.geometry && /Polygon/.test(f.geometry.type));
  if (!polys.length) return null;
  if (polys.length === 1) return turf.clone(polys[0]);
  try {
    const u = turf.union(turf.featureCollection(polys));
    if (u) return u;
  } catch (_) { /* fall back to pairwise */ }
  let acc = turf.clone(polys[0]);
  for (let i = 1; i < polys.length; i++) acc = boolOp(turf.union, acc, polys[i]) || acc;
  return acc;
}

/* A layer is created once and then toggled. `key` keeps a source from
   loading twice — tapping Zone 4 five times must not stack five copies. */
function addLayer(name, geojson, opts = {}) {
  const raw = geojson.type === 'FeatureCollection' ? geojson.features
            : geojson.type === 'Feature' ? [geojson] : [];
  const polys = raw.filter((f) => f && f.geometry && /Polygon/.test(f.geometry.type));
  const lines = raw.filter((f) => f && f.geometry && /LineString/.test(f.geometry.type));

  const kind = opts.kind || (lines.length > polys.length ? 'line' : 'poly');
  const sourceFeats = (kind === 'line' ? lines : polys).slice();
  const feats = sourceFeats.slice();
  if (!feats.length) {
    toast(`${name}: no ${kind === 'line' ? 'lines' : 'polygons'} in that data.`, true);
    return null;
  }

  if (opts.key) removeLayerByKey(opts.key);

  const color = LAYER_COLORS[S.layers.length % LAYER_COLORS.length];
  // Zone 1 and Zone 4 are classifications, not complete polygon blankets.
  // Give the unclassified remainder of the play area a real feature so it is
  // coloured, named and selectable just like an official polygon.
  if ((opts.style === 'zonekort') && kind === 'poly' && S.playArea) {
    const covered = unionAll(feats);
    const rest = covered ? gDifference(S.playArea, covered) : turf.clone(S.playArea);
    if (rest) {
      rest.properties = { navn: 'Landzone', zonestatus: 'Landzone', __displayName: 'Landzone' };
      feats.unshift(rest);   // first = drawn first = underneath the byzones
    }
  }
  if ((opts.style === 'rammer') && kind === 'poly' && S.playArea) {
    const covered = unionAll(feats);
    const rest = covered ? gDifference(S.playArea, covered) : turf.clone(S.playArea);
    if (rest) {
      rest.properties = {
        navn: RAMME_OTHER.label,
        __displayName: RAMME_OTHER.label,
        __zone4Other: true
      };
      feats.unshift(rest);   // draw the catch-all beneath official Zone 4 polygons
    }
  }

  const fcol = { type: 'FeatureCollection', features: feats };
  const baseGeojson = opts.baseGeojson || { type: 'FeatureCollection', features: sourceFeats };
  const rec = { id: uid(), key: opts.key || null, name, color, kind, geojson: fcol,
                baseGeojson, sourceKey: opts.sourceKey || null,
                nameField: opts.nameField || '', style: opts.style || 'plain',
                derived: opts.derived || null, visible: true, layer: null };

  const styleOf = (ft) => {
    const cat = categoryFor(rec.style, ft.properties);
    const c = cat ? cat.color : color;
    return kind === 'line'
      ? { color: c, weight: 3, opacity: .85 }
      : { color: c, weight: 1.3, opacity: .9, fillColor: c, fillOpacity: cat ? .35 : .05 };
  };

  rec.layer = L.geoJSON(fcol, {
    pane: 'zonePane',
    style: styleOf,
    onEachFeature: (ft, lyr) => {
      // Zone 4's colours are hard to tell apart, so tapping an area names the
      // land-use category. The synthetic X area is therefore labelled too.
      let tip = featureName(ft, rec);
      if (rec.style === 'rammer') {
        const cat = rammeCategory(ft.properties);
        tip = cat ? cat.label : RAMME_OTHER.label;
      }
      lyr.bindTooltip(tip, { className: 'zone-tip', sticky: true });
      lyr.on('click', (e) => {
        if (kind === 'poly' && tryRename(ft)) { L.DomEvent.stopPropagation(e); return; }
        if (kind === 'poly' && activeTool === 'zone') {
          L.DomEvent.stopPropagation(e);
          const all = [];
          S.layers.filter((l) => l.kind === 'poly')
            .forEach((zl) => (zl.geojson.features || []).forEach((f2) => all.push(f2)));
          const idx = all.indexOf(ft);
          if (idx >= 0) { draft.zoneIdx = String(idx); renderToolForm(); openSheet(); }
        }
        if (kind === 'line' && activeTool === 'transit') {
          L.DomEvent.stopPropagation(e);
          draft.lineGeom = ft.geometry;
          draft.lineName = featureName(ft, rec);
          renderToolForm(); openSheet();
        }
      });
    }
  }).addTo(map);

  S.layers.push(rec);
  renderLayerList();
  renderSourceRows();
  renderLegend();
  return rec;
}

function layerByKey(key) { return S.layers.find((l) => l.key === key) || null; }

function removeLayerByKey(key) {
  const ex = layerByKey(key);
  if (!ex) return;
  map.removeLayer(ex.layer);
  S.layers = S.layers.filter((l) => l !== ex);
}

function setLayerVisible(rec, on) {
  rec.visible = on;
  if (on) rec.layer.addTo(map); else map.removeLayer(rec.layer);
  renderLayerList(); renderSourceRows(); renderLegend();
}

function usePlayAreaFromLayer(rec) {
  const u = unionAll(rec.geojson.features);
  if (!u) { toast('That layer has no areas to merge.', true); return; }
  setCustomPlayArea(u, rec.name);
  toast(`Play area is now the outline of ${rec.name}.`);
}

/* Only layers loaded by hand appear here; the four zone levels and the
   route sets are toggled from their own rows. */
function renderLayerList() {
  const box = $('#zoneLayers');
  box.innerHTML = '';
  S.layers.filter((l) => !l.key).forEach((zl) => {
    const row = document.createElement('div');
    row.className = 'zone-row';
    row.innerHTML = `<span class="zone-swatch" style="background:${zl.color}"></span>
      <span class="zone-name">${escapeHtml(zl.name)}</span>
      <span class="zone-count">${zl.geojson.features.length}${zl.kind === 'line' ? ' ln' : ''}</span>
      <button class="icon-btn" data-act="area" title="Use as play area">⛶</button>
      <button class="icon-btn" data-act="vis">${zl.visible ? '◉' : '○'}</button>
      <button class="icon-btn del" data-act="del">✕</button>`;
    row.querySelector('[data-act=vis]').addEventListener('click', () => setLayerVisible(zl, !zl.visible));
    row.querySelector('[data-act=area]').addEventListener('click', () => usePlayAreaFromLayer(zl));
    row.querySelector('[data-act=del]').addEventListener('click', () => {
      map.removeLayer(zl.layer);
      S.layers = S.layers.filter((x) => x.id !== zl.id);
      renderLayerList(); renderLegend();
    });
    box.appendChild(row);
  });
}

function renderLegend() {
  const box = $('#legend');
  const active = S.layers.filter((l) => l.visible && l.style !== 'plain');
  if (!active.length) { box.hidden = true; box.innerHTML = ''; return; }

  box.hidden = false;
  box.innerHTML = active.map((l) => {
    // RAMME_STYLE is ordered for matching (D before B and so on); show it
    // alphabetically instead.
    const cats = l.style === 'rammer' ? RAMME_LEGEND.slice().sort((a, b) => a.key.localeCompare(b.key))
              : l.style === 'areas' ? AREA_STYLE()
              : ZONEKORT_STYLE;
    const used = cats.filter((c) =>
      l.geojson.features.some((ft) => {
        const got = categoryFor(l.style, ft.properties);
        return got && got.key === c.key;
      }));
    const show = used.length ? used : cats;
    return `<p class="legend-title">${escapeHtml(l.name)}</p>` +
      show.map((c) => `<div class="legend-row">
        <span class="legend-swatch" style="background:${c.color}"></span>
        <span>${escapeHtml(c.label)}</span></div>`).join('');
  }).join('');
}

function setStatus(msg, bad) {
  const el = $('#zoneStatus');
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.toggle('is-bad', !!bad);
  el.textContent = msg;
}

/* ---------- fetching -------------------------------------------------- */

function wfsUrl(src) {
  const p = new URLSearchParams({
    service: 'WFS', version: '1.0.0', request: 'GetFeature',
    typeName: src.typeName, outputFormat: 'application/json', srsName: 'EPSG:4326'
  });
  if (src.cql) p.set('CQL_FILTER', src.cql);
  return src.url + (src.url.includes('?') ? '&' : '?') + p.toString();
}

function capsUrl(url) {
  const p = new URLSearchParams({ service: 'WFS', version: '1.1.0', request: 'GetCapabilities' });
  return url + (url.includes('?') ? '&' : '?') + p.toString();
}

/* GC2 serves the same table over a SQL endpoint and a WFS endpoint. Try both:
   which one is open varies, and a route layer that will not load is the
   difference between playing and not playing. */
function gc2Urls(table) {
  const [schema, tbl] = table.includes('.') ? table.split('.') : ['public', table];
  const sql = new URLSearchParams({ q: `SELECT * FROM ${table}`, format: 'geojson', srs: '4326' });
  const wfs = new URLSearchParams({
    service: 'WFS', version: '1.0.0', request: 'GetFeature',
    typeName: tbl, outputFormat: 'application/json', srsName: 'EPSG:4326'
  });
  return [
    `${GC2}/api/v2/sql/nt?${sql.toString()}`,
    `${GC2}/wfs/nt/${schema}/4326?${wfs.toString()}`
  ];
}
const gc2Url = (table) => gc2Urls(table)[0];

async function fetchGeoJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let gj;
  try {
    gj = JSON.parse(text);
  } catch (_) {
    if (/<\s*[A-Za-z:]*(FeatureCollection|ServiceException|wfs:)/.test(text)) {
      gj = parseGml(text);
      if (!gj.features.length) throw new Error('the reply had no geometry in it');
    } else {
      throw new Error('reply was neither GeoJSON nor GML — check the layer name');
    }
  }
  if (gj.exceptions || gj.success === false) throw new Error(gj.message || 'Service reported an error.');
  if (!gj.type) throw new Error('No GeoJSON in the reply.');
  if (!(gj.features || []).length && gj.type === 'FeatureCollection') {
    throw new Error('The service answered, but with zero features — check the filter.');
  }
  return gj;
}

/* Try each URL in turn, keep the first that yields features. */
async function fetchFirst(urls) {
  const problems = [];
  for (const u of urls) {
    try { return await fetchGeoJson(u); }
    catch (err) { problems.push(err.message); }
  }
  throw new Error(problems.join(' / '));
}

/* ---------- layer capability browser ---------------------------------
   Reads the service's own list of layers so you never have to guess a
   typeName again. Works on any OGC WFS: Plandata, KortInfo, GC2.       */

function parseWfsCapabilities(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const nodes = Array.from(doc.getElementsByTagNameNS('*', 'FeatureType'));
  const out = [];
  for (const n of nodes) {
    const pick = (tag) => {
      const e = n.getElementsByTagNameNS('*', tag)[0];
      return e && e.textContent ? e.textContent.trim() : '';
    };
    const name = pick('Name');
    if (name) out.push({ name, title: pick('Title') || name, abstract: pick('Abstract') });
  }
  return out;
}

async function browseLayers(url) {
  const res = await fetch(capsUrl(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseWfsCapabilities(await res.text());
  if (!list.length) throw new Error('No layers listed — is that a WFS endpoint?');
  return list;
}

/* ---------- OpenStreetMap routes via Overpass -------------------------- */

function overpassQuery(filter) {
  const [s2, w, n, e] = OVERPASS_BBOX;
  return `[out:json][timeout:90];relation(${s2},${w},${n},${e})["type"="route"]${filter};out geom;`;
}

/* Route relations list the roads they run along as `way` members with no
   role; stops and platforms carry roles starting "stop" or "platform".
   Keep the roads, drop the stops. */
function parseOverpassRoutes(json) {
  const feats = [];
  for (const el of (json && json.elements) || []) {
    if (el.type !== 'relation') continue;
    const lines = [];
    for (const m of el.members || []) {
      if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
      if (m.role && /^(stop|platform)/.test(m.role)) continue;
      const coords = m.geometry.filter((p) => p && p.lon != null).map((p) => [p.lon, p.lat]);
      if (coords.length >= 2) lines.push(coords);
    }
    if (!lines.length) continue;
    const t = el.tags || {};
    const label = t.ref ? (t.name ? `${t.ref} · ${t.name}` : String(t.ref)) : (t.name || `Route ${el.id}`);
    feats.push({
      type: 'Feature',
      properties: { navn: label, ref: t.ref || '', operator: t.operator || t.network || '' },
      geometry: lines.length === 1
        ? { type: 'LineString', coordinates: lines[0] }
        : { type: 'MultiLineString', coordinates: lines }
    });
  }
  // One relation per direction is normal; fold them together by label so
  // tapping "2" gives you the whole line rather than one half of it.
  const byLabel = new Map();
  for (const f of feats) {
    const k = f.properties.navn;
    if (!byLabel.has(k)) { byLabel.set(k, f); continue; }
    const a = byLabel.get(k);
    const grab = (g) => g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    a.geometry = { type: 'MultiLineString', coordinates: grab(a.geometry).concat(grab(f.geometry)) };
  }
  const merged = Array.from(byLabel.values())
    .sort((a, b) => String(a.properties.ref).localeCompare(String(b.properties.ref), 'da', { numeric: true }));
  return { type: 'FeatureCollection', features: merged };
}

async function fetchOverpass(filter) {
  const body = 'data=' + encodeURIComponent(overpassQuery(filter));
  const problems = [];
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await res.text());
      const gj = parseOverpassRoutes(json);
      if (!gj.features.length) throw new Error('no routes in the reply');
      return gj;
    } catch (err) { problems.push(err.message); }
  }
  throw new Error(problems.join(' / '));
}

/* ---------- toggling sources ----------------------------------------- */

async function toggleSource(key, btn) {
  const src = S.sources[key];
  const ex = layerByKey('src:' + key);
  if (ex) { setLayerVisible(ex, !ex.visible); return; }

  // Built-in zones need no network at all.
  if (src.kind === 'areas' || src.kind === 'districts') {
    const gj = src.kind === 'areas' ? buildAreaZones() : buildDistrictZones();
    if (!gj) { setStatus(`${src.name}: could not build the zones — check data.js.`, true); return; }
    const rec = addLayer(src.name, gj, {
      key: 'src:' + key, nameField: 'navn', style: src.style, derived: src.kind,
      sourceKey: key, baseGeojson: gj
    });
    if (rec) setStatus(`${src.name}: ${rec.geojson.features.length} zones on (approximate — built from data.js).`);
    return;
  }

  if (!src.url || (src.kind === 'wfs' && !src.typeName)) {
    setStatus(`${src.name}: no source set yet. Tap ⚙, paste the service URL, then Browse for the layer.`, true);
    return;
  }
  if (btn) btn.classList.add('is-busy');
  setStatus(`Loading ${src.name}…`);
  try {
    let gj = (key === 'zone2' && S.zone2Official) ? S.zone2Official
      : await fetchFirst([src.kind === 'wfs' ? wfsUrl(src) : src.url]);
    let note = '';
    if (!(key === 'zone2' && gj === S.zone2Official)) {
      ({ note } = normaliseCoords(gj));
      if (key === 'zone2') {
        gj = prepareOfficialZone2(gj);
        S.zone2Official = gj;
      }
    }
    const displayNameField = prepareSourceLabels(gj, key, src.nameField);
    const rec = addLayer(src.name, gj, {
      key: 'src:' + key, nameField: displayNameField || src.nameField, style: src.style,
      sourceKey: key, baseGeojson: gj
    });
    if (key === 'zone2' && S.playAreaMeta && S.playAreaMeta.type === 'zones') {
      setZonesPlayArea(false);
    }
    if (rec) {
      setStatus(`${src.name}: ${rec.geojson.features.length} zones on${note ? ' (' + note + ')' : ''}. ` +
              `Live data carries real coordinates — placement does not apply to it.`);
    }
  } catch (err) {
    setStatus(`${src.name} failed — ${err.message}. Tap ⚙ and Browse to pick the right layer.`, true);
  } finally {
    if (btn) btn.classList.remove('is-busy');
  }
}

/* Load official Zone 2 quietly at startup so the four named municipal
   polygons replace the traced fallback as soon as the service answers. */
async function loadOfficialZone2PlayArea() {
  const src = S.sources.zone2;
  if (!src || src.kind !== 'wfs' || !src.url || !src.typeName || typeof window.fetch !== 'function') {
    return false;
  }
  try {
    let gj = await fetchFirst([wfsUrl(src)]);
    normaliseCoords(gj);
    gj = prepareOfficialZone2(gj);
    if (!officialPlayZoneFeatures(gj).length) {
      throw new Error('could not identify all four Zone 2 play areas');
    }
    S.zone2Official = gj;
    if (!S.playAreaMeta || S.playAreaMeta.type === 'zones') {
      setZonesPlayArea(false);
      markPlayMode('zones');
    }
    renderSourceRows();
    renderCal();
    return true;
  } catch (err) {
    console.warn('KortInfo Zone 2 unavailable; using traced fallback:', err.message);
    const status = $('#officialZoneStatus');
    if (status) status.textContent = 'KortInfo Zone 2 could not be loaded; the traced geometry is temporarily active. Use Reload official Zone 2 to retry.';
    return false;
  }
}

async function toggleRoute(key, btn) {
  const r = ROUTE_SOURCES[key];
  const ex = layerByKey('route:' + key);
  if (ex) { setLayerVisible(ex, !ex.visible); return; }

  if (btn) btn.classList.add('is-busy');
  setStatus(`Loading ${r.name}…`);
  try {
    const gj = r.kind === 'overpass'
      ? await fetchOverpass(r.filter)
      : await fetchFirst(gc2Urls(r.table));
    const { note } = normaliseCoords(gj);
    const rec = addLayer(r.name, gj, { key: 'route:' + key, kind: 'line' });
    if (rec) {
      setStatus(`${r.name}: ${rec.geojson.features.length} route lines on${note ? ' (' + note + ')' : ''}. ` +
                `Tap one on the map while the Bus route question is open.`);
    }
  } catch (err) {
    setStatus(`${r.name} failed — ${err.message}. Turn on the NT route map picture overlay instead ` +
              `and trace your route with the Bus route question's trace button.`, true);
  } finally {
    if (btn) btn.classList.remove('is-busy');
  }
}

/* ---------- fitting the zones to real geography ------------------------
   You spotted that the boundaries follow real features. They do — and
   better still, many of them follow the shoreline, which is unmistakable.
   The tracing recorded which vertices sit on water, so the app can pull
   the real coastline from OpenStreetMap and slide the zones onto it. */

function coastVertices() {
  const out = [];
  for (const z of window.ZONE3_PX || []) {
    const c = z.coast || [];
    for (let i = 0; i < z.ring.length; i++) if (c[i]) out.push(z.ring[i]);
  }
  return out;
}

function overpassCoastQuery() {
  const [s2, w, n, e] = OVERPASS_BBOX;
  return `[out:json][timeout:90];way(${s2},${w},${n},${e})["natural"="coastline"];out geom;`;
}

function parseOverpassPoints(json, stepKm) {
  const pts = [];
  for (const el of (json && json.elements) || []) {
    const g = el.geometry;
    if (!Array.isArray(g)) continue;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i];
      if (!a || !b || a.lon == null || b.lon == null) continue;
      const dx = (b.lon - a.lon) * 60.5, dy = (b.lat - a.lat) * 111.2;
      const n = Math.max(1, Math.round(Math.hypot(dx, dy) / (stepKm || 0.05)));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t]);
      }
    }
  }
  return pts;
}

/* Cheap nearest-neighbour over a fixed grid — plenty for a few thousand
   points, and it keeps the search loop fast enough to feel instant. */
function makeIndex(pts, cell) {
  const g = new Map();
  const key = (a, b) => a + ':' + b;
  for (const p of pts) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  return {
    nearest(x, y) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      for (let r = 1; r <= 4; r++) {
        let best = Infinity;
        for (let i = gx - r; i <= gx + r; i++) {
          for (let j = gy - r; j <= gy + r; j++) {
            const c = g.get(key(i, j));
            if (!c) continue;
            for (const p of c) {
              const dx = (p[0] - x) * 60.5, dy = (p[1] - y) * 111.2;
              const d = dx * dx + dy * dy;
              if (d < best) best = d;
            }
          }
        }
        if (best < Infinity) return Math.sqrt(best);
      }
      return null;
    }
  };
}

const median = (a) => {
  if (!a.length) return Infinity;
  const b = a.slice().sort((x, y) => x - y);
  return b[b.length >> 1];
};

/* ---------- snapping boundaries to the roads they follow ---------------
   Most district borders run down the middle of a street, and the traced
   outlines are pixel-quantised, so they wobble either side of the real
   line. But plenty of borders follow no road at all — a field edge, the
   railway, the shore — and in a city there is almost always *some* street
   within snapping range of those. Pulling every point onto its nearest
   road is what made the first attempt jitter.

   So a point only moves when its stretch of boundary genuinely follows a
   road: the road must run in the same direction as the boundary, and the
   same OSM way must be the best match for a run of consecutive points. */

const SNAP_MIN_RUN = 3;          // consecutive points that must agree
const SNAP_COS = 0.78;           // ~39 degrees of direction tolerance

function overpassRoadQuery() {
  const [s2, w, n, e] = OVERPASS_BBOX;
  // Named roads like Østre Allé are secondary/tertiary; residential is left
  // out because it bloats the download and borders rarely follow it.
  return `[out:json][timeout:120];way(${s2},${w},${n},${e})` +
         `["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"];out geom;`;
}

/* [ax, ay, bx, by, wayId] */
function roadSegments(json) {
  const segs = [];
  for (const el of (json && json.elements) || []) {
    const g = el.geometry;
    if (!Array.isArray(g)) continue;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i];
      if (!a || !b || a.lon == null || b.lon == null) continue;
      segs.push([a.lon, a.lat, b.lon, b.lat, el.id]);
    }
  }
  return segs;
}

const KX = 0.545;                       // cos(57°): lng degrees -> lat degrees

function projectToSegment(x, y, s) {
  const ax = s[0], ay = s[1], bx = s[2], by = s[3];
  const dx = (bx - ax) * KX, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? (((x - ax) * KX) * dx + (y - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
  const ex = (px - x) * KX, ey = py - y;
  return { x: px, y: py, d2: ex * ex + ey * ey, way: s[4], dx, dy, len2 };
}

function segmentIndex(segs, cell) {
  const g = new Map();
  const put = (i, j, v) => {
    const k = i + ':' + j;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(v);
  };
  segs.forEach((s) => {
    const i0 = Math.floor(Math.min(s[0], s[2]) / cell), i1 = Math.floor(Math.max(s[0], s[2]) / cell);
    const j0 = Math.floor(Math.min(s[1], s[3]) / cell), j1 = Math.floor(Math.max(s[1], s[3]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) put(i, j, s);
  });
  return {
    /* Best road within `maxDeg`. With a direction, only roads running
       roughly parallel to it count. */
    nearest(x, y, maxDeg, ux, uy) {
      const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
      const r = Math.max(1, Math.ceil(maxDeg / cell));
      let best = null;
      for (let i = gi - r; i <= gi + r; i++) {
        for (let j = gj - r; j <= gj + r; j++) {
          const c = g.get(i + ':' + j);
          if (!c) continue;
          for (const s of c) {
            const p = projectToSegment(x, y, s);
            if (p.d2 > maxDeg * maxDeg) continue;
            if (ux !== undefined && p.len2 > 0) {
              const l = Math.sqrt(p.len2);
              if (Math.abs((p.dx / l) * ux + (p.dy / l) * uy) < SNAP_COS) continue;
            }
            if (!best || p.d2 < best.d2) best = p;
          }
        }
      }
      return best;
    }
  };
}

/* Snapped positions are cached per pixel coordinate and the first result
   wins, so a vertex shared by two districts resolves identically in both
   and the zones stay joined. */
function snapRingsToRoads(index, toleranceM) {
  const tolDeg = (toleranceM / 1000) / 111.2;
  const cache = new Map();
  let moved = 0, total = 0;

  function mapRing(ring, gr) {
    const pts = ring.map(([x, y]) => pxToLngLat(x, y, gr));
    const n = Math.max(1, pts.length - 1);          // last repeats the first
    const cand = new Array(pts.length).fill(null);

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      let ux = (next[0] - prev[0]) * KX, uy = next[1] - prev[1];
      const l = Math.hypot(ux, uy);
      if (!l) continue;
      ux /= l; uy /= l;
      cand[i] = index.nearest(pts[i][0], pts[i][1], tolDeg, ux, uy);
    }

    // keep only runs of consecutive points that agree on the same road
    const use = new Array(pts.length).fill(false);
    let i = 0;
    while (i < n) {
      if (!cand[i]) { i++; continue; }
      let j = i;
      while (j + 1 < n && cand[j + 1] && cand[j + 1].way === cand[i].way) j++;
      if (j - i + 1 >= SNAP_MIN_RUN) for (let k = i; k <= j; k++) use[k] = true;
      i = j + 1;
    }

    return ring.map(([x, y], idx) => {
      const key = x.toFixed(1) + ',' + y.toFixed(1);
      if (cache.has(key)) return cache.get(key);
      const k = idx === pts.length - 1 ? 0 : idx;
      let p = pts[idx];
      if (use[k] && cand[k]) { p = [cand[k].x, cand[k].y]; moved++; }
      total++;
      cache.set(key, p);
      return p;
    });
  }
  return { mapRing, stats: () => ({ moved, total }) };
}

async function overpassJson(query) {
  const body = 'data=' + encodeURIComponent(query);
  const problems = [];
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return JSON.parse(await res.text());
    } catch (e) { problems.push(e.message); }
  }
  throw new Error(problems.join(' / '));
}

/* Named-road anchors, densified in pixel space so the comparison against
   the real road is even along its length. */
function referenceLines(stepPx) {
  const out = [];
  for (const r of window.REFERENCE_ROADS || []) {
    const pts = [];
    for (let i = 1; i < r.px.length; i++) {
      const a = r.px[i - 1], b = r.px[i];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / (stepPx || 2)));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    pts.push(r.px[r.px.length - 1]);
    out.push({ name: r.name, note: r.note, px: pts });
  }
  return out;
}

function overpassNamedRoadQuery(names) {
  const [s2, w, n, e] = OVERPASS_BBOX;
  const clause = names.map((nm) => `way(${s2},${w},${n},${e})["name"="${nm}"];`).join('');
  return `[out:json][timeout:90];(${clause});out geom;`;
}

/* All boundary vertices, thinned — the road term of the fit runs over these. */
function boundaryVertices(step) {
  const out = [];
  const push = (ring) => { for (let i = 0; i < ring.length; i += (step || 1)) out.push(ring[i]); };
  for (const z of window.ZONE3_PX || []) push(z.ring);
  return out;
}

/* Scale is what the roads pin down. A long straight road like Østre Allé
   only lines up with the boundary that runs along it at one size, so
   including the street network removes the need to touch the slider. */
function fitToGeography(coastVerts, coastPts, bndVerts, roadIdx, start, refs) {
  const coastIdx = makeIndex(coastPts, 0.01);
  const [ax, ay] = anchorPx();
  const g = { s: window.BASE_PX_DEG || 0.00031 };

  // The fit searches thousands of candidate placements, so thin every point
  // set down first — a few hundred per term locates the optimum just as well
  // and turns a 15-second wait on a phone into about a second.
  const thin = (arr, cap) => {
    if (arr.length <= cap) return arr;
    const step = arr.length / cap, out = [];
    for (let i = 0; i < arr.length; i += step) out.push(arr[Math.floor(i)]);
    return out;
  };
  const cVerts = thin(coastVerts, 120);
  const cPts = thin(coastPts, 200);      // only the anti-collapse reverse term
  const bVerts = thin(bndVerts, 200);
  const refIdx = (refs || []).map((r) => ({
    px: thin(r.px, 110), idx: makeIndex(r.real, 0.004), real: thin(r.real, 60)
  }));

  let useRoads = true;
  function evaluate(mul, lat, lng) {
    const s = g.s * mul;
    const lng0 = lng - s * ax, my0 = mercY(lat) + s * ay;
    const proj = (p) => [lng0 + s * p[0], invMercY(my0 - s * p[1])];

    const cv = cVerts.map(proj);
    const fwd = [];
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const p of cv) {
      const d = coastIdx.nearest(p[0], p[1]);
      if (d != null) fwd.push(d);
      if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
    }
    const back = makeIndex(cv, 0.01);
    const rev = [];
    for (const p of cPts) {
      if (p[0] < minx || p[0] > maxx || p[1] < miny || p[1] > maxy) continue;
      const d = back.nearest(p[0], p[1]);
      if (d != null) rev.push(d);
    }

    let road = 0;
    if (roadIdx && useRoads) {
      const ds = [];
      for (const v of bVerts) {
        const p = proj(v);
        const hit = roadIdx.nearest(p[0], p[1], 0.006);
        ds.push(hit ? Math.sqrt(hit.d2) * 111.2 : 0.7);
      }
      ds.sort((a, b) => a - b);
      road = ds.length ? ds[Math.floor(ds.length * 0.3)] : 0;   // the ones that do follow a road
    }
    // Named roads: Midtbyen's southern edge runs along Østre Allé, so lining
    // the two up fixes position and scale far more tightly than the coast can.
    let ref = 0;
    for (const r of refIdx) {
      const ds = [];
      for (const v of r.px) {
        const p = proj(v);
        const d = r.idx.nearest(p[0], p[1]);
        if (d != null) ds.push(d);
      }
      ref += median(ds);                       // "mostly along it" — median, not mean
      const back2 = makeIndex(r.px.map(proj), 0.004);
      const rv = [];
      for (const p of r.real) {
        const d = back2.nearest(p[0], p[1]);
        if (d != null) rv.push(d);
      }
      if (rv.length) ref += median(rv);        // the road's length constrains scale
    }
    return median(fwd) + (rev.length ? median(rev) : 3) + 2 * road + 4 * ref;
  }

  let best = { cost: Infinity, mul: start.mul, lat: start.lat, lng: start.lng };
  let centre = { mul: start.mul, lat: start.lat, lng: start.lng };
  let rMul = 0.4, rLat = 0.04, rLng = 0.07;
  for (let pass = 0; pass < 7; pass++) {
    useRoads = pass >= 2;                 // coast + named road locate it first
    for (let i = -3; i <= 3; i++) {
      const mul = centre.mul * Math.exp((i / 3) * Math.log(1 + rMul));
      if (mul < 0.5 || mul > 2.2) continue;
      for (let j = -3; j <= 3; j++) {
        const lat = centre.lat + (j / 3) * rLat;
        for (let k = -3; k <= 3; k++) {
          const lng = centre.lng + (k / 3) * rLng;
          const c = evaluate(mul, lat, lng);
          if (c < best.cost) best = { cost: c, mul, lat, lng };
        }
      }
    }
    centre = { mul: best.mul, lat: best.lat, lng: best.lng };
    rMul *= 0.5; rLat *= 0.5; rLng *= 0.5;
  }
  return best;
}

async function autoCalibrate(btn) {
  const verts = coastVertices();
  if (verts.length < 30) { toast('No shoreline vertices recorded to fit against.', true); return; }
  const original = btn.textContent;
  btn.disabled = true;
  setStatus('Asking OpenStreetMap for the shoreline and the street network…');
  try {
    btn.textContent = 'Fetching the coastline…';
    const coastJson = await overpassJson(overpassCoastQuery());
    const pts = parseOverpassPoints(coastJson, 0.05);
    if (pts.length < 200) throw new Error('the coastline came back almost empty');

    let roadIdx = null, segCount = 0;
    try {
      btn.textContent = 'Fetching the streets…';
      const roadJson = await overpassJson(overpassRoadQuery());
      const segs = roadSegments(roadJson);
      segCount = segs.length;
      if (segs.length > 500) {
        roadIdx = segmentIndex(segs, 0.004);
        S.roadIndex = roadIdx;              // reused by the snap button
      }
    } catch (_) { /* the coastline alone still gives a usable fit */ }

    // Named-road anchors, e.g. Midtbyen's southern edge along Østre Allé.
    const refs = [];
    const wanted = referenceLines(2);
    if (wanted.length) {
      try {
        btn.textContent = 'Finding Østre Allé…';
        const named = await overpassJson(overpassNamedRoadQuery(wanted.map((r) => r.name)));
        const byName = new Map();
        for (const el of (named && named.elements) || []) {
          const nm = el.tags && el.tags.name;
          if (!nm || !Array.isArray(el.geometry)) continue;
          if (!byName.has(nm)) byName.set(nm, []);
          for (const p of el.geometry) if (p && p.lon != null) byName.get(nm).push([p.lon, p.lat]);
        }
        for (const r of wanted) {
          const real = byName.get(r.name);
          if (real && real.length > 4) refs.push({ name: r.name, px: r.px, real });
        }
      } catch (_) { /* the fit still works without it */ }
    }

    btn.textContent = 'Lining everything up…';
    await new Promise((r) => setTimeout(r, 20));
    const best = fitToGeography(verts, pts, boundaryVertices(2), roadIdx,
                                S.cal || defaultCal(), refs);
    S.cal = { mul: best.mul, lat: best.lat, lng: best.lng };
    applyCal(true);

    const zones = buildAreaZones();
    const bb = zones ? turf.bbox(zones) : null;
    const across = bb ? turf.distance(turf.point([bb[0], bb[1]]), turf.point([bb[2], bb[1]]),
                                      { units: 'kilometers' }) * 1000 : 0;
    let refMsg = '';
    if (refs.length) {
      const gr = georef(), r = refs[0], ridx = makeIndex(r.real, 0.004), ds = [];
      for (const v of r.px) {
        const p = pxToLngLat(v[0], v[1], gr);
        const d = ridx.nearest(p[0], p[1]);
        if (d != null) ds.push(d * 1000);
      }
      ds.sort((a, b) => a - b);
      if (ds.length) refMsg = ` Midtbyen's southern edge sits about ` +
                              `${fmtDist(ds[ds.length >> 1])} from ${r.name}.`;
    }
    setStatus(`Fitted using ${refs.length ? refs[0].name + ', ' : ''}the shoreline` +
              `${roadIdx ? ` and ${segCount} road segments` : ''}. ` +
              `Scale set automatically — the zones span ${fmtDist(across)}.${refMsg}`);
    toast('Placed and scaled automatically.');
  } catch (err) {
    setStatus(`Could not fit automatically — ${err.message}. Pin the centre and use the slider instead.`, true);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

async function snapToRoads(btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Fetching roads…';
  setStatus("Asking OpenStreetMap for Aalborg's streets…");
  try {
    if (!S.roadIndex) {
      const json = await overpassJson(overpassRoadQuery());
      const segs = roadSegments(json);
      if (segs.length < 500) throw new Error('the road network came back almost empty');
      S.roadIndex = segmentIndex(segs, 0.004);
    }
    btn.textContent = 'Snapping…';
    await new Promise((r) => setTimeout(r, 20));
    S.snapOn = true;
    refreshDerivedLayers();
    if (S.playAreaMeta && S.playAreaMeta.type === 'zones') setZonesPlayArea(false);
    const st = S.lastSnap || { moved: 0, total: 0 };
    setStatus(`Snapped ${st.moved} of ${st.total} boundary points onto roads. ` +
              `The rest follow no road — a shoreline, a railway, a field edge — and were left ` +
              `alone on purpose. Reset undoes it.`);
    toast('Boundaries pulled onto the streets.');
    saveToUrl();
  } catch (err) {
    setStatus(`Could not snap to roads — ${err.message}.`, true);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

/* ---------- moving and scaling the overlay ----------------------------
   The shapes are already right; only placement needs setting, once. So the
   tools are the direct kind: drag the zones around with a finger, scale
   them about the map centre, nudge by an exact number of metres, and then
   bake the result into data.js so nobody ever does it again. */

let dragging = null;

function calStep() { return Number($('#calStepSel').value) || 25; }

/* Move the overlay by a distance in metres. The east-west conversion uses a
   fixed reference latitude rather than the current one, so a nudge and its
   opposite cancel exactly — otherwise repeated tweaking drifts. */
const NUDGE_REF_LAT = 57.05;
const M_PER_DEG_LNG = 111320 * Math.cos(NUDGE_REF_LAT * Math.PI / 180);

function nudgeCal(dxM, dyM) {
  const c = Object.assign({}, S.cal || defaultCal());
  c.lat += dyM / 111320;
  c.lng += dxM / M_PER_DEG_LNG;
  S.cal = c;
  applyCal(true);
}

/* Scale about the centre of the visible map, so what you are looking at
   stays put while the overlay grows or shrinks around it. */
function scaleCal(factor) {
  const c = Object.assign({}, S.cal || defaultCal());
  const mid = map.getCenter();
  const k = (c.mul || 1) * factor;
  if (k < 0.2 || k > 5) return;
  // keep the map centre fixed: the anchor moves relative to it by `factor`
  c.lng = mid.lng + (c.lng - mid.lng) * factor;
  const my = mercY(mid.lat) + (mercY(c.lat) - mercY(mid.lat)) * factor;
  c.lat = invMercY(my);
  c.mul = k;
  S.cal = c;
  applyCal(true);
}

function setCalMode(on) {
  S.calMode = on;
  document.body.classList.toggle('cal-mode', on);
  $('#calDrag').classList.toggle('is-picking', on);
  $('#calDrag').textContent = on ? 'Dragging on — tap to finish' : 'Drag the zones on the map';
  map.dragging[on ? 'disable' : 'enable']();
  if (on) {
    toast('Drag the map to move the zones. Pinch or use +/− to resize.');
    if (window.innerWidth <= 820) closeSheet();
  }
}

function calPointerDown(e) {
  if (!S.calMode) return;
  const p = e.touches ? e.touches[0] : e;
  dragging = { x: p.clientX, y: p.clientY };
}
function calPointerMove(e) {
  if (!S.calMode || !dragging) return;
  const p = e.touches ? e.touches[0] : e;
  const a = map.containerPointToLatLng([dragging.x, dragging.y]);
  const b = map.containerPointToLatLng([p.clientX, p.clientY]);
  const c = Object.assign({}, S.cal || defaultCal());
  c.lat += b.lat - a.lat;
  c.lng += b.lng - a.lng;
  S.cal = c;
  dragging = { x: p.clientX, y: p.clientY };
  applyCal(true, true);          // light repaint while the finger is down
  e.preventDefault();
}
function calPointerUp() {
  if (!dragging) return;
  dragging = null;
  applyCal(true);
}

/* The line to paste into data.js so this never has to be done again. */
function placementSnippet() {
  const c = S.cal || defaultCal();
  return `const PLACEMENT = { lat: ${c.lat.toFixed(6)}, lng: ${c.lng.toFixed(6)}, ` +
         `scale: ${(c.mul || 1).toFixed(5)} };`;
}

/* ---------- calibration ------------------------------------------------ */

function calSpanText() {
  const z = buildAreaZones();
  if (!z) return '—';
  const bb = turf.bbox(z);
  const km = turf.distance(turf.point([bb[0], bb[1]]), turf.point([bb[2], bb[1]]),
                           { units: 'kilometers' });
  return fmtDist(km * 1000) + ' across';
}

function renderCal() {
  const c = S.cal || defaultCal();
  $('#calScaleVal').textContent = ((c.mul || 1) * 100).toFixed(1) + '%';
  $('#calSpan').textContent = calSpanText();
  $('#calSnippet').value = placementSnippet();
  const status = $('#officialZoneStatus');
  if (status) {
    status.textContent = hasOfficialZonesPlayArea()
      ? 'Official Zone 2 is active. The play area is the exact union of Midtbyen, Nørresundby, Vest Aalborg and Øst Aalborg.'
      : 'Official Zone 2 loads automatically. Until KortInfo replies, the traced geometry is used only as a temporary fallback.';
  }
}

/* Rebuild anything derived from the transform, then repaint. */
function applyCal(silent, light) {
  refreshDerivedLayers();
  if (light) {
    // during a drag, skip the play-area rebuild and the fog recompute
    renderCal();
    return;
  }
  if (S.playAreaMeta && S.playAreaMeta.type === 'zones') setZonesPlayArea(false);
  else recompute();
  renderCal();
  saveToUrl();
  if (!silent) setStatus(`Zones now ${calSpanText()}.`);
}

$('#calAuto').addEventListener('click', (e) => autoCalibrate(e.target));

/* The four KortInfo layer IDs are now the defaults. This button retries
   official Zone 2 and immediately rebuilds the play area from its four named
   polygons; the calibration controls below affect only the traced fallback. */
$('#calLive').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = 'Loading official Zone 2…';
  setStatus('Loading Midtbyen, Nørresundby, Vest Aalborg and Øst Aalborg from KortInfo…');
  const ok = await loadOfficialZone2PlayArea();
  if (ok) {
    setStatus('Official Zone 2 loaded. The play area now follows the exact union of its four named areas.');
    toast('Official Zone 2 play area loaded.');
  } else {
    setStatus('KortInfo did not answer or all four area names could not be identified. The traced fallback remains active.', true);
  }
  btn.disabled = false;
  btn.textContent = was;
});
$('#calSnap').addEventListener('click', (e) => snapToRoads(e.target));

/* Three districts sit on the crop edge and came through unnamed; any name
   can be corrected here. Names never affect a zone answer. */
let renaming = false;
$('#calRename').addEventListener('click', () => {
  renaming = !renaming;
  $('#calRename').classList.toggle('is-picking', renaming);
  toast(renaming ? 'Tap a district on the map to rename it.' : 'Renaming off.');
  if (renaming && window.innerWidth <= 820) closeSheet();
});

function tryRename(ft) {
  if (!renaming || !ft.properties || ft.properties.idx == null) return false;
  const cur = ft.properties.navn || '';
  const next = prompt('Name this district', cur);
  if (next && next !== cur) {
    S.renames = Object.assign({}, S.renames, { [ft.properties.idx]: next });
    refreshDerivedLayers();
    saveToUrl();
    toast(`Renamed to ${next}.`);
  }
  renaming = false;
  $('#calRename').classList.remove('is-picking');
  openSheet();
  return true;
}

$('#calDrag').addEventListener('click', () => setCalMode(!S.calMode));

const mapEl = $('#map');
mapEl.addEventListener('mousedown', calPointerDown);
mapEl.addEventListener('touchstart', calPointerDown, { passive: false });
window.addEventListener('mousemove', calPointerMove);
window.addEventListener('touchmove', calPointerMove, { passive: false });
window.addEventListener('mouseup', calPointerUp);
window.addEventListener('touchend', calPointerUp);

$('#calBox').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.nudge) {
    const m = calStep();
    if (b.dataset.nudge === 'n') nudgeCal(0, m);
    if (b.dataset.nudge === 's') nudgeCal(0, -m);
    if (b.dataset.nudge === 'e') nudgeCal(m, 0);
    if (b.dataset.nudge === 'w') nudgeCal(-m, 0);
  }
  if (b.dataset.scale) scaleCal(Number(b.dataset.scale));
});

/* Arrow keys nudge too, while dragging mode is on. */
document.addEventListener('keydown', (e) => {
  if (!S.calMode) return;
  const m = calStep();
  const k = { ArrowUp: [0, m], ArrowDown: [0, -m], ArrowLeft: [-m, 0], ArrowRight: [m, 0] }[e.key];
  if (!k) return;
  nudgeCal(k[0], k[1]);
  e.preventDefault();
});

$('#calCopy').addEventListener('click', async () => {
  const line = placementSnippet();
  try { await navigator.clipboard.writeText(line); toast('Copied. Paste it over PLACEMENT in data.js.'); }
  catch (_) { $('#calSnippet').select(); toast('Select and copy the line above.'); }
});

$('#calReset').addEventListener('click', () => {
  S.cal = defaultCal();
  S.roadIndex = null; S.snapOn = false;   // also drops any road snapping
  setCalMode(false);
  applyCal();
});

/* ---------- layers tab UI --------------------------------------------- */

function sourceRow(label, meta, state, onTap, onGear) {
  const row = document.createElement('div');
  row.className = 'src-row';
  const dot = state === 'on' ? '◉' : state === 'off' ? '○' : '·';
  row.innerHTML = `
    <button class="row-btn src-main${state === 'on' ? ' is-on' : ''}">
      <span class="row-title"><span class="src-dot">${dot}</span>${escapeHtml(label)}</span>
      <span class="row-meta">${escapeHtml(meta)}</span>
    </button>${onGear ? '<button class="icon-btn src-gear" title="Edit source">⚙</button>' : ''}`;
  const main = row.querySelector('.src-main');
  main.addEventListener('click', () => onTap(main));
  if (onGear) row.querySelector('.src-gear').addEventListener('click', onGear);
  return row;
}

function renderSourceRows() {
  const zbox = $('#zoneSources');
  zbox.innerHTML = '';
  Object.entries(S.sources).forEach(([key, src]) => {
    const rec = layerByKey('src:' + key);
    const state = !rec ? 'idle' : rec.visible ? 'on' : 'off';
    const meta = rec ? `${rec.geojson.features.length} zones${state === 'on' ? '' : ' · hidden'}`
                     : (src.url ? (src.typeName || src.url) : 'not configured — tap ⚙');
    const row = sourceRow(src.name, meta, state,
      (btn) => toggleSource(key, btn), () => openSourceEditor(key));
    zbox.appendChild(row);
  });

  const rbox = $('#routeSources');
  rbox.innerHTML = '';
  Object.entries(ROUTE_SOURCES).forEach(([key, r]) => {
    const rec = layerByKey('route:' + key);
    const state = !rec ? 'idle' : rec.visible ? 'on' : 'off';
    const meta = rec ? `${rec.geojson.features.length} routes${state === 'on' ? '' : ' · hidden'}`
                     : (r.meta || r.table);
    rbox.appendChild(sourceRow(r.name, meta, state, (btn) => toggleRoute(key, btn), null));
  });
}

function renderWmsList() {
  const box = $('#wmsList');
  box.innerHTML = '';
  WMS_PRESETS.forEach((p) => {
    const ex = S.wms.find((w) => w.name === p.name);
    const state = !ex ? 'idle' : ex.visible ? 'on' : 'off';
    box.appendChild(sourceRow(p.name,
      state === 'idle' ? 'Picture overlay — readable, not tappable'
                       : (state === 'on' ? 'on' : 'hidden'),
      state, () => toggleWms(p), null));
  });
}

function toggleWms(preset) {
  const ex = S.wms.find((w) => w.name === preset.name);
  if (ex) {
    ex.visible = !ex.visible;
    if (ex.visible) ex.leaflet.addTo(map); else map.removeLayer(ex.leaflet);
    renderWmsList();
    return;
  }
  addWms(preset.name, preset.url, preset.layers);
}

function addWms(name, url, layers) {
  const lyr = L.tileLayer.wms(url, {
    layers, format: 'image/png', transparent: true, pane: 'wmsPane', opacity: 0.9
  });
  let warned = false;
  lyr.on('tileerror', () => {
    if (warned) return;
    warned = true;
    setStatus(`${name}: the image service did not answer. Check the URL behind ⚙.`, true);
  });
  lyr.addTo(map);
  S.wms.push({ id: uid(), name, url, layers, visible: true, leaflet: lyr });
  renderWmsList();
  return lyr;
}

/* --- source editor --- */
let editingKey = null;

function openSourceEditor(key) {
  editingKey = key;
  const src = S.sources[key];
  $('#srcTitle').textContent = src.name;
  $('#srcNote').textContent = src.note || '';
  $('#srcKind').value = src.kind === 'geojson' ? 'geojson' : 'wfs';
  $('#srcUrl').value = src.url || '';
  $('#srcType').value = src.typeName || '';
  $('#srcCql').value = src.cql || '';
  $('#srcName').value = src.nameField || '';
  syncSrcKind();
  $('#srcBrowseBox').hidden = true;
  $('#srcFilter').value = '';
  $('#srcModal').hidden = false;
}
function syncSrcKind() {
  const wfs = $('#srcKind').value === 'wfs';
  $$('[data-wfs-only]').forEach((el) => { el.hidden = !wfs; });
}
$('#srcKind').addEventListener('change', syncSrcKind);

let browsed = [];
function renderBrowseList() {
  const q = $('#srcFilter').value.trim().toLowerCase();
  const hits = browsed.filter((l) =>
    !q || l.name.toLowerCase().includes(q) || l.title.toLowerCase().includes(q));
  $('#srcList').innerHTML = hits.slice(0, 60).map((l, i) =>
    `<button class="src-item" data-i="${browsed.indexOf(l)}">
       <span class="src-item-title">${escapeHtml(l.title)}</span>
       <span class="src-item-name">${escapeHtml(l.name)}</span>
     </button>`).join('') ||
    '<p class="hint">Nothing matches that filter.</p>';
  $$('#srcList .src-item').forEach((b) => b.addEventListener('click', () => {
    $('#srcType').value = browsed[Number(b.dataset.i)].name;
    $('#srcBrowseBox').hidden = true;
  }));
}
$('#srcFilter').addEventListener('input', renderBrowseList);

$('#srcBrowse').addEventListener('click', async () => {
  const url = $('#srcUrl').value.trim();
  if (!url) { toast('Put the service URL in first.', true); return; }
  const btn = $('#srcBrowse');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Asking the server…';
  try {
    browsed = await browseLayers(url);
    $('#srcBrowseBox').hidden = false;
    renderBrowseList();
    btn.textContent = `${browsed.length} layers — filter below`;
  } catch (err) {
    btn.textContent = original;
    toast('Could not list layers: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
});
$('#srcCancel').addEventListener('click', () => { $('#srcModal').hidden = true; });
$('#srcSave').addEventListener('click', () => {
  const src = S.sources[editingKey];
  src.kind = $('#srcKind').value;
  src.url = $('#srcUrl').value.trim();
  src.typeName = $('#srcType').value.trim();
  src.cql = $('#srcCql').value.trim();
  src.nameField = $('#srcName').value.trim();
  $('#srcModal').hidden = true;
  removeLayerByKey('src:' + editingKey);   // force a refetch with the new settings
  if (editingKey === 'zone2') S.zone2Official = null;
  renderSourceRows();
  toggleSource(editingKey, null);
});

/* --- file / draw --- */
$('#zoneFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const gj = JSON.parse(r.result);
      normaliseCoords(gj);
      addLayer(file.name.replace(/\.(geo)?json$/i, ''), gj);
    } catch (err) { toast('Could not read that file: ' + err.message, true); }
  };
  r.readAsText(file);
  e.target.value = '';
});

$('#drawZoneBtn').addEventListener('click', () => {
  startDrawing('Tap the corners of the zone', (poly) => {
    const name = prompt('Name this zone', 'My zone') || 'My zone';
    poly.properties = { navn: name };
    addLayer(name, { type: 'FeatureCollection', features: [poly] });
    openSheet();
  });
});

/* ---------- geolocation ------------------------------------------------ */

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
    L.circle([coord[1], coord[0]], { radius: Math.min(acc || 40, 200),
      color: '#2ee6a8', weight: 1, fillColor: '#2ee6a8', fillOpacity: .12 }),
    L.circleMarker([coord[1], coord[0]], { radius: 6, color: '#0d141d',
      weight: 2.5, fillColor: '#2ee6a8', fillOpacity: 1 })
  ]).addTo(map);
}

$('#locateBtn').addEventListener('click', () =>
  locate((c) => map.setView([c[1], c[0]], Math.max(map.getZoom(), 15))));

/* ---------- tabs & sheet ------------------------------------------------ */

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

/* ---------- game settings ----------------------------------------------- */

function applyUnits() {
  $$('#unitSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.units === S.units));
  $('#playRadiusUnit').textContent = bigUnit();
  if (S.playAreaMeta && S.playAreaMeta.type === 'circle') {
    $('#playRadius').value = trimNum(mToBig(S.playAreaMeta.radiusKm * 1000).toFixed(2));
  }
  renderToolForm();
  recompute();
}

$('#unitSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.units = b.dataset.units;
  applyUnits();
});

const PLAY_NOTES = {
  zones:   'Exact union of Midtbyen, Nørresundby, Vest Aalborg and Øst Aalborg from official Zone 2.',
  circle:  'A plain circle, if you want a smaller game.',
  kommune: 'The whole municipality — much bigger than the four play zones.'
};

function markPlayMode(mode) {
  $$('#playSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.area === mode));
  $('#radiusField').hidden = mode !== 'circle';
  $('#playNote').textContent = mode === 'zones' && !hasOfficialZonesPlayArea()
    ? 'Traced fallback while official Zone 2 loads; exact same four-area mode.'
    : (PLAY_NOTES[mode] || '');
}

async function setPlayMode(mode) {
  if (mode === 'zones') {
    if (setZonesPlayArea()) {
      markPlayMode('zones');
      toast(hasOfficialZonesPlayArea()
        ? 'Play area: the four official Zone 2 areas.'
        : 'Play area: traced fallback while KortInfo loads.');
      if (!hasOfficialZonesPlayArea()) await loadOfficialZone2PlayArea();
    } else toast('Could not build the four Zone 2 play areas.', true);
    return;
  }
  if (mode === 'circle') {
    markPlayMode('circle');
    const n = Number($('#playRadius').value) || CONFIG.playRadiusMi;
    setCircularPlayArea(map.getCenter(), bigToM(n) / 1000);
    return;
  }
  markPlayMode('kommune');
  try {
    const gj = await fetchGeoJson(`${CONFIG.dawa}/kommuner/0${CONFIG.kommunekode}?format=geojson`);
    normaliseCoords(gj);
    const ft = gj.type === 'FeatureCollection' ? gj.features[0] : gj;
    setCustomPlayArea(ft, 'Aalborg Kommune');
    S.playAreaMeta.mode = 'kommune';
    toast('Play area: Aalborg Kommune.');
  } catch (err) {
    toast('Could not fetch the municipality outline: ' + err.message, true);
    markPlayMode(S.playAreaMeta && S.playAreaMeta.type === 'zones' ? 'zones' : 'circle');
  }
}

$('#playSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setPlayMode(b.dataset.area);
});

$('#applyRadius').addEventListener('click', () => {
  const n = Number($('#playRadius').value);
  if (!n || n <= 0) return;
  setCircularPlayArea(map.getCenter(), bigToM(n) / 1000);
  markPlayMode('circle');
  toast(`Play area: ${trimNum(n.toString())} ${bigUnit()} around the map centre.`);
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

/* ---------- save / share -------------------------------------------------- */

function serialize() {
  return {
    v: 3,
    sourceConfigVersion: SOURCE_CONFIG_VERSION,
    units: S.units,
    playAreaMeta: S.playAreaMeta,
    base: S.baseKey,
    fog: S.fogOpacity,
    sources: S.sources,
    cal: S.cal,
    renames: S.renames,
    wms: S.wms.map((w) => ({ name: w.name, url: w.url, layers: w.layers, visible: w.visible })),
    constraints: S.constraints.map((c) => {
      const o = Object.assign({}, c);
      delete o.error;
      if (o.geometry) {
        try {
          o.geometry = turf.simplify(turf.feature(o.geometry),
            { tolerance: 0.0004, highQuality: false }).geometry;
        } catch (_) { /* keep as-is */ }
      }
      return o;
    })
  };
}

function deserialize(data) {
  if (!data || !data.constraints) return false;
  S.constraints = data.constraints;
  S.seq = S.constraints.length + 1;
  S.zone2Official = null;
  if (data.units) S.units = data.units;
  // Source settings from older links were based on the traced/legacy defaults.
  // Do not let them silently replace the four official KortInfo layers.
  S.sources = JSON.parse(JSON.stringify(DEFAULT_SOURCES));
  if (data.sourceConfigVersion === SOURCE_CONFIG_VERSION && data.sources) {
    S.sources = Object.assign(S.sources, data.sources);
  }
  if (data.cal) S.cal = data.cal;
  if (data.renames) S.renames = data.renames;
  if (typeof data.fog === 'number') { S.fogOpacity = data.fog; $('#fogRange').value = Math.round(data.fog * 100); }

  const m = data.playAreaMeta;
  if (m && m.type === 'zones') {
    setZonesPlayArea(false);
    markPlayMode('zones');
  } else if (m && m.type === 'circle') {
    S.playArea = turf.circle(m.center, m.radiusKm, { steps: 256, units: 'kilometers' });
    S.playAreaMeta = m;
    markPlayMode('circle');
  } else if (m && m.type === 'custom' && m.geometry) {
    S.playArea = turf.feature(m.geometry);
    S.playAreaMeta = m;
    markPlayMode(m.mode === 'kommune' ? 'kommune' : 'circle');
  }
  (data.wms || []).forEach((w) => { if (w.visible) addWms(w.name, w.url, w.layers); });
  renderWmsList();

  renderSourceRows();
  renderCal();
  applyUnits();
  try { map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [24, 24] }); } catch (_) {}
  loadOfficialZone2PlayArea();
  return true;
}

function b64encode(str) {
  return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
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
  try { await navigator.clipboard.writeText(location.href); toast('Link copied. Send it to your co-seeker.'); }
  catch (_) { prompt('Copy this link:', location.href); }
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

/* ---------- boot ------------------------------------------------------------ */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#srcModal').hidden) { $('#srcModal').hidden = true; return; }
  if (drawing.on) { stopDrawing(); return; }
  if (picker.slot) { endPick(); return; }
  if (activeTool) selectTool(activeTool);
});

S.cal = defaultCal();
if (!setZonesPlayArea(false)) {
  setCircularPlayArea(L.latLng(CONFIG.center[0], CONFIG.center[1]), CONFIG.playRadiusMi * MI / 1000);
  markPlayMode('circle');
} else {
  markPlayMode('zones');
  try { map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [16, 16] }); } catch (_) {}
}
renderSourceRows();
renderWmsList();
renderLayerList();
renderCal();
const restoredFromUrl = loadFromUrl();
if (!restoredFromUrl) applyUnits();
renderToolForm();
// Do not block first paint: the traced union is already usable. In a real
// browser this replaces it with the exact official Zone 2 union as soon as
// KortInfo answers. Test environments without window.fetch keep the fallback.
if (!restoredFromUrl) loadOfficialZone2PlayArea();

/* Exposed so you can poke at a live game from the browser console. */
window.HS = {
  map, S, CONFIG, draft, drawing, RADAR_PRESETS,
  recompute, addLayer, addWms, setCircularPlayArea, setCustomPlayArea,
  toggleSource, toggleRoute, toggleWms, setLayerVisible, layerByKey,
  unionAll, usePlayAreaFromLayer, parseWfsCapabilities, browseLayers, parseGml, KORTINFO, SOURCE_CONFIG_VERSION,
  buildDistrictZones, buildAreaZones, zonesPlayArea, hasOfficialZonesPlayArea,
  prepareOfficialZone2, officialPlayZoneFeatures, playZoneDef, loadOfficialZone2PlayArea, georef, pxToLngLat,
  defaultCal, anchorPx, applyCal, autoCalibrate,
  nudgeCal, scaleCal, setCalMode, placementSnippet, georef,
  snapToRoads, snapRingsToRoads, segmentIndex, roadSegments, SNAP_MIN_RUN,
  fitToGeography, boundaryVertices, overpassJson,
  referenceLines, overpassNamedRoadQuery,
  projectToSegment, overpassRoadQuery,
  coastVertices, parseOverpassPoints, makeIndex, overpassCoastQuery,
  __mercY: mercY, __invMercY: invMercY,
  setZonesPlayArea, setPlayMode, refreshDerivedLayers,
  parseOverpassRoutes, overpassQuery, fetchOverpass, areaCategory, AREA_STYLE,
  rammeCategory, zonekortCategory, categoryFor, RAMME_STYLE, RAMME_OTHER, RAMME_LEGEND, ZONEKORT_STYLE,
  renderSourceRows, renderLegend, gc2Urls,
  serialize, deserialize, b64encode, b64decode,
  constraintPolygon, halfPlane, voronoiCell, normaliseCoords, featureName,
  inferNameField, rankedNameFields, prepareSourceLabels,
  renderToolForm, selectTool, switchTab,
  fmtDist, fmtArea, wfsUrl, gc2Url
};
