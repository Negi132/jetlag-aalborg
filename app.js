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
  { label: '5 mi',    m: 5 * MI },
  { label: '10 mi',   m: 10 * MI },
  { label: '25 mi',   m: 25 * MI },
  { label: '50 mi',   m: 50 * MI },
  { label: '100 mi',  m: 100 * MI }
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

/* OpenStreetMap remains the fallback for route data and the primary source
   for trains. The bus layer below prefers NT's own separated route families. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const OVERPASS_BBOX = [56.94, 9.70, 57.18, 10.25];   // S, W, N, E — greater Aalborg

/* NT publishes the route families as separate vector layers. Loading only
   OpenStreetMap omitted several Aalborg lines, especially the yellow local
   and secondary city routes. The bus toggle now combines every NT bus family
   and uses OSM only as a fallback/supplement when an NT table is unavailable. */
const NT_BUS_TABLES = [
  { key: 'city',    label: 'city',    table: 'rutekortweb.ntmap_bybus_murl' },
  { key: 'regional',label: 'regional',table: 'rutekortweb.ntmap_regionalbus_murl' },
  { key: 'xbus',    label: 'X bus',   table: 'rutekortweb.ntmap_xbus_murl' },
  { key: 'local',   label: 'local',   table: 'rutekortweb.ntmap_lokalbus_murl' },
  { key: 'telebus', label: 'telebus', table: 'rutekortweb.ntmap_telebus_murl' }
];

/* NT's public map also publishes secondary/branch runs as separate layers
   ("biforløb"). Their exact table names can change, so discover them from
   WFS capabilities instead of maintaining another brittle hard-coded list. */
const NT_ROUTE_WFS = `${GC2}/wfs/nt/rutekortweb/4326`;
const NT_BUS_LAYER_WORDS = /(?:bybus|regionalbus|lokalbus|telebus|xbus|expresbus)/i;
const NT_BUS_LAYER_EXCLUDE = /(?:stoppested|station|zone|takst|tog|train|bane)/i;

/* A small route can occasionally be absent even from NT's public vector map.
   These definitions are a final fallback: locate the listed public-transport
   stops in OpenStreetMap and ask OSRM to follow the road network through them.
   The route is inserted only when no loaded source already contains its ref. */
const REQUIRED_BUS_ROUTE_SUPPLEMENTS = [
  {
    ref: '38',
    name: 'Aalborg St. – Klitgård via Hasseris',
    anchors: [
      ['Aalborg St', 'Aalborg Station', 'Aalborg Busterminal'],
      ['Prinsensgade'],
      ['Sankt Jørgens Gade', 'Sct Jørgens Gade'],
      ['Skovbakkevej'],
      ['Fyrrebakken'],
      ['Hundeklemmen'],
      ['Nørholmsvej'],
      ['Nældevej'],
      ['Nørholm'],
      ['Klitgård', 'Klitgaard']
    ]
  }
];

const ROUTE_PALETTE = [
  '#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8f5bd7', '#d97706',
  '#00a6a6', '#c44569', '#6a994e', '#4361ee', '#b56576', '#118ab2',
  '#ef476f', '#7b2cbf', '#3a86ff', '#bc6c25', '#219ebc', '#9b5de5'
];
const ROUTE_DASHES = ['18 5', '14 6', '10 5', '20 7', '7 4'];

const ROUTE_SOURCES = {
  bus:   { name: 'All bus routes',
           meta: 'NT official · main and branch routes, plus missing-route fallback',
           kind: 'nt-all', tables: NT_BUS_TABLES, fallbackFilter: '["route"="bus"]' },
  train: { name: 'Train lines', meta: 'OpenStreetMap · tappable', kind: 'overpass',
           filter: '["route"~"^(train|light_rail)$"]' }
};

const TRANSIT_STOP_SOURCE = {
  name: 'Bus & train stops',
  meta: 'OpenStreetMap · bus stops, rail stations and halts'
};


/* Matching cards that can be populated automatically from OpenStreetMap.
   The geometry used for the game is a representative point for each mapped
   place (node coordinate or Overpass' centre for an area/relation). This keeps
   the existing nearest-point/Voronoi rules deterministic while still letting
   parks, zoos, airports, golf courses, etc. be mapped as areas in OSM. */
const OFFICIAL_AALBORG_PARKS = [
  'Budolfihaven', 'Bundgårdsparken', 'Den Gamle Golfbane', 'Jomfru Ane Parken',
  'Karolinelund', 'Kildeparken', 'Lindholm Fjordpark', 'Lindholm Strandpark',
  'Mulighedernes Park', 'Mølleparken', 'Nordens Kridtgrav', 'Skanseparken',
  'Sofiendal Enge klimapark', 'Sohngårdsholmparken', 'Stigsparken',
  'Svanemølleparken i Svenstrup', 'Urtehaven i Nørresundby',
  'Vestre Fjordpark', 'Østre Anlæg'
];

/* The Jet Lag card says "park", but Aalborg Kommune keeps some very park-like,
   publicly accessible recreational green areas on its separate "Naturområder og
   skove" page. Keep this list deliberately curated instead of accepting every
   OSM grass/nature polygon: that avoids bringing gardens/back yards back while
   still treating Østerådalen the way a local player reasonably would. */
const AALBORG_PARK_ADJACENT_EXACT = [
  'Østerådalen', 'Østerådalen Nord', 'Østerådalen Syd',
  // Both are mapped as leisure=park in OSM but are absent from the municipality's
  // short public "parks and green areas" list. Municipal planning/visitor material
  // nevertheless treats them as significant public green/recreational areas.
  'Golfparken', 'Vandbakken'
];
const AALBORG_PARK_ADJACENT_FALLBACK = [
  // Representative points only; Matching currently models all places as points.
  // Nord: around the Infohuset/Over Kæret part of the valley.
  { name: 'Østerådalen Nord', coordinates: [9.91342, 57.02087] },
  // Syd: representative midpoint between Indkildevej and Dall Møllevej.
  { name: 'Østerådalen Syd', coordinates: [9.8890, 56.9915] },
  // OSM way centres. These fallbacks make the two well-known green areas
  // available even if Overpass is temporarily unavailable.
  { name: 'Golfparken', coordinates: [9.95498, 57.02563] },
  { name: 'Vandbakken', coordinates: [9.93371, 57.03202] }
];

/* Beyond the explicit municipal/curated names, accept a named OSM leisure=park
   automatically when it is a substantial public green space. This captures places
   similar to Golfparken and Vandbakken without returning to the old "anything green"
   rule that admitted tiny residential lawns/back yards. Official/curated names are
   never subject to this size threshold. */
const PARK_AUTO_MIN_AREA_M2 = 10000; // 1 hectare

/* Aalborg Bibliotekerne's current organisation is ten physical libraries plus
   Haraldslund as a service point. Keep the whole official set here, even though
   the small Aalborg game-area filter will later discard branches outside the four
   Zone-2 areas. Addresses are retained so a missing OSM branch can be resolved
   through Dataforsyningen instead of silently disappearing. */
const AALBORG_LIBRARY_LOCATIONS = [
  { name: 'Hovedbiblioteket i Aalborg', address: 'Rendsburggade 2, 9000 Aalborg', coordinates: [9.9275896, 57.0472572] },
  { name: 'Haraldslund', address: 'Kastetvej 83, 9000 Aalborg', coordinates: [9.89904347, 57.05420492], servicePoint: true },
  { name: 'Hasseris Bibliotek', address: 'Thulebakken 46, 9000 Aalborg', coordinates: [9.88452416, 57.03559821] },
  { name: 'Nørresundby Bibliotek', address: 'Torvet 5, 9400 Nørresundby', coordinates: [9.9231595, 57.05896286] },
  { name: 'Trekanten - Bibliotek og Kulturhus', address: 'Sebbersundvej 2A, 9220 Aalborg Øst', coordinates: [10.0008729, 57.0276469] },
  { name: 'Vejgaard Bibliotek', address: 'Hadsundvej 35, 9000 Aalborg', coordinates: [9.95176, 57.04130] },
  { name: 'Svenstrup Bibliotek', address: 'Godthåbsvej 14B, 9230 Svenstrup J' },
  { name: 'Vodskov Bibliotek', address: 'Brorsonsvej 3B, 9310 Vodskov' },
  { name: 'Storvorde Bibliotek', address: 'Stationsvej 5, 9280 Storvorde' },
  { name: 'Nibe Bibliotek', address: 'St Algade 4, 9240 Nibe' },
  { name: 'Hals Bibliotek', address: 'Østergade 2A, 9370 Hals' }
];

const OFFICIAL_AALBORG_LIBRARIES = [
  ...AALBORG_LIBRARY_LOCATIONS.map((x) => x.name),
  // Common/OSM aliases. The aa/å normaliser below makes Vejgaard/Vejgård
  // equivalent, but keeping the visible alias also helps older cached data.
  'Aalborg Hovedbibliotek', 'Haraldslund Bibliotek', 'Trekanten', 'Vejgård Bibliotek'
];

/* Authoritative fallbacks are used only when needed. Entries without hard-coded
   coordinates are geocoded from the official address through Dataforsyningen at
   question-load time. This keeps the official list complete without trusting
   stale OSM coordinates after a library move. */
const AALBORG_LIBRARY_FALLBACK = AALBORG_LIBRARY_LOCATIONS.map((x) => ({
  ...x, authoritative: true
}));

const MATCHING_POI_DEFS = {
  'commercial airport': {
    key: 'airport', singular: 'commercial airport', plural: 'commercial airports',
    filters: ['["aeroway"="aerodrome"]["iata"]'],
    // Aalborg Airport (AAL). Kept as a fallback because Overpass occasionally
    // times out even for this tiny category.
    fallback: [{ name: 'Aalborg Airport (AAL)', coordinates: [9.849243, 57.092759] }]
  },
  'park': {
    key: 'park', singular: 'park', plural: 'parks',
    filters: ['["leisure"="park"]', '["leisure"="nature_reserve"]', '["boundary"="protected_area"]["name"]'],
    officialNames: OFFICIAL_AALBORG_PARKS,
    officialExactNames: AALBORG_PARK_ADJACENT_EXACT,
    fallback: AALBORG_PARK_ADJACENT_FALLBACK
  },
  'amusement park': {
    key: 'amusement', singular: 'amusement park', plural: 'amusement parks',
    filters: ['["tourism"="theme_park"]']
  },
  'zoo': {
    key: 'zoo', singular: 'zoo', plural: 'zoos', filters: ['["tourism"="zoo"]']
  },
  'aquarium': {
    key: 'aquarium', singular: 'aquarium', plural: 'aquariums', filters: ['["tourism"="aquarium"]']
  },
  'golf course': {
    key: 'golf', singular: 'golf course', plural: 'golf courses', filters: ['["leisure"="golf_course"]'],
    fallback: [
      { name: 'Aalborg Golf Klub', coordinates: [9.782950, 57.026760] },
      { name: 'Ørnehøj Golfklub', coordinates: [9.968050, 56.987570] }
    ]
  },
  'museum': {
    key: 'museum', singular: 'museum', plural: 'museums', filters: ['["tourism"="museum"]']
  },
  'movie theater': {
    key: 'cinema', singular: 'movie theater', plural: 'movie theaters', filters: ['["amenity"="cinema"]']
  },
  'hospital': {
    key: 'hospital', singular: 'hospital', plural: 'hospitals',
    filters: ['["amenity"="hospital"]', '["healthcare"="hospital"]']
  },
  'library': {
    key: 'library', singular: 'library', plural: 'libraries', filters: ['["amenity"="library"]'],
    officialNames: OFFICIAL_AALBORG_LIBRARIES,
    fallback: AALBORG_LIBRARY_FALLBACK
  },
  'foreign consulate': {
    key: 'consulate', singular: 'foreign consulate', plural: 'foreign consulates',
    filters: ['["office"="diplomatic"]["diplomatic"="consulate"]', '["amenity"="consulate"]']
  }
};

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
  transitStops: { loaded: false, visible: false, loading: false, geojson: null, layer: null,
                  busCount: 0, trainCount: 0 },
  seq: 1
};

/* Network-backed administrative layers can take several seconds on mobile.
   Keep loading state separate from the saved game: it is UI-only and lets
   both the Layers tab and map show that something is actually happening. */
const zoneLoads = new Set();
const mapLoadTasks = new Map();

/* ---------- helpers ------------------------------------------------ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => 'c' + (S.seq++) + Math.random().toString(36).slice(2, 6);

function zoneLevelName(key) {
  const m = String(key || '').match(/^zone([1-4])$/);
  return m ? `Zone ${m[1]}` : 'zone';
}
function updateZoneLoadProgress() {
  const box = $('#zoneLoadProgress');
  const text = $('#zoneLoadProgressText');
  if (!box || !text) return;
  const parts = Array.from(mapLoadTasks.values()).filter(Boolean);
  box.hidden = !parts.length;
  if (parts.length) text.textContent = `Loading ${parts.join(' + ')}…`;
}
function setMapLoadingTask(key, label, on = true) {
  if (on && label) mapLoadTasks.set(String(key), String(label));
  else mapLoadTasks.delete(String(key));
  updateZoneLoadProgress();
}
function setQuestionMapLoading(label) {
  setMapLoadingTask('question', label, !!label);
}
function setZoneLoading(key, on) {
  if (on) zoneLoads.add(key); else zoneLoads.delete(key);
  setMapLoadingTask(`zone:${key}`, `${zoneLevelName(key)} boundaries`, on);
  if ($('#zoneSources')) renderSourceRows();
}

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

function thermometerBisectorLine(a, b) {
  if (!a || !b) return null;
  const mid = turf.midpoint(turf.point(a), turf.point(b)).geometry.coordinates;
  const brg = turf.bearing(turf.point(a), turf.point(b));
  const L = Math.max(20, playSpanKm() * 1.5);
  const STEPS = 64;
  const edge = [];
  for (let i = -STEPS; i <= STEPS; i++) {
    const d = (i / STEPS) * L;
    edge.push(d === 0 ? mid
      : turf.destination(mid, Math.abs(d), d > 0 ? brg + 90 : brg - 90,
          { units: 'kilometers' }).geometry.coordinates);
  }
  return turf.lineString(edge);
}

function voronoiCell(points, i) {
  if (!points || points.length === 0 || i == null || !points[i] || !S.playArea) return null;
  if (points.length === 1) return turf.clone(S.playArea);

  // IMPORTANT: do not use turf.voronoi here. d3-voronoi treats raw lng/lat
  // degrees as Cartesian coordinates, while nearest-place selection uses
  // geodesic distance. At Aalborg's latitude that makes east/west distances
  // substantially distorted and can put the displayed boundary on the wrong
  // side of two close candidates. Build the selected cell from spherical
  // perpendicular bisectors instead so selection and shading use the same
  // distance model.
  let cell = turf.clone(S.playArea);
  const chosen = points[i];
  for (let j = 0; j < points.length; j++) {
    if (j === i || !points[j]) continue;
    let separation = 0;
    try { separation = turf.distance(turf.point(chosen), turf.point(points[j]), { units: 'meters' }); }
    catch (_) { continue; }
    // Duplicate/near-duplicate OSM representations should not create a
    // numerically tiny wedge.
    if (separation < 2) continue;
    const nearerChosen = halfPlane(points[j], chosen, true);
    cell = gIntersect(cell, nearerChosen);
    if (!cell) return null;
  }
  return cell;
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
    case 'borderDistance': {
      const band = c.geometry ? turf.feature(c.geometry) : null;
      if (!band) return null;
      return c.answer === 'closer' ? band : invert(band);
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
    case 'photo':
      return turf.clone(play);
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
      return { kind: 'Thermometer',
               text: c.requiredDistanceLabel ? `At least ${c.requiredDistanceLabel} · endpoints ${fmtDist(c.travelM)} apart` : `Moved ${fmtDist(c.travelM)}`,
               ans: c.answer === 'hotter' ? 'Hotter' : 'Colder' };
    case 'measuring':
      return { kind: 'Measuring', text: `Compared to seeker, vs ${c.targetName || 'target'}`,
               ans: c.answer === 'closer' ? 'Closer' : 'Further' };
    case 'borderDistance':
      return { kind: 'Measuring',
               text: `${c.borderName || `Zone ${c.zoneLevel || ''} border`} · seeker is ${fmtDist(c.distanceM)} away`,
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
      if (c.matching) return { kind: 'Matching',
        text: `${c.categoryName || 'Area'} · ${c.zoneName || 'Selected area'}`,
        ans: c.answer === 'yes' ? 'Match' : 'No match' };
      return { kind: 'Zone', text: c.zoneName || 'Zone',
               ans: c.answer === 'yes' ? 'Same zone' : 'Different zone' };
    case 'area':
      return { kind: 'Free shape', text: c.name || 'Hand-drawn area',
               ans: c.answer === 'yes' ? 'Inside' : 'Outside' };
    case 'photo':
      return { kind: 'Photo', text: c.subject || 'Photo prompt',
               ans: c.note ? `Received · ${c.note}` : 'Received' };
    default:
      return { kind: '?', text: '', ans: '' };
  }
}

/* ---------- map ---------------------------------------------------- */

const map = L.map('map', {
  center: CONFIG.center, zoom: CONFIG.zoom, zoomControl: false
});
L.control.zoom({ position: 'topright' }).addTo(map);

map.createPane('wmsPane');       map.getPane('wmsPane').style.zIndex = 350;
map.createPane('zonePane');      map.getPane('zonePane').style.zIndex = 410;
map.createPane('routePane');     map.getPane('routePane').style.zIndex = 420;
map.createPane('fogPane');       map.getPane('fogPane').style.zIndex = 430;
map.createPane('previewPane');   map.getPane('previewPane').style.zIndex = 442;
map.createPane('stopPane');      map.getPane('stopPane').style.zIndex = 446;
map.createPane('poiPane');       map.getPane('poiPane').style.zIndex = 447;
map.createPane('evidPane');      map.getPane('evidPane').style.zIndex = 450;
map.createPane('previewHandlePane'); map.getPane('previewHandlePane').style.zIndex = 458;
map.createPane('routeLabelPane');map.getPane('routeLabelPane').style.zIndex = 465;
map.createPane('drawPane');      map.getPane('drawPane').style.zIndex = 470;
map.createPane('locationPane');  map.getPane('locationPane').style.zIndex = 490;

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
const previewShapeLayer = L.layerGroup([], { pane: 'previewPane' }).addTo(map);
const previewHandleLayer = L.layerGroup([], { pane: 'previewHandlePane' }).addTo(map);
const evidLayer = L.layerGroup([], { pane: 'evidPane' }).addTo(map);
const drawLayer = L.layerGroup([], { pane: 'drawPane' }).addTo(map);
const locationLayer = L.layerGroup([], { pane: 'locationPane' }).addTo(map);
let deviceLocation = null;
let locationWatchId = null;
let centerOnNextLocation = false;
let locationErrorShown = false;

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

function solveCurrentArea(extraConstraint) {
  if (!S.playArea) return { possible: null, dead: true };
  let possible = turf.clone(S.playArea);
  let dead = false;
  const constraints = S.constraints.filter((c) => c.active);
  if (extraConstraint) constraints.push(extraConstraint);
  for (const c of constraints) {
    const poly = constraintPolygon(c);
    if (!poly) {
      if (!extraConstraint || c !== extraConstraint) c.error = true;
      continue;
    }
    if (!extraConstraint || c !== extraConstraint) c.error = false;
    possible = gIntersect(possible, poly);
    if (!possible) { dead = true; break; }
  }
  return { possible, dead };
}

function recompute() {
  if (!S.playArea) return;

  const { possible, dead } = solveCurrentArea();

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
    return;
  }
  if (questionPreview.active && questionPreview.type === activeTool) {
    if (activeTool === 'radar') {
      draft.center = coord;
      renderToolForm();
      return;
    }
    if (activeTool === 'thermometer') {
      const radiusM = thermometerPreviewRadius();
      if (!draft.a) {
        draft.a = coord;
        if (radiusM > 0) {
          draft.b = turf.destination(turf.point(coord), radiusM / 1000, 90,
            { units: 'kilometers' }).geometry.coordinates;
        }
      } else if (radiusM > 0) {
        draft.b = constrainToRadius(draft.a, coord, radiusM);
      } else {
        draft.b = coord;
      }
      renderToolForm();
      return;
    }
    if (activeTool === 'measuring') {
      const borderMode = measuringBorderMode();
      if (borderMode) {
        if (!updateMeasuringBorderFromCoord(coord)) {
          toast(draft.borderLoading
            ? `${borderMode.label} is still loading. Try the map again in a moment.`
            : `Could not measure distance to the ${borderMode.label}.`, !draft.borderLoading);
          return;
        }
      } else {
        if (!draft.seeker) draft.seeker = coord;
        else draft.target = coord;
      }
      renderToolForm();
      return;
    }
    if (activeTool === 'nearest') {
      if (matchingAreaMode()) {
        if (setMatchingAreaFromCoord(coord)) renderToolForm();
        return;
      }
      if (matchingPoiMode()) {
        if (setMatchingPoiFromCoord(coord)) renderToolForm();
        return;
      }
      draft.points = draft.points || [];
      const duplicate = draft.points.some((p) =>
        turf.distance(turf.point(p), turf.point(coord), { units: 'meters' }) < 3);
      if (!duplicate) draft.points.push(coord);
      renderToolForm();
      return;
    }
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
let selectedQuestion = null;
// UI-only: when a question is cancelled, keep its family expanded so the
// player can immediately choose another card from the same category. This is
// reset when the Ask tab is entered afresh from another tab.
let questionDeckOpenKey = null;
const draft = {};
const questionPreview = { active: false, type: null, metrics: null };

const QUESTION_DECK = [
  {
    key: 'matching', tool: 'nearest', number: 1, title: 'Matching',
    meta: 'Cost: draw 3, pick 1 · Time limit: 5 min',
    example: 'Is your nearest _____ the same as my nearest _____?',
    groups: [
      { title: 'Transit', cards: [
        ['Commercial airport', 'commercial airport'],
        ['Transit line', 'transit line'],
        ['Station name length', 'station name length'],
        ['Street / path', 'street or path']
      ]},
      { title: 'Administrative zones', cards: [
        ['1st zone', '1st administrative zone'],
        ['2nd zone', '2nd administrative zone'],
        ['3rd zone', '3rd administrative zone'],
        ['4th zone', '4th administrative zone']
      ]},
      { title: 'Natural', cards: [
        ['Mountain', 'mountain'],
        ['Landmass', 'landmass', 'In Aalborg this essentially asks whether the hider is in Nørresundby or south of the Limfjord.'],
        ['Park', 'park']
      ]},
      { title: 'Places of interest', cards: [
        ['Amusement park', 'amusement park'], ['Zoo', 'zoo'],
        ['Aquarium', 'aquarium'], ['Golf course', 'golf course'],
        ['Museum', 'museum'], ['Movie theater', 'movie theater']
      ]},
      { title: 'Public utilities', cards: [
        ['Hospital', 'hospital'], ['Library', 'library'],
        ['Foreign consulate', 'foreign consulate']
      ]}
    ]
  },
  {
    key: 'measuring', tool: 'measuring', number: 2, title: 'Measuring',
    meta: 'Cost: draw 3, pick 1 · Time limit: 5 min',
    example: 'Compared to me, are you closer to or further from _____?',
    groups: [
      { title: 'Transit', cards: [
        ['Commercial airport', 'a commercial airport'],
        ['High-speed train line', 'a high-speed train line'],
        ['Rail station', 'a rail station']
      ]},
      { title: 'Borders', cards: [
        ['International border', 'an international border'],
        ['1st zone border', 'a 1st zone border'],
        ['2nd zone border', 'a 2nd zone border']
      ]},
      { title: 'Natural', cards: [
        ['Sea level', 'sea level'], ['Body of water', 'a body of water'],
        ['Coastline', 'a coastline'], ['Mountain', 'a mountain'], ['Park', 'a park']
      ]},
      { title: 'Places of interest', cards: [
        ['Amusement park', 'an amusement park'], ['Zoo', 'a zoo'],
        ['Aquarium', 'an aquarium'], ['Golf course', 'a golf course'],
        ['Museum', 'a museum'], ['Movie theater', 'a movie theater']
      ]},
      { title: 'Public interest', cards: [
        ['Hospital', 'a hospital'], ['Library', 'a library'],
        ['Foreign consulate', 'a foreign consulate']
      ]}
    ]
  },
  {
    key: 'thermometer', tool: 'thermometer', number: 3, title: 'Thermometer',
    meta: 'Cost: draw 2, pick 1 · Time limit: 5 min',
    example: "I've just travelled at least [distance]. Am I hotter or colder?",
    groups: [
      { title: 'Distance', cards: [
        ['½ mile', '½ mile', '', { distanceM: 0.5 * MI, distanceLabel: '½ mile' }],
        ['3 miles', '3 miles', '', { distanceM: 3 * MI, distanceLabel: '3 miles' }]
      ]}
    ]
  },
  {
    key: 'radar', tool: 'radar', number: 4, title: 'Radar',
    meta: 'Cost: draw 2, pick 1 · Time limit: 5 min',
    example: 'Are you within [distance] of me?',
    groups: [
      { title: 'Distance', cards: [
        ['¼ mile', '¼ mile', '', { radiusM: 0.25 * MI, radiusLabel: '¼ mile' }],
        ['½ mile', '½ mile', '', { radiusM: 0.5 * MI, radiusLabel: '½ mile' }],
        ['1 mile', '1 mile', '', { radiusM: 1 * MI, radiusLabel: '1 mile' }],
        ['3 miles', '3 miles', '', { radiusM: 3 * MI, radiusLabel: '3 miles' }],
        ['5 miles', '5 miles', '', { radiusM: 5 * MI, radiusLabel: '5 miles' }],
        ['10 miles', '10 miles', '', { radiusM: 10 * MI, radiusLabel: '10 miles' }],
        ['25 miles', '25 miles', '', { radiusM: 25 * MI, radiusLabel: '25 miles' }],
        ['50 miles', '50 miles', '', { radiusM: 50 * MI, radiusLabel: '50 miles' }],
        ['100 miles', '100 miles', '', { radiusM: 100 * MI, radiusLabel: '100 miles' }],
        ['Custom', 'a custom distance', 'Enter the distance after selecting this card.', { custom: true }]
      ]}
    ]
  },
  {
    key: 'tentacles', number: 5, title: 'Tentacles', disabled: true,
    meta: 'Cost: draw 4, pick 2 · Time limit: 5 min',
    example: 'Of all the [places] within [distance] of me, which are you closest to? I must also be within [distance].',
    disabledNote: 'Tentacles is available only in medium and large games. It is intentionally disabled for this Aalborg small-game website.'
  },
  {
    key: 'photos', tool: 'photo', number: 6, title: 'Photos',
    meta: 'Cost: draw 1, pick 1 · Time limit: 10 min in small/medium games · 20 min in large games',
    example: 'Send a photo of _____.',
    groups: [
      { title: 'Photo prompt', cards: [
        ['A tree', 'a tree', 'Must include the entire tree.'],
        ['The sky', 'the sky', 'Place the phone on the ground and shoot directly upward.'],
        ['Tallest structure in your sightline', 'the tallest structure in your sightline', 'Use the tallest structure from your current perspective. Include its top and both sides, with the top in the upper third of the frame.'],
        ['You', 'you', 'Use selfie mode. Hold your arm parallel to the ground and fully extended.'],
        ['Widest street', 'the widest street', 'Include both sides of the street.'],
        ['Any building visible from the station', 'any building visible from the station', 'Stand directly outside a transit-station entrance. If there are multiple entrances, choose one. Include the roof and both sides, with the top of the building in the upper third of the frame.']
      ]}
    ]
  }
];

const TOOLS = {
  radar:       { title: 'Radar',       q: '“Are you within ___ of me?”', build: radarForm },
  thermometer: { title: 'Thermometer', q: "“I've just travelled at least ___. Am I hotter or colder?”", build: thermoForm },
  measuring:   { title: 'Measuring',   q: '“Compared to me, are you closer to or further from ___?”', build: measuringForm },
  nearest:     { title: 'Matching',    q: '“Is your nearest ___ the same as mine?”', build: nearestForm },
  photo:       { title: 'Photos',      q: '“Send a photo of ___.”', build: photoForm },
  transit:     { title: 'Transit line', q: '“Will the bus I am on stop at your station?”', build: transitForm },
  zone:        { title: 'Zone match',  q: 'Same administrative zone as the seeker?', build: zoneForm },
  area:        { title: 'Free shape',  q: 'For photo clues, sightlines, hunches — anything you can draw.', build: areaForm }
};

function cardQuestionSentence(type, phrase) {
  if (type === 'matching') return `Is your nearest ${phrase} the same as my nearest ${phrase}?`;
  if (type === 'measuring') return `Compared to me, are you closer to or further from ${phrase}?`;
  if (type === 'thermometer') return `I've just travelled at least ${phrase}. Am I hotter or colder?`;
  if (type === 'radar') return `Are you within ${phrase} of me?`;
  if (type === 'photos') return `Send a photo of ${phrase}.`;
  return '';
}

function normaliseMatchingPoiLabel(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/* Aalborg's official pages often use the traditional Danish `aa` spelling
   where OpenStreetMap uses `å` (Vejgaard vs Vejgård is the concrete case).
   normaliseStopName turns å into `a`; collapse `aa` as well when comparing
   authoritative place names so the two spellings match without weakening the
   actual POI-tag filter. */
function normalisePoiName(value) {
  // Use one canonical spelling for all POI comparisons, not only libraries.
  // Danish place names are commonly written with either `aa` or `å` across
  // municipal/OSM datasets (Vejgaard/Vejgård is the obvious example).
  return normaliseStopName(value).replace(/aa/g, 'a');
}

function normaliseAuthorityPlaceName(value) {
  return normalisePoiName(value);
}

function matchingPoiMode() {
  if (!selectedQuestion || selectedQuestion.typeKey !== 'matching' || draft.poiManual) return null;
  return MATCHING_POI_DEFS[normaliseMatchingPoiLabel(selectedQuestion.label)] || null;
}

const matchingPoiCache = new Map();
const questionPoi = { session: 0, modeKey: null, loading: false, geojson: null, layer: null };

function matchingPoiCacheKey(mode) {
  const bb = activeGameBbox(0);
  return `${mode.key}:${bb.map((v) => Number(v).toFixed(3)).join(',')}`;
}

function releaseQuestionPoiLayer() {
  questionPoi.session += 1;
  if (questionPoi.layer && map.hasLayer(questionPoi.layer)) map.removeLayer(questionPoi.layer);
  questionPoi.modeKey = null;
  questionPoi.loading = false;
  questionPoi.geojson = null;
  questionPoi.layer = null;
  setQuestionMapLoading(null);
}

function activeGameBbox(padKm = 1) {
  if (!S.playArea) return OVERPASS_BBOX.slice();
  try {
    const padded = padKm > 0 ? turf.buffer(S.playArea, padKm, { units: 'kilometers' }) : S.playArea;
    const bb = turf.bbox(padded || S.playArea); // west,south,east,north
    return [bb[1], bb[0], bb[3], bb[2]];
  } catch (_) { return OVERPASS_BBOX.slice(); }
}

function matchingPoiOverpassQuery(mode, bbox = activeGameBbox(1.5), timeoutSec = 30) {
  const [south, west, north, east] = bbox;
  const body = (mode.filters || []).map((filter) =>
    `nwr(${south},${west},${north},${east})${filter};`).join('');
  return `[out:json][timeout:${timeoutSec}];(${body});${mode && mode.key === 'park' ? 'out geom;' : 'out center tags;'}`;
}

function matchingPoiNameAllowed(name, mode) {
  if (!mode) return true;
  const n = normaliseAuthorityPlaceName(name);
  if (!n) return false;

  // Some curated park-adjacent areas need exact matching so a feature such as
  // "Østerådalen Hundeskov" does not become a second, unintended park simply
  // because it contains the word Østerådalen.
  if ((mode.officialExactNames || []).some((official) => n === normaliseAuthorityPlaceName(official))) return true;

  if (!mode.officialNames || !mode.officialNames.length) return !(mode.officialExactNames || []).length;
  return mode.officialNames.some((official) => {
    const o = normaliseAuthorityPlaceName(official);
    return n === o || n.includes(o) || o.includes(n);
  });
}

function overpassElementAreaM2(el) {
  if (!el) return NaN;

  // Ways returned with `out ... geom` contain their actual vertices, which gives
  // the best area estimate. Relations often only expose member geometries, so fall
  // back to their bounds/member bounding box below.
  const geom = Array.isArray(el.geometry) ? el.geometry : null;
  if (geom && geom.length >= 3) {
    const ring = geom.filter((p) => Number.isFinite(p && p.lon) && Number.isFinite(p && p.lat))
      .map((p) => [p.lon, p.lat]);
    if (ring.length >= 3) {
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0].slice());
      try { return turf.area(turf.polygon([ring])); } catch (_) {}
    }
  }

  let b = el.bounds || null;
  if (!b && Array.isArray(el.members)) {
    const pts = [];
    for (const m of el.members) for (const p of (m && m.geometry) || []) {
      if (Number.isFinite(p && p.lon) && Number.isFinite(p && p.lat)) pts.push([p.lon, p.lat]);
    }
    if (pts.length) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      b = { minlon: Math.min(...xs), minlat: Math.min(...ys), maxlon: Math.max(...xs), maxlat: Math.max(...ys) };
    }
  }
  if (b && [b.minlon,b.minlat,b.maxlon,b.maxlat].every(Number.isFinite)) {
    try {
      return turf.area(turf.polygon([[[b.minlon,b.minlat],[b.maxlon,b.minlat],[b.maxlon,b.maxlat],[b.minlon,b.maxlat],[b.minlon,b.minlat]]]));
    } catch (_) {}
  }
  return NaN;
}

function matchingPoiElementAllowed(el, name, mode) {
  if (matchingPoiNameAllowed(name, mode)) return true;
  if (!mode || mode.key !== 'park') return false;

  const tags = (el && el.tags) || {};
  // Automatic expansion is deliberately narrow: only actual OSM parks, named,
  // substantial, and not explicitly private/no-access. Nature reserves and other
  // green tags still require the curated exact-name list above.
  if (tags.leisure !== 'park') return false;
  if (!name || /^unnamed\b/i.test(String(name))) return false;
  const access = String(tags.access || '').toLowerCase();
  if (access === 'private' || access === 'no') return false;
  const areaM2 = overpassElementAreaM2(el);
  return Number.isFinite(areaM2) && areaM2 >= PARK_AUTO_MIN_AREA_M2;
}

function matchingPoiInsidePlayArea(ft) {
  if (!S.playArea || !ft || !ft.geometry || ft.geometry.type !== 'Point') return !!ft;
  try { return pointInsideFeature(ft.geometry.coordinates, S.playArea); }
  catch (_) { return false; }
}

function filterMatchingPoisToPlayArea(gj) {
  const features = ((gj && gj.features) || []).filter(matchingPoiInsidePlayArea);
  return { type: 'FeatureCollection', features };
}

const poiFallbackGeocodeCache = new Map();

async function geocodePoiFallback(fallback) {
  if (!fallback) return null;
  if (Array.isArray(fallback.coordinates) && fallback.coordinates.length >= 2) return fallback;
  if (!fallback.address) return null;

  const cacheKey = String(fallback.address).trim().toLowerCase();
  if (poiFallbackGeocodeCache.has(cacheKey)) {
    const cached = poiFallbackGeocodeCache.get(cacheKey);
    return cached ? { ...fallback, coordinates: cached.slice() } : null;
  }

  try {
    const url = `${CONFIG.dawa}/adresser?q=${encodeURIComponent(fallback.address)}&struktur=mini&per_side=1`;
    const res = await fetchWithDeadline(url, {}, 8000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    const hit = Array.isArray(rows) && rows[0];
    const x = Number(hit && (hit.x ?? (hit.adgangsadresse && hit.adgangsadresse.adgangspunkt && hit.adgangsadresse.adgangspunkt.koordinater && hit.adgangsadresse.adgangspunkt.koordinater[0])));
    const y = Number(hit && (hit.y ?? (hit.adgangsadresse && hit.adgangsadresse.adgangspunkt && hit.adgangsadresse.adgangspunkt.koordinater && hit.adgangsadresse.adgangspunkt.koordinater[1])));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('no coordinates');
    const coord = [x, y];
    poiFallbackGeocodeCache.set(cacheKey, coord);
    return { ...fallback, coordinates: coord };
  } catch (_) {
    poiFallbackGeocodeCache.set(cacheKey, null);
    return null;
  }
}

async function resolveMatchingPoiFallbacks(mode, existingGeoJson) {
  const existing = (existingGeoJson && existingGeoJson.features) || [];
  const fallback = (mode && mode.fallback) || [];
  const resolved = [];

  // Hard-coded coordinates are authoritative and cheap, so always retain them.
  for (const f of fallback) {
    if (Array.isArray(f.coordinates) && f.coordinates.length >= 2) resolved.push(f);
  }

  // Address-only fallbacks are needed only when that official place is absent
  // from OSM. Resolve those in parallel so a complete library outage does not
  // serially trigger five slow address lookups.
  const missing = fallback.filter((f) => {
    if (Array.isArray(f.coordinates) && f.coordinates.length >= 2) return false;
    const wanted = normalisePoiName(f.name);
    return !existing.some((ft) => normalisePoiName((ft.properties || {}).name || (ft.properties || {}).__displayName) === wanted);
  });
  const geocoded = await Promise.all(missing.map(geocodePoiFallback));
  for (const f of geocoded) if (f) resolved.push(f);
  return resolved;
}

function appendFallbackPois(gj, mode, resolvedFallback = null) {
  const out = gj && Array.isArray(gj.features) ? gj.features.slice() : [];
  for (const f of resolvedFallback || (mode && mode.fallback) || []) {
    const coord = f.coordinates;
    if (!coord || coord.length < 2) continue;
    const norm = normalisePoiName(f.name);
    const authorityNorm = normaliseAuthorityPlaceName(f.name);
    let duplicateIndex = -1;
    for (let i = 0; i < out.length; i++) {
      const ft = out[i], p = ft.properties || {};
      let d = Infinity;
      try { d = turf.distance(ft, turf.point(coord), { units: 'meters' }); } catch (_) {}
      const sameAuthorityName = authorityNorm && normaliseAuthorityPlaceName(p.name || p.__displayName || '') === authorityNorm;
      if (d < 30 || (norm && p.__norm === norm) || sameAuthorityName) { duplicateIndex = i; break; }
    }
    const fallbackPoint = () => turf.point(coord.slice(), {
      name: f.name, __displayName: f.name, __poiKind: mode.key, __norm: norm,
      fallback: true, authoritative: !!f.authoritative
    });
    if (duplicateIndex >= 0) {
      // For current municipal branch locations, prefer the authoritative point
      // over a nearby OSM feature that may still describe an old building/location.
      if (f.authoritative) out[duplicateIndex] = fallbackPoint();
      continue;
    }
    out.push(fallbackPoint());
  }
  return { type: 'FeatureCollection', features: out };
}

function mergeMatchingPoiCollections(collections, mode) {
  const elements = [];
  for (const json of collections || []) {
    if (json && Array.isArray(json.elements)) elements.push(...json.elements);
  }
  return parseMatchingPois({ elements }, mode);
}

async function fetchMatchingPoiJson(mode) {
  const bbox = activeGameBbox(1.5);
  // The relevant candidates are inside the game area, so query its much smaller
  // bounding box instead of all of greater Aalborg. Keep the smaller game-area query, but allow the public Overpass servers enough
  // time to answer on mobile networks. If the whole request still fails, split the
  // box into four concurrent requests. Reliability is more important than shaving
  // a few seconds off a successful request.
  try {
    return [await overpassJson(matchingPoiOverpassQuery(mode, bbox, 30), { timeoutMs: 25000 })];
  } catch (wholeErr) {
    const [south, west, north, east] = bbox;
    const midLat = (south + north) / 2;
    const midLng = (west + east) / 2;
    const boxes = [
      [south, west, midLat, midLng], [south, midLng, midLat, east],
      [midLat, west, north, midLng], [midLat, midLng, north, east]
    ];
    const settled = await Promise.allSettled(boxes.map((box, i) =>
      overpassJson(matchingPoiOverpassQuery(mode, box, 25), {
        timeoutMs: 18000, noFallback: true, urls: [OVERPASS[i % Math.min(2, OVERPASS.length)]]
      })
    ));
    const results = settled.filter((x) => x.status === 'fulfilled').map((x) => x.value);
    if (!results.length) throw wholeErr;
    return results;
  }
}

function overpassElementRepresentativePoint(el) {
  if (!el) return null;
  if (Number.isFinite(el.lon) && Number.isFinite(el.lat)) return [el.lon, el.lat];
  if (el.center && Number.isFinite(el.center.lon) && Number.isFinite(el.center.lat)) return [el.center.lon, el.center.lat];
  if (el.bounds && [el.bounds.minlon,el.bounds.minlat,el.bounds.maxlon,el.bounds.maxlat].every(Number.isFinite)) {
    return [(el.bounds.minlon + el.bounds.maxlon) / 2, (el.bounds.minlat + el.bounds.maxlat) / 2];
  }
  const pts = [];
  for (const p of (el.geometry || [])) if (Number.isFinite(p && p.lon) && Number.isFinite(p && p.lat)) pts.push([p.lon,p.lat]);
  for (const m of (el.members || [])) for (const p of (m && m.geometry) || []) {
    if (Number.isFinite(p && p.lon) && Number.isFinite(p && p.lat)) pts.push([p.lon,p.lat]);
  }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function parseMatchingPois(json, mode) {
  const features = [];
  for (const el of (json && json.elements) || []) {
    const tags = el.tags || {};
    const representative = overpassElementRepresentativePoint(el);
    if (!representative) continue;
    const [lon, lat] = representative;
    const name = tags.name || tags['name:da'] || tags.official_name || tags.brand ||
      `Unnamed ${mode.singular}`;
    if (!matchingPoiElementAllowed(el, name, mode)) continue;
    const norm = normalisePoiName(name);
    let duplicate = false;
    for (const ft of features) {
      const p = ft.properties || {};
      let distanceM = Infinity;
      try { distanceM = turf.distance(ft, turf.point([lon, lat]), { units: 'meters' }); } catch (_) {}
      // One OSM place is often mapped both as an area and as a labelled node.
      // Collapse exact co-locations even when their names differ, and collapse
      // same-named representations across the footprint of a larger facility.
      if (distanceM < 12 || (norm && p.__norm === norm && distanceM < 300)) {
        if (distanceM < 12 && p.name && p.name !== name && !String(p.name).includes(name)) {
          p.name = `${p.name} / ${name}`;
          p.__displayName = p.name;
        }
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;
    features.push(turf.point([lon, lat], {
      name, __displayName: name, __poiKind: mode.key, __norm: norm,
      osmType: el.type || '', osmId: el.id || null
    }));
  }
  return { type: 'FeatureCollection', features };
}

function buildMatchingPoiLayer(gj, mode) {
  const group = L.layerGroup([], { pane: 'poiPane' });
  for (const ft of (gj && gj.features) || []) {
    if (!ft.geometry || ft.geometry.type !== 'Point') continue;
    const c = ft.geometry.coordinates;
    L.circleMarker([c[1], c[0]], {
      pane: 'poiPane', radius: 5.2, color: '#cffafe', weight: 1.8,
      fillColor: '#0891b2', fillOpacity: .92, interactive: false
    }).addTo(group);
  }
  return group;
}

function applyQuestionPoiGeoJson(gj, mode, session) {
  const inPlay = filterMatchingPoisToPlayArea(gj || { type: 'FeatureCollection', features: [] });
  if (session !== questionPoi.session || !matchingPoiMode() || matchingPoiMode().key !== mode.key) return inPlay;
  if (questionPoi.layer && map.hasLayer(questionPoi.layer)) map.removeLayer(questionPoi.layer);
  questionPoi.geojson = inPlay;
  questionPoi.layer = buildMatchingPoiLayer(inPlay, mode);
  questionPoi.layer.addTo(map);
  return inPlay;
}

async function ensureMatchingPoiSource(mode, session = questionPoi.session) {
  if (!mode) return null;
  questionPoi.modeKey = mode.key;
  questionPoi.loading = true;
  setQuestionMapLoading(`${mode.plural}`);

  const cacheKey = matchingPoiCacheKey(mode);
  const cached = matchingPoiCache.get(cacheKey) || null;
  if (cached) {
    const shown = applyQuestionPoiGeoJson(cached, mode, session);
    if (session === questionPoi.session) {
      questionPoi.loading = false;
      setQuestionMapLoading(null);
    }
    return shown;
  }

  const directFallbacks = ((mode && mode.fallback) || []).filter((f) =>
    Array.isArray(f.coordinates) && f.coordinates.length >= 2);
  if (directFallbacks.length) {
    const instant = appendFallbackPois({ type: 'FeatureCollection', features: [] }, mode, directFallbacks);
    applyQuestionPoiGeoJson(instant, mode, session);
    if (session === questionPoi.session) renderToolForm();
  }

  // Resolve authoritative address-based locations and query OSM concurrently.
  // The fallback path updates the visible map as soon as it finishes; it never waits
  // behind the optional OSM enrichment request.
  const fallbackPromise = resolveMatchingPoiFallbacks(mode, { type: 'FeatureCollection', features: [] })
    .then((resolved) => {
      if (resolved && resolved.length) {
        const authoritative = appendFallbackPois({ type: 'FeatureCollection', features: [] }, mode, resolved);
        applyQuestionPoiGeoJson(authoritative, mode, session);
        if (session === questionPoi.session) {
          if (draft.matchPoint) setMatchingPoiFromCoord(draft.matchPoint.slice());
          renderQuestionPreview();
          renderToolForm();
        }
      }
      return resolved || [];
    });

  const osmPromise = (async () => {
    try { return mergeMatchingPoiCollections(await fetchMatchingPoiJson(mode), mode); }
    catch (err) {
      if (!(mode.fallback && mode.fallback.length)) throw err;
      return { type: 'FeatureCollection', features: [] };
    }
  })();

  try {
    const [gj, resolvedFallback] = await Promise.all([osmPromise, fallbackPromise]);
    const finalGj = appendFallbackPois(gj, mode, resolvedFallback);
    matchingPoiCache.set(cacheKey, finalGj);
    const shown = applyQuestionPoiGeoJson(finalGj, mode, session);

    if (session === questionPoi.session && draft.matchPoint) {
      setMatchingPoiFromCoord(draft.matchPoint.slice());
      renderQuestionPreview();
      renderToolForm();
    }
    return shown;
  } finally {
    if (session === questionPoi.session) {
      questionPoi.loading = false;
      setQuestionMapLoading(null);
    }
  }
}

function matchingPoiFeatures() {
  return (questionPoi.geojson && questionPoi.geojson.features) || [];
}

function setMatchingPoiFromCoord(coord) {
  const mode = matchingPoiMode();
  if (!mode) return false;
  if (!S.playArea || !pointInsideFeature(coord, S.playArea)) {
    toast('That point is outside the current play area.', true);
    return false;
  }
  const feats = matchingPoiFeatures();
  if (!feats.length) {
    toast(questionPoi.loading ? `${mode.plural} are still loading.` : `No ${mode.plural} were found inside the current game area.`, !questionPoi.loading);
    return false;
  }
  const seeker = turf.point(coord);
  let best = Infinity, bestIndex = -1;
  for (let i = 0; i < feats.length; i++) {
    try {
      const d = turf.distance(seeker, feats[i], { units: 'meters' });
      if (d < best) { best = d; bestIndex = i; }
    } catch (_) { /* continue */ }
  }
  if (bestIndex < 0) return false;
  draft.matchPoint = coord;
  draft.points = feats.map((ft) => ft.geometry.coordinates.slice());
  draft.index = bestIndex;
  draft.matchName = (feats[bestIndex].properties || {}).name || mode.singular;
  draft.matchDistanceM = best;
  draft.categoryName = selectedQuestion ? selectedQuestion.phrase : mode.singular;
  return true;
}

function matchingPoiCell() {
  if (!draft.points || draft.index == null || !S.playArea) return null;
  const cell = voronoiCell(draft.points, draft.index);
  return cell ? gIntersect(S.playArea, cell) : null;
}

/* Some Matching cards describe areas rather than a set of nearest points.
   Treat those as spatial questions directly so a prospective Match/No match
   can shade the map just like Radar. */
function matchingAreaMode() {
  if (!selectedQuestion || selectedQuestion.typeKey !== 'matching') return null;
  const m = String(selectedQuestion.label || '').match(/^([1-4])(?:st|nd|rd|th) zone$/i);
  if (m) {
    const level = Number(m[1]);
    return { kind: 'zone', level, sourceKey: `zone${level}`, label: `${level}${level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'} zone` };
  }
  if (normaliseZoneText(selectedQuestion.label) === 'landmass') {
    return { kind: 'landmass', sourceKey: 'zone2', label: 'Landmass' };
  }
  return null;
}

/* Measuring-to-border cards are area questions, not point-target questions.
   If the seeker's nearest Zone-N border is d metres away, "closer" keeps the
   d-metre band around every Zone-N border and "further" keeps its complement. */
function measuringBorderMode() {
  if (!selectedQuestion || selectedQuestion.typeKey !== 'measuring') return null;
  const m = String(selectedQuestion.label || '').match(/^([1-4])(?:st|nd|rd|th) zone border$/i);
  if (!m) return null;
  const level = Number(m[1]);
  return { level, sourceKey: `zone${level}`, label: `${level}${level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'} zone border` };
}

function geometryLineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

function zoneBorderLines(rec) {
  if (!rec) return [];
  if (rec.__zoneBorderLines) return rec.__zoneBorderLines;
  const source = rec.baseGeojson || rec.geojson;
  const lines = [];
  for (const ft of (source && source.features) || []) {
    if (!ft || !ft.geometry || !/Polygon/.test(ft.geometry.type)) continue;
    try {
      const boundary = turf.polygonToLine(ft);
      const feats = boundary.type === 'FeatureCollection' ? boundary.features : [boundary];
      for (const lineFt of feats) {
        for (const coords of geometryLineParts(lineFt.geometry)) {
          if (coords && coords.length >= 2) lines.push(turf.lineString(coords));
        }
      }
    } catch (_) { /* skip malformed pieces */ }
  }
  rec.__zoneBorderLines = lines;
  return lines;
}

function nearestZoneBorderDistanceM(coord, rec) {
  if (!coord || !rec) return null;
  const point = turf.point(coord);
  let best = Infinity;
  for (const line of zoneBorderLines(rec)) {
    try {
      const d = turf.pointToLineDistance(point, line, { units: 'meters' });
      if (Number.isFinite(d) && d < best) best = d;
    } catch (_) { /* keep looking */ }
  }
  return Number.isFinite(best) ? best : null;
}

function zoneBorderBand(rec, distanceM) {
  if (!rec || !S.playArea || !(distanceM >= 0)) return null;
  const lines = zoneBorderLines(rec);
  if (!lines.length) return null;
  const radiusM = Math.max(.5, distanceM);
  const buffered = [];
  for (const line of lines) {
    try {
      const b = turf.buffer(line, radiusM / 1000, { units: 'kilometers', steps: 12 });
      if (b) buffered.push(b);
    } catch (_) { /* ignore one bad border */ }
  }
  const merged = unionAll(buffered);
  return merged ? gIntersect(S.playArea, merged) : null;
}

function updateMeasuringBorderFromCoord(coord) {
  const mode = measuringBorderMode();
  if (!mode) return false;
  const rec = layerByKey('src:' + mode.sourceKey);
  if (!rec) return false;
  const distanceM = nearestZoneBorderDistanceM(coord, rec);
  if (distanceM == null) return false;
  const band = zoneBorderBand(rec, distanceM);
  if (!band) return false;
  draft.seeker = coord;
  draft.borderDistanceM = distanceM;
  draft.borderBandGeometry = band.geometry;
  return true;
}

function landmassRegions() {
  if (!S.playArea) return null;
  const feats = matchingSourceFeatures({ sourceKey: 'zone2' });
  const northParts = feats.filter((ft) => {
    const def = playZoneDef(ft);
    return (def && def.area === 2) || normaliseZoneText(featureName(ft, null)).includes('norresundby');
  });
  const north = unionAll(northParts);
  if (!north) return null;
  const south = gDifference(S.playArea, north);
  return south ? { north, south } : null;
}

function pointInsideFeature(coord, ft) {
  if (!coord || !ft || !ft.geometry || !/Polygon/.test(ft.geometry.type)) return false;
  try { return turf.booleanPointInPolygon(turf.point(coord), ft); } catch (_) { return false; }
}

function matchingSourceFeatures(mode) {
  if (!mode) return [];
  const rec = layerByKey('src:' + mode.sourceKey);
  if (rec && rec.geojson) return rec.geojson.features || [];
  if (mode.sourceKey === 'zone2') {
    const gj = S.zone2Official || buildAreaZones();
    return gj && gj.features ? gj.features : [];
  }
  return [];
}

function landmassGeometryAt(coord) {
  if (!S.playArea || !pointInsideFeature(coord, S.playArea)) return null;
  const regions = landmassRegions();
  if (!regions) return null;
  if (pointInsideFeature(coord, regions.north)) {
    return { geometry: regions.north.geometry, name: 'Nørresundby / north of the Limfjord' };
  }
  return { geometry: regions.south.geometry, name: 'Aalborg / south of the Limfjord' };
}

function matchingAreaAt(coord) {
  const mode = matchingAreaMode();
  if (!mode || !S.playArea || !pointInsideFeature(coord, S.playArea)) return null;
  if (mode.kind === 'landmass') return landmassGeometryAt(coord);
  const rec = layerByKey('src:' + mode.sourceKey);
  if (!rec) return null;
  const ft = (rec.geojson.features || []).find((f) => pointInsideFeature(coord, f));
  return ft ? { geometry: ft.geometry, name: featureName(ft, rec) } : null;
}

function setMatchingAreaFromCoord(coord) {
  const mode = matchingAreaMode();
  if (!mode) return false;
  const hit = matchingAreaAt(coord);
  if (!hit) {
    if (mode.kind === 'zone' && !layerByKey('src:' + mode.sourceKey)) {
      toast(draft.matchLoading
        ? `${mode.label} is still loading. Try the map again in a moment.`
        : `${mode.label} boundaries could not be loaded. Retry that layer from Layers.`, !draft.matchLoading);
    } else {
      toast('That point is outside the usable area for this question.', true);
    }
    return false;
  }
  draft.matchPoint = coord;
  draft.matchGeometry = hit.geometry;
  draft.matchName = hit.name;
  return true;
}

/* Zone layers opened by a question are temporary UI context, not a player
   layer choice. Track only layers that the question itself made visible. If a
   layer was already on, leave it alone when the question closes. */
const questionAutoZoneSources = new Set();
let questionZoneSession = 0;

function releaseQuestionZoneLayers() {
  questionZoneSession += 1; // invalidates any slow in-flight question load
  for (const sourceKey of Array.from(questionAutoZoneSources)) {
    const rec = layerByKey('src:' + sourceKey);
    if (rec && rec.visible) setLayerVisible(rec, false);
  }
  questionAutoZoneSources.clear();
}

function claimZoneLayerManually(sourceKey) {
  // A tap in Layers means the player now owns this visibility choice. Do not
  // automatically hide it when the question that originally opened it ends.
  questionAutoZoneSources.delete(sourceKey);
}

async function ensureZoneSourceVisible(sourceKey, session = questionZoneSession) {
  let rec = layerByKey('src:' + sourceKey);
  if (rec) {
    if (!rec.visible) {
      if (session !== questionZoneSession) return rec;
      questionAutoZoneSources.add(sourceKey);
      setLayerVisible(rec, true);
    }
    return rec;
  }

  // Zone 2 may already be fetching in the background for the play-area union,
  // or the player may have started the same layer from Layers. Wait for that
  // request instead of accidentally treating "already loading" as failure.
  let startedByQuestion = false;
  for (let i = 0; i < 300 && zoneLoads.has(sourceKey) && !rec; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    rec = layerByKey('src:' + sourceKey);
  }
  if (!rec && session === questionZoneSession) {
    startedByQuestion = true;
    await toggleSource(sourceKey, null);
    rec = layerByKey('src:' + sourceKey);
  }

  if (!rec) return null;

  // If the player closed/switched the question while this request was in
  // flight, do not let the completed request leave a surprise layer behind.
  if (session !== questionZoneSession) {
    if (startedByQuestion && rec.visible && !questionAutoZoneSources.has(sourceKey)) {
      setLayerVisible(rec, false);
    }
    return rec;
  }

  if (startedByQuestion) questionAutoZoneSources.add(sourceKey);
  if (!rec.visible) {
    questionAutoZoneSources.add(sourceKey);
    setLayerVisible(rec, true);
  }
  return rec;
}

async function ensureMatchingAreaSource(mode = matchingAreaMode(), session = questionZoneSession) {
  if (!mode || mode.kind !== 'zone') return null;
  return ensureZoneSourceVisible(mode.sourceKey, session);
}

function parsePositiveDecimal(value) {
  const raw = String(value == null ? '' : value).trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d*(?:\.\d*)?$/.test(raw) || raw === '' || raw === '.') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function renderQuestionDeck() {
  const deck = $('#questionDeck');
  if (!deck) return;
  deck.hidden = false;
  deck.innerHTML = '';

  QUESTION_DECK.forEach((type, typeIndex) => {
    const isActiveType = !!(selectedQuestion && selectedQuestion.typeKey === type.key);
    const details = document.createElement('details');
    details.className = 'question-type' + (type.disabled ? ' is-disabled' : '') +
      (isActiveType ? ' has-active-question' : '');
    details.dataset.questionPanel = type.key;
    if (type.disabled) details.setAttribute('aria-disabled', 'true');
    // No question family is privileged on entry. A cancelled question may keep
    // its own family open while the player remains in Ask, so another card from
    // that family is one tap away.
    details.open = isActiveType || questionDeckOpenKey === type.key;
    details.addEventListener('toggle', () => {
      if (details.open) questionDeckOpenKey = type.key;
      else if (!selectedQuestion && questionDeckOpenKey === type.key) questionDeckOpenKey = null;
    });
    const summary = document.createElement('summary');
    summary.className = 'question-type-summary';
    summary.innerHTML = `<span class="question-number">${type.number}</span>
      <span class="question-heading"><strong>${escapeHtml(type.title)}</strong>
      <small>${escapeHtml(type.meta)}</small></span>
      ${type.disabled ? '<span class="question-status">Small game: disabled</span>' : '<span class="question-chevron" aria-hidden="true">⌄</span>'}`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'question-type-body';
    body.innerHTML = `<p class="question-example">${escapeHtml(type.example)}</p>`;

    const inlineSlot = document.createElement('div');
    inlineSlot.className = 'question-inline-slot';
    inlineSlot.dataset.questionSlot = type.key;
    body.appendChild(inlineSlot);

    if (type.disabled) {
      const note = document.createElement('p');
      note.className = 'question-disabled-note';
      note.textContent = type.disabledNote || 'This question type is disabled in the small game.';
      body.appendChild(note);
    }

    (type.groups || []).forEach((group) => {
      const section = document.createElement('section');
      section.className = 'question-card-group';
      section.innerHTML = `<h3>${escapeHtml(group.title)}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'question-card-grid';
      group.cards.forEach(([label, phrase, note, data]) => {
        const btn = document.createElement('button');
        const selected = isActiveType && selectedQuestion && selectedQuestion.label === label;
        btn.className = 'question-card' + (selected ? ' is-selected' : '');
        btn.type = 'button';
        btn.dataset.questionType = type.key;
        btn.dataset.card = label;
        btn.innerHTML = `<span>${escapeHtml(label)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ''}`;
        btn.addEventListener('click', () => chooseQuestion(type, { label, phrase, note: note || '', data: data || {} }));
        grid.appendChild(btn);
      });
      section.appendChild(grid);
      body.appendChild(section);
    });
    details.appendChild(body);
    deck.appendChild(details);
  });
}

function chooseQuestion(type, card) {
  releaseQuestionZoneLayers();
  releaseQuestionPoiLayer();
  const zoneSession = questionZoneSession;
  deactivateQuestionPreview();
  activeTool = type.tool;
  questionDeckOpenKey = type.key;
  selectedQuestion = { typeKey: type.key, title: type.title, meta: type.meta, ...card };
  for (const k of Object.keys(draft)) delete draft[k];
  if (activeTool === 'nearest') draft.categoryName = card.phrase;
  if (activeTool === 'measuring') draft.targetName = card.phrase;
  if (activeTool === 'thermometer') {
    draft.requiredDistanceM = card.data.distanceM;
    draft.requiredDistanceLabel = card.data.distanceLabel || card.label;
  }
  if (activeTool === 'radar') {
    draft.customRadius = !!card.data.custom;
    if (card.data.radiusM) {
      draft.radiusM = card.data.radiusM;
      draft.label = card.data.radiusLabel || card.label;
    }
  }
  if (activeTool === 'photo') draft.photoSubject = card.phrase;
  endPick(); stopDrawing();
  if (previewCapableTool(activeTool)) {
    questionPreview.active = true;
    questionPreview.type = activeTool;
  }
  const areaMode = matchingAreaMode();
  const poiMode = matchingPoiMode();
  if (poiMode) {
    draft.poiLoading = true;
    const poiSession = questionPoi.session;
    ensureMatchingPoiSource(poiMode, poiSession).then((gj) => {
      if (matchingPoiMode() && matchingPoiMode().key === poiMode.key) {
        draft.poiLoading = false;
        draft.poiCount = (gj && gj.features ? gj.features.length : 0);
        renderToolForm();
      }
    }).catch((err) => {
      if (matchingPoiMode() && matchingPoiMode().key === poiMode.key) {
        draft.poiLoading = false;
        draft.poiError = err && err.message ? err.message : 'Could not load places';
        renderToolForm();
      }
    });
  }
  if (areaMode && areaMode.kind === 'zone') {
    draft.matchLoading = true;
    ensureMatchingAreaSource(areaMode, zoneSession).then(() => {
      if (matchingAreaMode() && matchingAreaMode().sourceKey === areaMode.sourceKey) {
        draft.matchLoading = false;
        renderToolForm();
      }
    }).catch(() => {
      if (matchingAreaMode() && matchingAreaMode().sourceKey === areaMode.sourceKey) {
        draft.matchLoading = false;
        renderToolForm();
      }
    });
  }
  const borderMode = measuringBorderMode();
  if (borderMode) {
    draft.borderLoading = true;
    ensureZoneSourceVisible(borderMode.sourceKey, zoneSession).then(() => {
      const current = measuringBorderMode();
      if (current && current.sourceKey === borderMode.sourceKey) {
        draft.borderLoading = false;
        renderToolForm();
      }
    }).catch(() => {
      const current = measuringBorderMode();
      if (current && current.sourceKey === borderMode.sourceKey) {
        draft.borderLoading = false;
        renderToolForm();
      }
    });
  }
  renderToolForm();
  const directMapEntry = (['radar', 'thermometer', 'measuring'].includes(activeTool) &&
    !(activeTool === 'radar' && draft.customRadius && !draft.radiusM)) ||
    (activeTool === 'nearest' && (!!areaMode || !!poiMode));
  if (directMapEntry && window.innerWidth <= 820) closeSheet();
  const pane = document.querySelector('[data-pane="ask"]');
  const panel = document.querySelector(`[data-question-panel="${type.key}"]`);
  if (pane && panel) pane.scrollTop = Math.max(0, panel.offsetTop - 8);
}

function closeQuestionForm() {
  const stayOpen = selectedQuestion ? selectedQuestion.typeKey : questionDeckOpenKey;
  releaseQuestionZoneLayers();
  releaseQuestionPoiLayer();
  deactivateQuestionPreview();
  activeTool = null;
  selectedQuestion = null;
  questionDeckOpenKey = stayOpen || null;
  for (const k of Object.keys(draft)) delete draft[k];
  endPick(); stopDrawing();
  renderToolForm();
}

/* Kept for internal tools and geometry tests; the small-game UI enters through chooseQuestion. */
function selectTool(key) {
  if (activeTool === key) { closeQuestionForm(); return; }
  releaseQuestionZoneLayers();
  releaseQuestionPoiLayer();
  deactivateQuestionPreview();
  activeTool = key;
  selectedQuestion = null;
  questionDeckOpenKey = null;
  for (const k of Object.keys(draft)) delete draft[k];
  endPick(); stopDrawing();
  if (previewCapableTool(key)) {
    questionPreview.active = true;
    questionPreview.type = key;
  }
  renderToolForm();
}

function renderToolForm() {
  const box = $('#toolForm');
  const empty = $('#askEmpty');
  const askPane = document.querySelector('[data-pane="ask"]');
  // The workspace is physically moved into the active accordion. Rescue it
  // before rebuilding the deck, otherwise deck.innerHTML would destroy it.
  if (box && box.closest('#questionDeck') && askPane) askPane.insertBefore(box, empty || null);
  renderQuestionDeck();
  if (!activeTool) {
    box.hidden = true; box.innerHTML = '';
    if (askPane && box.parentElement !== askPane) askPane.insertBefore(box, empty || null);
    if (empty) empty.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (selectedQuestion) {
    const inlineSlot = document.querySelector(`[data-question-slot="${selectedQuestion.typeKey}"]`);
    if (inlineSlot) inlineSlot.appendChild(box);
  }
  box.hidden = false;

  const title = selectedQuestion ? `${selectedQuestion.title} · ${selectedQuestion.label}` : TOOLS[activeTool].title;
  const question = selectedQuestion
    ? cardQuestionSentence(selectedQuestion.typeKey, selectedQuestion.phrase)
    : TOOLS[activeTool].q;
  box.innerHTML = `<button type="button" class="question-back ghost-btn">Close question</button>
    <div class="selected-question-head">
      <p class="form-title">${escapeHtml(title)}</p>
      ${selectedQuestion ? `<p class="selected-question-meta">${escapeHtml(selectedQuestion.meta)}</p>` : ''}
      <p class="form-q">${escapeHtml(question)}</p>
      ${selectedQuestion && selectedQuestion.note ? `<p class="selected-question-note">${escapeHtml(selectedQuestion.note)}</p>` : ''}
    </div>`;
  box.querySelector('.question-back').addEventListener('click', closeQuestionForm);
  TOOLS[activeTool].build(box);
  syncQuestionPreview();
}

renderQuestionDeck();

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

function mapPointStatus(box, label, coord, opts = {}) {
  const row = document.createElement('div');
  row.className = 'map-point-status';
  const text = document.createElement('div');
  text.innerHTML = `<strong>${escapeHtml(label)}</strong><small>${coord ? fmtLL(coord) : escapeHtml(opts.empty || 'Tap the map')}</small>`;
  row.appendChild(text);
  if (opts.gps) {
    const gps = document.createElement('button');
    gps.type = 'button'; gps.className = 'ghost-btn'; gps.textContent = 'Use GPS';
    gps.addEventListener('click', () => locate((c) => { opts.set(c); renderToolForm(); }));
    row.appendChild(gps);
  }
  box.appendChild(row);
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

function actions(box, ready, onAdd, addLabel = 'Log answer') {
  if (previewCapableTool()) addPreviewControls(box);
  const wrap = document.createElement('div');
  wrap.className = 'form-actions';
  const add = document.createElement('button');
  add.className = 'solid-btn';
  add.textContent = addLabel;
  add.disabled = !ready;
  add.addEventListener('click', onAdd);
  const cancel = document.createElement('button');
  cancel.className = 'ghost-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeQuestionForm);
  wrap.append(add, cancel);
  box.appendChild(wrap);
}

function previewCapableTool(tool = activeTool) {
  return ['radar', 'thermometer', 'measuring', 'nearest', 'transit', 'zone', 'area'].includes(tool);
}

function deactivateQuestionPreview() {
  questionPreview.active = false;
  questionPreview.type = null;
  questionPreview.metrics = null;
  previewShapeLayer.clearLayers();
  previewHandleLayer.clearLayers();
}

function previewConstraintFromDraft() {
  switch (activeTool) {
    case 'radar':
      return draft.center && draft.radiusM && draft.answer
        ? { type: 'radar', center: draft.center, radiusM: draft.radiusM, answer: draft.answer }
        : null;
    case 'thermometer':
      return draft.a && draft.b && draft.answer
        ? { type: 'thermometer', a: draft.a, b: draft.b, answer: draft.answer }
        : null;
    case 'measuring': {
      const borderMode = measuringBorderMode();
      if (borderMode) {
        return draft.borderBandGeometry && draft.answer
          ? { type: 'borderDistance', geometry: draft.borderBandGeometry, answer: draft.answer,
              distanceM: draft.borderDistanceM, zoneLevel: borderMode.level, borderName: borderMode.label }
          : null;
      }
      return draft.seeker && draft.target && draft.answer
        ? { type: 'measuring', seeker: draft.seeker, target: draft.target, answer: draft.answer }
        : null;
    }
    case 'nearest': {
      const areaMode = matchingAreaMode();
      if (areaMode) {
        return draft.matchGeometry && draft.answer
          ? { type: 'zone', geometry: draft.matchGeometry, answer: draft.answer,
              matching: true, categoryName: selectedQuestion ? selectedQuestion.label : areaMode.label,
              zoneName: draft.matchName || areaMode.label }
          : null;
      }
      return draft.points && draft.points.length && draft.index != null && draft.answer &&
             (!draft.radiusM || draft.seeker)
        ? { type: 'nearest', points: draft.points.slice(), index: draft.index,
            radiusM: draft.radiusM || null, seeker: draft.seeker || null, answer: draft.answer }
        : null;
    }
    case 'transit':
      return draft.lineGeom && draft.bufferM && draft.answer
        ? { type: 'transit', geometry: draft.lineGeom, bufferM: draft.bufferM, answer: draft.answer }
        : null;
    case 'zone':
      return draft.zoneGeometry && draft.answer
        ? { type: 'zone', geometry: draft.zoneGeometry, answer: draft.answer }
        : null;
    case 'area':
      return draft.geometry && draft.answer
        ? { type: 'area', geometry: draft.geometry, answer: draft.answer }
        : null;
    default:
      return null;
  }
}

function constrainToRadius(origin, target, radiusM) {
  if (!origin || !target || !(radiusM > 0)) return target;
  let bearing = 90;
  try { bearing = turf.bearing(turf.point(origin), turf.point(target)); } catch (_) { /* east */ }
  return turf.destination(turf.point(origin), radiusM / 1000, bearing,
    { units: 'kilometers' }).geometry.coordinates;
}

function thermometerPreviewRadius() {
  if (draft.requiredDistanceM > 0) return draft.requiredDistanceM;
  if (draft.a && draft.b) {
    return turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000;
  }
  return 0;
}

function previewInstruction() {
  if (!questionPreview.active) return '';
  if (activeTool === 'radar') {
    if (!draft.center) return 'Tap the map to place the radar. Tap again, or drag its handle, to move it.';
    if (!draft.answer) return 'The radius is live. Tap elsewhere or drag the centre to reposition it; choose Yes or No to preview the resulting cut.';
  }
  if (activeTool === 'thermometer') {
    if (!draft.a) return 'Tap the map to set the starting point.';
    if (!draft.b) return 'Drag the circular handle to choose a possible end point.';
    if (!draft.answer) return 'Drag either thermometer handle to reposition it. The cyan line is the split; choose Hotter or Colder to preview which side remains.';
    return '';
  }
  if (activeTool === 'nearest' && matchingPoiMode()) {
    const mode = matchingPoiMode();
    if (questionPoi.loading || draft.poiLoading) return `Loading ${mode.plural} from OpenStreetMap…`;
    if (draft.poiError) return `Could not load ${mode.plural}: ${draft.poiError}`;
    if (!matchingPoiFeatures().length) return `No ${mode.plural} were found in the Aalborg search area.`;
    if (!draft.matchPoint || draft.index == null) return `${matchingPoiFeatures().length} ${mode.plural} loaded. Tap your position on the map.`;
    if (!draft.answer) return `Your nearest is ${draft.matchName}. Tap elsewhere to reposition, or choose Match / No match to preview the cut.`;
  }
  if (activeTool === 'nearest' && matchingAreaMode()) {
    const mode = matchingAreaMode();
    if (!draft.matchGeometry) {
      if (mode.kind === 'landmass') return 'The map shows the Aalborg landmass split. Tap your position to choose your side.';
      return draft.matchLoading ? `Loading ${mode.label} boundaries…` : 'Tap your position on the map to identify your area.';
    }
    if (!draft.answer) return `You selected ${draft.matchName}. Choose Match or No match to preview the cut.`;
  }
  if (activeTool === 'measuring' && measuringBorderMode()) {
    const mode = measuringBorderMode();
    if (draft.borderLoading) return `Loading ${mode.label} boundaries…`;
    if (!draft.seeker || !draft.borderBandGeometry) return `Tap your position. The map will show the distance band around every ${mode.label}.`;
    if (!draft.answer) return `Drag the point or tap elsewhere to reposition it. Cyan shows everywhere closer to a ${mode.label} than you are (${fmtDist(draft.borderDistanceM)}). Choose Closer or Further to preview the cut.`;
  }
  if (!previewConstraintFromDraft()) return 'Complete the locations and choose an answer to preview the cut.';
  return '';
}

function updatePreviewImpactText() {
  const el = $('#previewImpactText');
  if (!el) return;
  const instruction = previewInstruction();
  if (instruction) { el.textContent = instruction; return; }
  const m = questionPreview.metrics;
  if (!m) { el.textContent = 'Preview is active. Nothing has been logged.'; return; }
  if (m.borderDual) {
    const closerPct = m.beforeM2 ? (m.closerM2 / m.beforeM2) * 100 : 0;
    const furtherPct = Math.max(0, 100 - closerPct);
    el.textContent = `If the answer is Closer, about ${trimNum(closerPct.toFixed(closerPct < 10 ? 1 : 0))}% would remain; ` +
      `Further would leave about ${trimNum(furtherPct.toFixed(furtherPct < 10 ? 1 : 0))}%. Nothing is logged yet.`;
    return;
  }
  const [amount, unit] = fmtArea(m.afterM2);
  const pct = m.beforeM2 ? (m.afterM2 / m.beforeM2) * 100 : 0;
  el.textContent = `${amount} ${unit} would remain — ${trimNum(pct.toFixed(pct < 10 ? 1 : 0))}% of the area currently in play.`;
}

function renderPreviewShapes() {
  previewShapeLayer.clearLayers();
  questionPreview.metrics = null;
  if (!questionPreview.active || !S.playArea || questionPreview.type !== activeTool) {
    updatePreviewImpactText();
    return;
  }
  const P = '#67e8f9';
  const R = '#a78bfa';
  const markerStyle = { pane: 'previewPane', radius: 5, color: P, weight: 2,
    fillColor: '#0d141d', fillOpacity: 1, interactive: false };

  if (activeTool === 'radar' && draft.center && draft.radiusM) {
    L.circle([draft.center[1], draft.center[0]], { pane: 'previewPane', radius: draft.radiusM,
      color: P, weight: 2.2, opacity: .95, dashArray: '7 5', fillColor: P,
      fillOpacity: .055, interactive: false }).addTo(previewShapeLayer);
    L.circleMarker([draft.center[1], draft.center[0]], markerStyle).addTo(previewShapeLayer);
  }

  if (activeTool === 'nearest') {
    const poiMode = matchingPoiMode();
    if (poiMode && draft.matchPoint && draft.index != null && draft.points && draft.points[draft.index]) {
      const nearestPoint = draft.points[draft.index];
      L.circleMarker([draft.matchPoint[1], draft.matchPoint[0]], markerStyle).addTo(previewShapeLayer);
      L.circleMarker([nearestPoint[1], nearestPoint[0]], {
        pane: 'previewPane', radius: 7, color: '#cffafe', weight: 2.4,
        fillColor: '#0891b2', fillOpacity: 1, interactive: false
      }).addTo(previewShapeLayer);
      L.polyline([[draft.matchPoint[1], draft.matchPoint[0]], [nearestPoint[1], nearestPoint[0]]], {
        pane: 'previewPane', color: P, weight: 1.8, opacity: .8, dashArray: '4 5', interactive: false
      }).addTo(previewShapeLayer);
      if (!draft.answer) {
        const cell = matchingPoiCell();
        if (cell) L.geoJSON(cell, { pane: 'previewPane', interactive: false,
          style: { color: P, weight: 2.5, opacity: .95, dashArray: '7 5',
                   fillColor: P, fillOpacity: .08 } }).addTo(previewShapeLayer);
      }
    }
    const mode = matchingAreaMode();
    if (mode && mode.kind === 'landmass') {
      const regions = landmassRegions();
      if (regions) {
        L.geoJSON(regions.north, { pane: 'previewPane', interactive: false,
          style: { color: '#67e8f9', weight: 2.4, opacity: .95, dashArray: '7 5',
                   fillColor: '#67e8f9', fillOpacity: .075 } }).addTo(previewShapeLayer);
        L.geoJSON(regions.south, { pane: 'previewPane', interactive: false,
          style: { color: '#fbbf24', weight: 2.0, opacity: .85, dashArray: '7 5',
                   fillColor: '#fbbf24', fillOpacity: .045 } }).addTo(previewShapeLayer);
      }
    }
  }

  if (activeTool === 'measuring' && measuringBorderMode() && draft.seeker) {
    L.circleMarker([draft.seeker[1], draft.seeker[0]], markerStyle).addTo(previewShapeLayer);
    if (draft.borderBandGeometry && !draft.answer) {
      const bandFt = turf.feature(draft.borderBandGeometry);
      L.geoJSON(bandFt, { pane: 'previewPane', interactive: false,
        style: { color: P, weight: 2.2, opacity: .95, dashArray: '6 4',
                 fillColor: P, fillOpacity: .105 } }).addTo(previewShapeLayer);
      const before = solveCurrentArea().possible;
      const closer = before ? gIntersect(before, bandFt) : null;
      if (before) questionPreview.metrics = {
        borderDual: true, beforeM2: turf.area(before), closerM2: closer ? turf.area(closer) : 0
      };
    }
    if (!draft.answer) {
      updatePreviewImpactText();
      return;
    }
  }

  if (activeTool === 'thermometer' && draft.a) {
    const radiusM = thermometerPreviewRadius();
    if (radiusM > 0) {
      L.circle([draft.a[1], draft.a[0]], { pane: 'previewPane', radius: radiusM,
        color: P, weight: 1.8, opacity: .82, dashArray: '5 5', fill: false,
        interactive: false }).addTo(previewShapeLayer);
    }
    L.circleMarker([draft.a[1], draft.a[0]], markerStyle).addTo(previewShapeLayer);
    if (draft.b) {
      L.polyline([[draft.a[1], draft.a[0]], [draft.b[1], draft.b[0]]], {
        pane: 'previewPane', color: P, weight: 2.2, opacity: .95, interactive: false
      }).addTo(previewShapeLayer);
      const split = thermometerBisectorLine(draft.a, draft.b);
      if (split) {
        L.geoJSON(split, { pane: 'previewPane', interactive: false,
          style: { color: P, weight: 3, opacity: 1, dashArray: '10 7', fill: false }
        }).addTo(previewShapeLayer);
      }
    }
    if (!draft.answer) {
      updatePreviewImpactText();
      return;
    }
  }

  const c = previewConstraintFromDraft();
  if (!c) { updatePreviewImpactText(); return; }
  const before = solveCurrentArea().possible;
  const after = solveCurrentArea(c).possible;
  if (!before) { updatePreviewImpactText(); return; }
  const removed = after ? gDifference(before, after) : turf.clone(before);
  if (removed) {
    L.geoJSON(removed, { pane: 'previewPane', interactive: false,
      style: { color: R, weight: 1, opacity: .7, dashArray: '3 4',
               fillColor: R, fillOpacity: .28 } }).addTo(previewShapeLayer);
  }
  if (after) {
    L.geoJSON(after, { pane: 'previewPane', interactive: false,
      style: { color: P, weight: 2.4, opacity: .95, fill: false } }).addTo(previewShapeLayer);
  }
  questionPreview.metrics = { beforeM2: turf.area(before), afterM2: after ? turf.area(after) : 0 };
  updatePreviewImpactText();
}

function previewDragHandle(coord, title, handlers = {}) {
  if (!coord) return null;
  const marker = L.marker([coord[1], coord[0]], {
    pane: 'previewHandlePane', draggable: true, keyboard: true, title,
    icon: L.divIcon({ className: 'question-preview-handle-icon',
      html: '<span class="question-preview-handle" aria-hidden="true"></span>',
      iconSize: [28, 28], iconAnchor: [14, 14] })
  }).addTo(previewHandleLayer);
  for (const [event, handler] of Object.entries(handlers)) marker.on(event, handler);
  return marker;
}

function renderPreviewHandles() {
  previewHandleLayer.clearLayers();
  if (!questionPreview.active || questionPreview.type !== activeTool) return;

  if (activeTool === 'radar' && draft.center && draft.radiusM) {
    previewDragHandle(draft.center, 'Drag to move the radar', {
      drag: (e) => {
        const ll = e.target.getLatLng();
        draft.center = [ll.lng, ll.lat];
        renderPreviewShapes();
      },
      dragend: () => renderToolForm()
    });
    return;
  }

  if (activeTool === 'measuring' && measuringBorderMode() && draft.seeker) {
    previewDragHandle(draft.seeker, 'Drag to move the border-distance point', {
      dragend: (e) => {
        const ll = e.target.getLatLng();
        if (!updateMeasuringBorderFromCoord([ll.lng, ll.lat])) {
          toast('Could not measure the border distance at that position.', true);
        }
        renderToolForm();
      }
    });
    return;
  }

  if (activeTool === 'nearest' && matchingPoiMode() && draft.matchPoint) {
    previewDragHandle(draft.matchPoint, 'Drag to move your matching-question position', {
      drag: (e) => {
        const ll = e.target.getLatLng();
        if (setMatchingPoiFromCoord([ll.lng, ll.lat])) renderPreviewShapes();
      },
      dragend: () => renderToolForm()
    });
    return;
  }

  if (activeTool !== 'thermometer') return;
  const radiusM = thermometerPreviewRadius();
  if (!draft.a || !(radiusM > 0)) return;
  if (!draft.b) draft.b = turf.destination(turf.point(draft.a), radiusM / 1000, 90,
    { units: 'kilometers' }).geometry.coordinates;
  draft.b = constrainToRadius(draft.a, draft.b, radiusM);
  renderPreviewShapes();

  let endHandle = null;
  previewDragHandle(draft.a, 'Drag to move the thermometer start point', {
    drag: (e) => {
      let bearing = 90;
      try { bearing = turf.bearing(turf.point(draft.a), turf.point(draft.b)); } catch (_) {}
      const ll = e.target.getLatLng();
      draft.a = [ll.lng, ll.lat];
      draft.b = turf.destination(turf.point(draft.a), radiusM / 1000, bearing,
        { units: 'kilometers' }).geometry.coordinates;
      if (endHandle) endHandle.setLatLng([draft.b[1], draft.b[0]]);
      renderPreviewShapes();
    },
    dragend: () => renderToolForm()
  });

  endHandle = previewDragHandle(draft.b, 'Drag to move the thermometer end point', {
    drag: (e) => {
      const ll = e.target.getLatLng();
      draft.b = constrainToRadius(draft.a, [ll.lng, ll.lat], radiusM);
      e.target.setLatLng([draft.b[1], draft.b[0]]);
      renderPreviewShapes();
    },
    dragend: () => renderToolForm()
  });
}

function syncQuestionPreview() {
  if (!questionPreview.active || questionPreview.type !== activeTool) {
    previewShapeLayer.clearLayers();
    previewHandleLayer.clearLayers();
    return;
  }
  renderPreviewShapes();
  renderPreviewHandles();
}

function clearLiveDraftGeometry() {
  if (activeTool === 'radar') delete draft.center;
  else if (activeTool === 'thermometer') {
    delete draft.a; delete draft.b; delete draft.distanceConfirmed;
  } else if (activeTool === 'measuring') {
    delete draft.seeker; delete draft.target;
    delete draft.borderDistanceM; delete draft.borderBandGeometry;
  } else if (activeTool === 'nearest') {
    if (matchingAreaMode()) {
      delete draft.matchPoint; delete draft.matchGeometry; delete draft.matchName;
    } else if (matchingPoiMode()) {
      delete draft.matchPoint; delete draft.matchName; delete draft.matchDistanceM;
      draft.index = null; delete draft.answer;
      draft.points = matchingPoiFeatures().map((ft) => ft.geometry.coordinates.slice());
    } else {
      draft.points = []; draft.index = null;
    }
  } else if (activeTool === 'transit') {
    delete draft.lineGeom; delete draft.lineName;
  } else if (activeTool === 'zone') {
    delete draft.zoneGeometry; delete draft.zoneName; delete draft.zoneIdx;
  } else if (activeTool === 'area') {
    delete draft.geometry;
  }
}

function addPreviewControls(box) {
  // Map is always one tap away in the mobile nav, and closing/cancelling the
  // question already clears its draft. Keep the useful impact/instruction text
  // without spending vertical space on redundant Open Map / Clear Draft buttons.
  const text = document.createElement('p');
  text.id = 'previewImpactText';
  text.className = 'question-preview-impact live-draft-inline';
  text.textContent = 'Live map draft — nothing is logged until you press Log answer.';
  box.appendChild(text);
}

function commit(c) {
  releaseQuestionZoneLayers();
  releaseQuestionPoiLayer();
  deactivateQuestionPreview();
  c.id = uid();
  c.active = true;
  S.constraints.unshift(c);
  activeTool = null;
  selectedQuestion = null;
  questionDeckOpenKey = null;
  renderToolForm();
  recompute();
  switchTab('log');
  toast('Answer logged.');
}

/* --- radar --- */
function radarForm(box) {
  mapPointStatus(box, 'Where you asked from', draft.center, {
    empty: 'Tap anywhere on the map to place or move the radar',
    gps: true, set: (c) => { draft.center = c; }
  });

  if (selectedQuestion && selectedQuestion.typeKey === 'radar' && !draft.customRadius) {
    const fixed = document.createElement('div');
    fixed.className = 'selected-distance';
    fixed.innerHTML = `<span>Card distance</span><strong>${escapeHtml(draft.label || selectedQuestion.label)}</strong>`;
    box.appendChild(fixed);
  } else if (selectedQuestion && selectedQuestion.typeKey === 'radar' && draft.customRadius) {
    const custom = document.createElement('div');
    custom.className = 'field';
    custom.innerHTML = '<label>Custom radius</label>';
    const row = document.createElement('div');
    row.className = 'inline custom-distance-row';
    const inp = document.createElement('input');
    // type=number rejects useful intermediate states such as "0." on several
    // mobile keyboards (and Danish keyboards commonly emit a comma). Keep the
    // user's text intact and parse both decimal separators ourselves.
    inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off';
    inp.pattern = '[0-9]*[.,]?[0-9]*';
    inp.placeholder = 'Distance';
    inp.value = draft.customValue || '';
    const unit = document.createElement('select');
    unit.innerHTML = '<option value="mi">miles</option><option value="ft">feet</option><option value="km">kilometres</option><option value="m">metres</option>';
    unit.value = draft.customUnit || 'mi';
    const update = () => {
      const value = parsePositiveDecimal(inp.value);
      draft.customValue = inp.value;
      draft.customUnit = unit.value;
      if (!(value > 0)) { draft.radiusM = null; draft.label = null; syncQuestionPreview(); return; }
      const factors = { mi: MI, ft: FT, km: 1000, m: 1 };
      const labels = { mi: value === 1 ? 'mile' : 'miles', ft: 'ft', km: 'km', m: 'm' };
      draft.radiusM = value * factors[unit.value];
      draft.label = `${value} ${labels[unit.value]}`;
      syncQuestionPreview();
    };
    inp.addEventListener('input', update);
    // Rebuild only after editing is complete so the live Log button state is
    // refreshed without destroying the mobile keyboard mid-decimal.
    inp.addEventListener('change', () => { update(); renderToolForm(); });
    unit.addEventListener('change', () => { update(); renderToolForm(); });
    row.append(inp, unit);
    custom.appendChild(row);
    box.appendChild(custom);
  } else {
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
      draft.label = inp.value ? `${Number(inp.value)} ${smallUnit()}` : null;
      renderToolForm();
    });
    custom.appendChild(inp);
    box.appendChild(custom);
  }

  if (questionPreview.active && selectedQuestion && selectedQuestion.typeKey === 'radar') {
    const radarType = QUESTION_DECK.find((q) => q.key === 'radar');
    const cards = radarType && radarType.groups && radarType.groups[0] ? radarType.groups[0].cards : [];
    const switcher = document.createElement('div');
    switcher.className = 'field radar-preview-switcher';
    switcher.innerHTML = '<label>Change Radar card while previewing</label>';
    const chips = document.createElement('div');
    chips.className = 'chips';
    cards.forEach(([label, phrase, note, data]) => {
      const b = document.createElement('button');
      const isCustom = !!(data && data.custom);
      const active = isCustom ? draft.customRadius : (!draft.customRadius && draft.label === (data.radiusLabel || label));
      b.className = 'chip' + (active ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        selectedQuestion.label = label;
        selectedQuestion.phrase = phrase;
        selectedQuestion.note = note || '';
        selectedQuestion.data = data || {};
        draft.customRadius = isCustom;
        if (isCustom) {
          const value = parsePositiveDecimal(draft.customValue);
          const factors = { mi: MI, ft: FT, km: 1000, m: 1 };
          if (value > 0) {
            draft.radiusM = value * factors[draft.customUnit || 'mi'];
            draft.label = `${value} ${draft.customUnit || 'mi'}`;
          } else {
            draft.radiusM = null; draft.label = null;
          }
        } else {
          draft.radiusM = data.radiusM;
          draft.label = data.radiusLabel || label;
        }
        renderToolForm();
      });
      chips.appendChild(b);
    });
    switcher.appendChild(chips);
    box.appendChild(switcher);
  }

  answerSeg(box, [['yes', 'Yes'], ['no', 'No']]);
  actions(box, draft.center && draft.radiusM && draft.answer, () =>
    commit({ type: 'radar', center: draft.center, radiusM: draft.radiusM,
             label: draft.label || null, answer: draft.answer }));
}

/* --- thermometer --- */
function thermoForm(box) {
  mapPointStatus(box, 'Start point', draft.a, {
    empty: 'Tap the map to set the start', gps: true,
    set: (c) => {
      draft.a = c;
      const r = thermometerPreviewRadius();
      if (r > 0) draft.b = turf.destination(turf.point(c), r / 1000, 90,
        { units: 'kilometers' }).geometry.coordinates;
    }
  });
  mapPointStatus(box, 'Preview end point', draft.b, {
    empty: 'Tap the map again or drag the circular handle'
  });

  const required = draft.requiredDistanceM || 0;
  let straightM = 0;
  if (required) {
    const fixed = document.createElement('div');
    fixed.className = 'selected-distance';
    fixed.innerHTML = `<span>Minimum travel distance</span><strong>${escapeHtml(draft.requiredDistanceLabel || fmtDist(required))}</strong>`;
    box.appendChild(fixed);
  }

  if (draft.a && draft.b) {
    straightM = turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000;
    const p = document.createElement('p');
    p.className = 'hint' + (required && straightM >= required ? ' is-valid' : '');
    p.textContent = `Your start and end points are ${fmtDist(straightM)} apart in a straight line.`;
    box.appendChild(p);

    if (required && straightM < required) {
      const confirm = document.createElement('label');
      confirm.className = 'travel-confirm';
      confirm.innerHTML = `<input type="checkbox" ${draft.distanceConfirmed ? 'checked' : ''}>
        <span>I confirm the actual route travelled was at least ${escapeHtml(draft.requiredDistanceLabel || fmtDist(required))}.</span>`;
      confirm.querySelector('input').addEventListener('change', (e) => {
        draft.distanceConfirmed = e.target.checked;
        renderToolForm();
      });
      box.appendChild(confirm);
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'The thermometer boundary uses the start and end points. The card minimum concerns the route you actually travelled, which can be longer than the straight-line separation.';
      box.appendChild(note);
    }
  }
  answerSeg(box, [['hotter', 'Hotter'], ['colder', 'Colder']]);
  const distanceOkay = !required || straightM >= required || draft.distanceConfirmed;
  actions(box, draft.a && draft.b && draft.answer && distanceOkay, () => {
    const m = turf.distance(turf.point(draft.a), turf.point(draft.b), { units: 'kilometers' }) * 1000;
    commit({ type: 'thermometer', a: draft.a, b: draft.b, travelM: m,
             requiredDistanceM: required || null,
             requiredDistanceLabel: draft.requiredDistanceLabel || null,
             answer: draft.answer });
  });
}

/* --- measuring --- */
function measuringForm(box) {
  const borderMode = measuringBorderMode();
  if (borderMode) {
    mapPointStatus(box, 'Where you asked from', draft.seeker, {
      empty: draft.borderLoading ? `Loading ${borderMode.label}…` : 'Tap the map to set or move your position',
      gps: true,
      set: (c) => {
        if (!updateMeasuringBorderFromCoord(c)) toast(`Could not measure the ${borderMode.label} yet.`, true);
      }
    });

    if (draft.borderDistanceM != null) {
      const readout = document.createElement('div');
      readout.className = 'zone-distance-readout';
      readout.innerHTML = `Your nearest <strong>${escapeHtml(borderMode.label)}</strong> is <strong>${escapeHtml(fmtDist(draft.borderDistanceM))}</strong> away.<br>` +
        `The cyan band shows every point that is closer to any ${escapeHtml(borderMode.label)} than you are.`;
      box.appendChild(readout);
    } else {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = draft.borderLoading
        ? `The ${borderMode.label} layer is loading and will appear on the map automatically.`
        : `Tap the map. A live band will appear around every ${borderMode.label}, using your distance to the nearest border as its width.`;
      box.appendChild(hint);
    }

    answerSeg(box, [['closer', 'Closer'], ['further', 'Further']]);
    actions(box, draft.seeker && draft.borderBandGeometry && draft.answer, () =>
      commit({ type: 'borderDistance', geometry: draft.borderBandGeometry,
               distanceM: draft.borderDistanceM, zoneLevel: borderMode.level,
               borderName: borderMode.label, answer: draft.answer }));
    return;
  }

  mapPointStatus(box, 'Where you asked from', draft.seeker, {
    empty: 'First map tap sets your position', gps: true,
    set: (c) => { draft.seeker = c; }
  });
  mapPointStatus(box, 'The thing being measured', draft.target, {
    empty: draft.seeker ? 'Next map tap sets or moves the target' : 'Set your position first'
  });

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
  note.textContent = 'Drop the pin on the map icon you both measured to. For coastlines and the Limfjord, draw a free shape instead — a single pin cannot represent a line.';
  box.appendChild(note);

  answerSeg(box, [['closer', 'Closer'], ['further', 'Further']]);
  actions(box, draft.seeker && draft.target && draft.answer, () =>
    commit({ type: 'measuring', seeker: draft.seeker, target: draft.target,
             targetName: draft.targetName, answer: draft.answer }));
}

/* --- matching / tentacles --- */
function nearestForm(box) {
  const areaMode = matchingAreaMode();
  if (areaMode) {
    const info = document.createElement('div');
    info.className = 'map-point-status matching-area-status';
    const stateText = draft.matchName
      ? draft.matchName
      : (draft.matchLoading ? `Loading ${areaMode.label} boundaries…` : 'Tap your position on the map');
    info.innerHTML = `<div><strong>${areaMode.kind === 'landmass' ? 'Your landmass' : `Your ${escapeHtml(areaMode.label)}`}</strong>
      <small>${escapeHtml(stateText)}</small></div>`;
    box.appendChild(info);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = areaMode.kind === 'landmass'
      ? 'For Aalborg, the Limfjord is the useful landmass split: Nørresundby versus the play area south of the fjord. Tap where you asked from.'
      : `The official ${areaMode.label} layer is used directly. Tap where you asked from and the containing area will be selected.`;
    box.appendChild(hint);

    if (areaMode.kind === 'landmass') {
      const key = document.createElement('div');
      key.className = 'landmass-key';
      key.innerHTML = '<span><i style="background:#67e8f9"></i>Nørresundby / north</span>' +
        '<span><i style="background:#fbbf24"></i>Aalborg / south</span>';
      box.appendChild(key);
    }

    const mapBtn = document.createElement('button');
    mapBtn.type = 'button'; mapBtn.className = 'ghost-btn wide';
    mapBtn.textContent = draft.matchGeometry ? 'Change position on map' : 'Open map to choose position';
    mapBtn.addEventListener('click', closeSheet);
    box.appendChild(mapBtn);

    answerSeg(box, [['yes', 'Match'], ['no', 'No match']]);
    actions(box, !!(draft.matchGeometry && draft.answer), () => commit({
      type: 'zone', geometry: draft.matchGeometry, zoneName: draft.matchName || areaMode.label,
      categoryName: selectedQuestion ? selectedQuestion.label : areaMode.label,
      matching: true, answer: draft.answer
    }));
    return;
  }

  const poiMode = matchingPoiMode();
  if (poiMode) {
    const feats = matchingPoiFeatures();
    const info = document.createElement('div');
    info.className = 'map-point-status matching-poi-status';
    let state = `Loading ${poiMode.plural}…`;
    if (draft.poiError) state = `Could not load: ${draft.poiError}`;
    else if (!questionPoi.loading && !draft.poiLoading && !feats.length) state = `No ${poiMode.plural} found in the Aalborg search area`;
    else if (draft.matchName) state = `${draft.matchName}${draft.matchDistanceM != null ? ` · ${fmtDist(draft.matchDistanceM)} away` : ''}`;
    else if (feats.length) state = `${feats.length} ${poiMode.plural} loaded · tap your position`;
    info.innerHTML = `<div><strong>Your nearest ${escapeHtml(poiMode.singular)}</strong><small>${escapeHtml(state)}</small></div>`;
    box.appendChild(info);

    const key = document.createElement('div');
    key.className = 'poi-key';
    key.innerHTML = `<span><i></i>${escapeHtml(poiMode.plural)}${poiMode.officialNames ? ' · official Aalborg list cross-check' : ' from OpenStreetMap'}</span>`;
    box.appendChild(key);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = feats.length
      ? 'Tap anywhere in the play area. The nearest mapped place is chosen automatically; its nearest-place territory is outlined in cyan. Tap again or drag the handle to reposition.'
      : (questionPoi.loading || draft.poiLoading
          ? 'The candidate places will appear on the map as soon as OpenStreetMap responds.'
          : `If none are mapped nearby, this card cannot be automated for the current search area.`);
    box.appendChild(hint);

    const mapBtn = document.createElement('button');
    mapBtn.type = 'button'; mapBtn.className = 'ghost-btn wide';
    mapBtn.textContent = draft.matchPoint ? 'Change position on map' : 'Open map to choose position';
    mapBtn.disabled = !feats.length;
    mapBtn.addEventListener('click', closeSheet);
    box.appendChild(mapBtn);

    if (!feats.length && !questionPoi.loading && !draft.poiLoading) {
      const manual = document.createElement('button');
      manual.type = 'button'; manual.className = 'ghost-btn wide';
      manual.textContent = 'Use manual candidate points instead';
      manual.addEventListener('click', () => {
        releaseQuestionPoiLayer();
        draft.poiManual = true;
        draft.points = []; draft.index = null;
        delete draft.matchPoint; delete draft.matchName; delete draft.matchDistanceM;
        renderToolForm();
      });
      box.appendChild(manual);
    }

    answerSeg(box, [['yes', 'Match'], ['no', 'No match']]);
    const ready = !!(draft.matchPoint && draft.index != null && draft.answer && feats.length);
    actions(box, ready, () => {
      const cell = matchingPoiCell();
      if (!cell) { toast('Could not build the nearest-place area.', true); return; }
      commit({
        type: 'zone', geometry: cell.geometry, zoneName: draft.matchName || poiMode.singular,
        categoryName: selectedQuestion ? selectedQuestion.label : poiMode.singular,
        matching: true, answer: draft.answer
      });
    });
    return;
  }

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
  addBtn.textContent = 'Open map to add locations';
  addBtn.addEventListener('click', closeSheet);
  f.appendChild(addBtn);
  box.appendChild(f);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Tap the map or a visible stop marker to add every candidate, then tap the one nearest to you in this list.';
  box.appendChild(hint);

  const tentaclesAllowed = !selectedQuestion || selectedQuestion.typeKey !== 'matching';
  if (tentaclesAllowed) {
    smallInput(box, 'radiusM', 'Tentacle radius — leave blank for a plain matching question', '');
    if (draft.radiusM) slot(box, 'seeker', 'Tentacle centre (you)');
  }

  answerSeg(box, [['yes', 'Match'], ['no', 'No match']]);

  const ready = draft.points.length > 0 && draft.answer && draft.index != null &&
                (!draft.radiusM || draft.seeker);
  actions(box, ready, () => commit({
    type: 'nearest', points: draft.points.slice(), index: draft.index,
    categoryName: draft.categoryName, radiusM: draft.radiusM || null,
    seeker: draft.seeker || null, answer: draft.answer
  }));
}

/* --- photos --- */
function photoForm(box) {
  const prompt = document.createElement('section');
  prompt.className = 'photo-prompt-card';
  prompt.innerHTML = `<p class="photo-prompt-title">${escapeHtml(cardQuestionSentence('photos', selectedQuestion ? selectedQuestion.phrase : (draft.photoSubject || 'the selected subject')))}</p>
    ${selectedQuestion && selectedQuestion.note ? `<p>${escapeHtml(selectedQuestion.note)}</p>` : ''}
    <p class="photo-time-note">Small-game time limit: 10 minutes.</p>`;
  box.appendChild(prompt);

  const noteField = document.createElement('div');
  noteField.className = 'field';
  noteField.innerHTML = '<label>Optional note</label>';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'e.g. received at 14:32';
  input.value = draft.photoNote || '';
  input.addEventListener('input', () => { draft.photoNote = input.value; });
  noteField.appendChild(input);
  box.appendChild(noteField);

  const help = document.createElement('p');
  help.className = 'hint';
  help.textContent = 'Photo cards do not directly eliminate an area on the map. Logging one records that it was asked and received; use Free shape separately if the photo lets the seekers rule out an area.';
  box.appendChild(help);

  actions(box, true, () => commit({
    type: 'photo',
    subject: selectedQuestion ? selectedQuestion.label : (draft.photoSubject || 'Photo'),
    prompt: selectedQuestion ? cardQuestionSentence('photos', selectedQuestion.phrase) : 'Send a photo.',
    instruction: selectedQuestion ? selectedQuestion.note : '',
    note: draft.photoNote || ''
  }), 'Log photo received');
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
  if (draft.zoneIdx !== '' && draft.zoneIdx != null && zones[Number(draft.zoneIdx)]) {
    const selected = zones[Number(draft.zoneIdx)];
    draft.zoneGeometry = selected.ft.geometry;
    draft.zoneName = featureName(selected.ft, selected.zl);
  }
  sel.addEventListener('change', () => {
    draft.zoneIdx = sel.value;
    const selected = zones[Number(sel.value)];
    draft.zoneGeometry = selected ? selected.ft.geometry : null;
    draft.zoneName = selected ? featureName(selected.ft, selected.zl) : '';
    renderToolForm();
  });
  f.appendChild(sel);
  box.appendChild(f);

  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'Or just tap a zone on the map to pick it.';
  box.appendChild(p);

  answerSeg(box, [['yes', 'Same zone'], ['no', 'Different zone']]);
  actions(box, draft.zoneIdx !== '' && draft.zoneIdx != null && draft.answer, () => {
    commit({ type: 'zone', geometry: draft.zoneGeometry,
             zoneName: draft.zoneName, answer: draft.answer });
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
                derived: opts.derived || null, visible: true, layer: null,
                routeLayer: !!opts.routeLayer, routeCount: opts.routeCount || 0,
                routeRefs: opts.routeRefs || [], labelLayer: null };

  const styleOf = (ft) => {
    const cat = categoryFor(rec.style, ft.properties);
    const c = cat ? cat.color : color;
    if (kind === 'line' && rec.routeLayer) {
      const props = ft.properties || {};
      const st = routeStyle(props.__routeRef || featureName(ft, rec));
      if (props.__routeColor) st.color = props.__routeColor;
      return st;
    }
    return kind === 'line'
      ? { color: c, weight: 3, opacity: .85 }
      : { color: c, weight: 1.3, opacity: .9, fillColor: c, fillOpacity: cat ? .35 : .05 };
  };

  rec.layer = L.geoJSON(fcol, {
    pane: kind === 'line' && rec.routeLayer ? 'routePane' : 'zonePane',
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
          if (idx >= 0) {
            draft.zoneIdx = String(idx);
            draft.zoneGeometry = ft.geometry;
            draft.zoneName = featureName(ft, rec);
            renderToolForm(); openSheet();
          }
        }
        if (kind === 'poly' && activeTool === 'nearest' && matchingAreaMode()) {
          const mode = matchingAreaMode();
          if ((mode.kind === 'zone' && rec.sourceKey === mode.sourceKey) ||
              (mode.kind === 'landmass' && rec.sourceKey === 'zone2')) {
            L.DomEvent.stopPropagation(e);
            const ll = e.latlng;
            if (ll && setMatchingAreaFromCoord([ll.lng, ll.lat])) {
              renderToolForm();
              if (window.innerWidth <= 820) openSheet('ask');
            }
            return;
          }
        }
        if (kind === 'line' && activeTool === 'transit') {
          L.DomEvent.stopPropagation(e);
          if (rec.routeLayer && (ft.properties || {}).__routeRef) {
            const ref = String(ft.properties.__routeRef);
            const parts = [];
            for (const routeFt of rec.geojson.features || []) {
              if (String((routeFt.properties || {}).__routeRef || '') !== ref) continue;
              parts.push(...geometryParts(routeFt.geometry));
            }
            draft.lineGeom = parts.length === 1
              ? { type: 'LineString', coordinates: parts[0] }
              : { type: 'MultiLineString', coordinates: parts };
            draft.lineName = ref;
          } else {
            draft.lineGeom = ft.geometry;
            draft.lineName = featureName(ft, rec);
          }
          renderToolForm(); openSheet();
        }
      });
    }
  }).addTo(map);

  S.layers.push(rec);
  if (rec.routeLayer && opts.routeLabelGeojson) {
    rec.labelLayer = buildRouteLabelLayer(opts.routeLabelGeojson);
    syncRouteLabels(rec);
  }

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
  if (ex.labelLayer) map.removeLayer(ex.labelLayer);
  S.layers = S.layers.filter((l) => l !== ex);
}

function setLayerVisible(rec, on) {
  rec.visible = on;
  if (on) rec.layer.addTo(map); else map.removeLayer(rec.layer);
  syncRouteLabels(rec);
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
      if (zl.labelLayer) map.removeLayer(zl.labelLayer);
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

async function fetchGeoJson(url, timeoutMs = 45000) {
  const res = await fetchReliable(url, {}, timeoutMs, 2);
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
  const list = (urls || []).filter(Boolean);
  if (!list.length) throw new Error('no source URL');
  const problems = [];
  for (const u of list) {
    try {
      const isKortInfo = /drift\.kortinfo\.net/i.test(u);
      const isGc2 = /vidi\.gc2\.io/i.test(u);
      const timeout = isKortInfo ? 50000 : (isGc2 ? 25000 : (list.length > 1 ? 25000 : 40000));
      return await fetchGeoJson(u, timeout);
    }
    catch (err) { problems.push(err.message || String(err)); }
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
  const res = await fetchReliable(capsUrl(url), {}, 30000, 2);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = parseWfsCapabilities(await res.text());
  if (!list.length) throw new Error('No layers listed — is that a WFS endpoint?');
  return list;
}


/* ---------- route preparation, colours and repeated labels --------------- */

function routeRefCompare(a, b) {
  return String(a).localeCompare(String(b), 'da', { numeric: true, sensitivity: 'base' });
}

function routeTokens(value) {
  if (value == null || (typeof value !== 'string' && typeof value !== 'number')) return [];
  const text = String(value).toUpperCase().replace(/\b(?:LINJE|RUTE|ROUTE|LINE)\b/g, ' ');
  const found = text.match(/(?:^|[^A-Z0-9])(\d{1,3}[A-Z]?)(?=$|[^A-Z0-9])/g) || [];
  return found.map((x) => (x.match(/\d{1,3}[A-Z]?/) || [''])[0]).filter(Boolean);
}

const ROUTE_REF_KEYS = [
  'rutenr', 'rutenummer', 'rute_nr', 'route_ref', 'route', 'ref',
  'linjenr', 'linienr', 'linjenummer', 'linienummer', 'linje', 'linie'
];

function extractRouteRefs(props) {
  const p = props || {};
  if (Array.isArray(p.__routeRefs)) {
    return Array.from(new Set(p.__routeRefs.map((x) => String(x).trim()).filter(Boolean))).sort(routeRefCompare);
  }
  const keys = Object.keys(p);
  const values = [];
  for (const wanted of ROUTE_REF_KEYS) {
    const hit = keys.find((k) => k.toLowerCase() === wanted);
    if (hit) values.push(p[hit]);
  }
  if (!values.length) {
    for (const k of keys) if (/(?:rute|route|linje|linie|line|ref)/i.test(k)) values.push(p[k]);
  }
  // Last resort: route map layers often put the number at the start of navn.
  for (const k of ['__displayName', 'navn', 'name', 'rutenavn', 'linjenavn']) {
    const hit = keys.find((x) => x.toLowerCase() === k.toLowerCase());
    if (hit) values.push(p[hit]);
  }
  const out = [];
  values.forEach((v) => routeTokens(v).forEach((r) => out.push(r)));
  return Array.from(new Set(out)).sort(routeRefCompare);
}

function routeHash(value) {
  let h = 2166136261;
  for (const ch of String(value || '?')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function routeColor(ref) {
  return ROUTE_PALETTE[routeHash(ref) % ROUTE_PALETTE.length];
}

function routeStyle(ref) {
  const h = routeHash(ref);
  return {
    color: routeColor(ref), weight: 3.6, opacity: .9,
    dashArray: ROUTE_DASHES[h % ROUTE_DASHES.length],
    dashOffset: String((h >>> 5) % 18), lineCap: 'round', lineJoin: 'round'
  };
}

function annotateRouteFeature(ft, sourceKey) {
  ft.properties = ft.properties || {};
  const refs = extractRouteRefs(ft.properties);
  ft.properties.__routeRefs = refs;
  ft.properties.__routeClass = sourceKey || ft.properties.__routeClass || '';
  const existing = labelValue(ft.properties.__displayName || ft.properties.rutenavn || ft.properties.linjenavn || ft.properties.navn);
  ft.properties.__routeName = existing;
  if (refs.length) ft.properties.__displayName = refs.join(', ');
  return ft;
}

function annotateRouteGeoJson(gj, sourceKey) {
  for (const ft of (gj && gj.features) || []) annotateRouteFeature(ft, sourceKey);
  return gj;
}

function geometryParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

/* Make one coloured path per route number. When a source already represents a
   shared corridor with refs "11, 12, 14", the paths are duplicated with
   different colours/dash phases, so no one line completely hides the others. */
function prepareRouteDisplayGeoJson(gj) {
  const out = [];
  const allRefs = routeSummary(gj).refs;
  const colors = new Map(allRefs.map((ref, i) => [ref, ROUTE_PALETTE[i % ROUTE_PALETTE.length]]));
  for (const original of (gj && gj.features) || []) {
    if (!original || !original.geometry || !/LineString/.test(original.geometry.type)) continue;
    const refs = extractRouteRefs(original.properties);
    const use = refs.length ? refs : ['?'];
    for (const ref of use) {
      const ft = turf.clone(original);
      ft.properties = Object.assign({}, ft.properties, {
        __routeRefs: refs,
        __routeRef: ref,
        __displayName: ref === '?' ? (ft.properties.__routeName || 'Bus route') : ref,
        __routeColor: colors.get(ref) || routeColor(ref)
      });
      out.push(ft);
    }
  }
  return { type: 'FeatureCollection', features: out };
}

function routeSummary(gj) {
  const refs = new Set();
  for (const ft of (gj && gj.features) || []) extractRouteRefs(ft.properties).forEach((r) => refs.add(r));
  return { refs: Array.from(refs).sort(routeRefCompare), count: refs.size };
}

/* Build shared-corridor labels without needing the route geometries to have
   byte-identical vertices. Lines are sampled every ~140 m, bucketed in an
   80 m grid, and only combined when their local bearings also agree. */
function routeLabelPoints(gj) {
  const buckets = new Map();
  const lat0 = CONFIG.center[0] * Math.PI / 180;
  const toXY = ([lng, lat]) => [lng * 111320 * Math.cos(lat0), lat * 110540];
  for (const ft of (gj && gj.features) || []) {
    const refs = extractRouteRefs(ft.properties);
    if (!refs.length) continue;
    for (const coords of geometryParts(ft.geometry)) {
      if (!coords || coords.length < 2) continue;
      let line;
      try { line = turf.lineString(coords); } catch (_) { continue; }
      const lenKm = turf.length(line, { units: 'kilometers' });
      if (!(lenKm > .08)) continue;
      const stepKm = .14;
      for (let d = Math.min(.08, lenKm / 3); d < lenKm; d += stepKm) {
        const p = turf.along(line, d, { units: 'kilometers' });
        const p2 = turf.along(line, Math.min(lenKm, d + .04), { units: 'kilometers' });
        const c = p.geometry.coordinates;
        const [x, y] = toXY(c);
        let bearing = turf.bearing(p, p2);
        bearing = ((bearing % 180) + 180) % 180;
        const angleBin = Math.round(bearing / 20) % 9;
        const gx = Math.round(x / 90), gy = Math.round(y / 90);
        let key = '', b = null, bestD = Infinity;
        // Route relations often start at different termini, so equal-distance
        // samples are not phase aligned. Search neighbouring grid cells and
        // merge only when the local direction agrees and the points are close.
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const k = `${gx + dx}:${gy + dy}:${angleBin}`;
          const candidate = buckets.get(k);
          if (!candidate) continue;
          const bx = candidate.sumX / candidate.n, by = candidate.sumY / candidate.n;
          const dist = Math.hypot(x - bx, y - by);
          if (dist < 75 && dist < bestD) { bestD = dist; key = k; b = candidate; }
        }
        if (!b) {
          key = `${gx}:${gy}:${angleBin}`;
          b = { sumLng: 0, sumLat: 0, sumX: 0, sumY: 0, n: 0, refs: new Set() };
          buckets.set(key, b);
        }
        b.sumLng += c[0]; b.sumLat += c[1]; b.sumX += x; b.sumY += y; b.n++;
        refs.forEach((r) => b.refs.add(r));
      }
    }
  }

  const candidates = Array.from(buckets.values()).map((b) => ({
    coordinates: [b.sumLng / b.n, b.sumLat / b.n],
    refs: Array.from(b.refs).sort(routeRefCompare)
  })).filter((x) => x.refs.length);
  // Shared labels win when crowded; otherwise keep the labels about 900 m apart.
  candidates.sort((a, b) => b.refs.length - a.refs.length || routeRefCompare(a.refs.join(','), b.refs.join(',')));
  const accepted = [];
  for (const c of candidates) {
    const text = c.refs.join(', ');
    const same = accepted.filter((a) => a.text === text);
    if (same.some((a) => turf.distance(turf.point(a.coordinates), turf.point(c.coordinates), { units: 'kilometers' }) < .9)) continue;
    if (accepted.some((a) => a.refs.length >= c.refs.length &&
        turf.distance(turf.point(a.coordinates), turf.point(c.coordinates), { units: 'kilometers' }) < .14)) continue;
    accepted.push({ coordinates: c.coordinates, refs: c.refs, text });
  }
  return accepted;
}

function buildRouteLabelLayer(gj) {
  const group = L.layerGroup();
  for (const p of routeLabelPoints(gj)) {
    const html = `<span class="route-label-chip">${escapeHtml(p.text)}</span>`;
    L.marker([p.coordinates[1], p.coordinates[0]], {
      pane: 'routeLabelPane', interactive: false,
      icon: L.divIcon({ className: 'route-label-icon', html, iconSize: [1, 1], iconAnchor: [0, 0] })
    }).addTo(group);
  }
  return group;
}

function syncRouteLabels(rec) {
  if (!rec || !rec.labelLayer) return;
  const show = rec.visible && map.getZoom() >= 11;
  if (show && !map.hasLayer(rec.labelLayer)) rec.labelLayer.addTo(map);
  if (!show && map.hasLayer(rec.labelLayer)) map.removeLayer(rec.labelLayer);
}

map.on('zoomend', () => {
  S.layers.forEach(syncRouteLabels);
  syncTransitStops();
});

function routeFeatureSignature(ft) {
  const refs = extractRouteRefs(ft.properties).join(',');
  let bb = '', ends = '', count = 0;
  try {
    bb = turf.bbox(ft).map((x) => Number(x).toFixed(5)).join(',');
    const parts = geometryParts(ft.geometry);
    count = parts.reduce((n, p) => n + p.length, 0);
    ends = parts.map((p) => {
      const a = p[0] || [], z = p[p.length - 1] || [];
      return [a[0], a[1], z[0], z[1]].map((x) => Number(x).toFixed(5)).join(',');
    }).sort().join(';');
  } catch (_) { /* leave the geometric signature empty */ }
  return `${refs}|${bb}|${count}|${ends}|${ft.geometry && ft.geometry.type}`;
}

function dedupeRouteFeatures(features) {
  const seen = new Set();
  return features.filter((ft) => {
    const sig = routeFeatureSignature(ft);
    if (seen.has(sig)) return false;
    seen.add(sig); return true;
  });
}

function ntBusLayerDefs(layers) {
  const defs = [];
  for (const layer of layers || []) {
    const hay = `${layer.name || ''} ${layer.title || ''} ${layer.abstract || ''}`;
    if (!NT_BUS_LAYER_WORDS.test(hay) || NT_BUS_LAYER_EXCLUDE.test(hay)) continue;
    const raw = String(layer.name || '').split(':').pop();
    if (!raw) continue;
    const table = `rutekortweb.${raw}`;
    const lower = hay.toLowerCase();
    let key = 'other', label = layer.title || raw;
    if (lower.includes('bybus')) { key = 'city'; label = 'city'; }
    else if (lower.includes('regionalbus')) { key = 'regional'; label = 'regional'; }
    else if (lower.includes('lokalbus')) { key = 'local'; label = 'local'; }
    else if (lower.includes('telebus')) { key = 'telebus'; label = 'telebus'; }
    else if (lower.includes('xbus') || lower.includes('expresbus')) { key = 'xbus'; label = 'X bus'; }
    if (/biforl|branch|sideforl/i.test(hay)) label += ' branches';
    defs.push({ key, label, table, discovered: true });
  }
  const byTable = new Map();
  [...NT_BUS_TABLES, ...defs].forEach((d) => byTable.set(d.table, d));
  return Array.from(byTable.values());
}

async function discoverNtBusTables() {
  const res = await fetchReliable(capsUrl(NT_ROUTE_WFS), {}, 20000, 2);
  if (!res.ok) throw new Error(`capabilities HTTP ${res.status}`);
  const layers = parseWfsCapabilities(await res.text());
  const defs = ntBusLayerDefs(layers);
  return defs.length ? defs : NT_BUS_TABLES.slice();
}

function hasRouteRef(gj, ref) {
  const wanted = String(ref);
  return ((gj && gj.features) || []).some((ft) => extractRouteRefs(ft.properties).includes(wanted));
}

function normaliseStopName(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function overpassBusStopQuery() {
  const [s2, w, n, e] = OVERPASS_BBOX;
  const named = `[~"^(name|name:da|official_name)$"~"."]`;
  return `[out:json][timeout:30];(` +
    `node(${s2},${w},${n},${e})["highway"="bus_stop"]${named};` +
    `node(${s2},${w},${n},${e})["public_transport"="platform"]["bus"="yes"]${named};` +
    `way(${s2},${w},${n},${e})["public_transport"="platform"]["bus"="yes"]${named};` +
    `);out center tags;`;
}

function parseOverpassStops(json) {
  const out = [];
  for (const el of (json && json.elements) || []) {
    const tags = el.tags || {};
    const name = tags.name || tags['name:da'] || tags.official_name;
    const lat = el.lat ?? (el.center && el.center.lat);
    const lon = el.lon ?? (el.center && el.center.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ name, norm: normaliseStopName(name), coordinates: [lon, lat] });
  }
  return out;
}

function overpassTransitStopsQuery(bbox = activeGameBbox(.6)) {
  const [s2, w, n, e] = bbox;
  // Only named stops can be displayed or used for Matching, so ask Overpass
  // for named features up front instead of downloading thousands of anonymous
  // platforms/stop positions and throwing them away afterwards. Accept Danish
  // and official-name-only records too; those are named even without `name=*`.
  const named = `[~"^(name|name:da|official_name)$"~"."]`;
  return `[out:json][timeout:30];(` +
    `node(${s2},${w},${n},${e})["highway"="bus_stop"]${named};` +
    `nwr(${s2},${w},${n},${e})["public_transport"="platform"]${named};` +
    `nwr(${s2},${w},${n},${e})["public_transport"="stop_position"]${named};` +
    `nwr(${s2},${w},${n},${e})["public_transport"="station"]${named};` +
    `nwr(${s2},${w},${n},${e})["railway"~"^(station|halt|tram_stop)$"]${named};` +
    `);out center tags;`;
}

async function fetchTransitStopsJson() {
  const bbox = activeGameBbox(.6);
  try {
    return await overpassJson(overpassTransitStopsQuery(bbox), { timeoutMs: 25000 });
  } catch (wholeErr) {
    const [south, west, north, east] = bbox;
    const midLat = (south + north) / 2;
    const midLng = (west + east) / 2;
    const boxes = [
      [south, west, midLat, midLng], [south, midLng, midLat, east],
      [midLat, west, north, midLng], [midLat, midLng, north, east]
    ];
    const settled = await Promise.allSettled(boxes.map((box, i) =>
      overpassJson(overpassTransitStopsQuery(box), {
        timeoutMs: 18000, noFallback: true, urls: [OVERPASS[i % Math.min(2, OVERPASS.length)]]
      })
    ));
    const elements = [];
    settled.forEach((r) => {
      if (r.status === 'fulfilled' && r.value && Array.isArray(r.value.elements)) elements.push(...r.value.elements);
    });
    if (!elements.length) throw wholeErr;
    return { elements };
  }
}

function parseTransitStops(json) {
  const features = [];
  const seen = new Set();
  for (const el of (json && json.elements) || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? (el.center && el.center.lat);
    const lon = el.lon ?? (el.center && el.center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const railway = String(tags.railway || '').toLowerCase();
    const pt = String(tags.public_transport || '').toLowerCase();
    const isTrain = /^(station|halt|tram_stop|platform|stop)$/.test(railway) ||
      tags.train === 'yes' || tags.light_rail === 'yes';
    const isBus = tags.highway === 'bus_stop' || tags.bus === 'yes' ||
      (!isTrain && /^(platform|stop_position|station)$/.test(pt) && tags.ferry !== 'yes');
    if (!isTrain && !isBus) continue;
    const kind = isTrain ? 'train' : 'bus';
    const name = tags.name || tags['name:da'] || tags.official_name;
    // Unnamed platforms/stop positions add visual clutter and are useless for
    // Matching by station/stop identity, so do not expose them at all.
    if (!name || !String(name).trim()) continue;
    const key = `${kind}:${Math.round(lon * 1e6)}:${Math.round(lat * 1e6)}:${normaliseStopName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push(turf.point([lon, lat], {
      name, __displayName: name, __stopKind: kind,
      route_ref: tags.route_ref || tags.ref || '', shelter: tags.shelter || ''
    }));
  }
  return { type: 'FeatureCollection', features };
}

function buildTransitStopLayer(gj) {
  const group = L.layerGroup([], { pane: 'stopPane' });
  for (const ft of (gj && gj.features) || []) {
    if (!ft.geometry || ft.geometry.type !== 'Point') continue;
    const c = ft.geometry.coordinates;
    const p = ft.properties || {};
    const train = p.__stopKind === 'train';
    const marker = L.circleMarker([c[1], c[0]], {
      pane: 'stopPane', radius: train ? 6 : 4,
      color: train ? '#c4b5fd' : '#fde68a', weight: train ? 2.2 : 1.8,
      fillColor: train ? '#7c3aed' : '#d97706', fillOpacity: .92
    });
    marker.bindTooltip(`${train ? 'Train' : 'Bus'} · ${p.name}`, {
      className: 'stop-tip', direction: 'top', offset: [0, -5], sticky: true
    });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      marker.openTooltip();
      if (activeTool === 'measuring') {
        draft.target = c.slice();
        draft.targetName = p.name;
        renderToolForm(); openSheet();
      } else if (activeTool === 'nearest') {
        draft.points = draft.points || [];
        if (!draft.points.some((x) => turf.distance(turf.point(x), turf.point(c), { units: 'meters' }) < 3)) {
          draft.points.push(c.slice());
        }
        renderToolForm(); openSheet();
      }
    });
    marker.addTo(group);
  }
  return group;
}

function syncTransitStops() {
  const rec = S.transitStops;
  if (!rec || !rec.layer) return;
  const show = rec.visible && map.getZoom() >= 12;
  if (show && !map.hasLayer(rec.layer)) rec.layer.addTo(map);
  if (!show && map.hasLayer(rec.layer)) map.removeLayer(rec.layer);
}

async function toggleTransitStops(btn) {
  const rec = S.transitStops;
  if (rec.loaded) {
    rec.visible = !rec.visible;
    syncTransitStops();
    renderSourceRows();
    return;
  }
  if (rec.loading) return;
  rec.loading = true;
  setMapLoadingTask('transit-stops', 'bus & train stops', true);
  if (btn) btn.classList.add('is-busy');
  renderSourceRows();
  setStatus('Loading bus and train stops…');
  try {
    let gj = parseTransitStops(await fetchTransitStopsJson());
    // The small game only needs stops inside the current game area. Querying a
    // small padded box keeps edge stops discoverable; discard the padding before
    // drawing so off-map stops never clutter Matching or the layer.
    gj = filterMatchingPoisToPlayArea(gj);
    if (!gj.features.length) throw new Error('the map service returned no named stops inside the game area');
    rec.geojson = gj;
    rec.busCount = gj.features.filter((f) => f.properties.__stopKind === 'bus').length;
    rec.trainCount = gj.features.filter((f) => f.properties.__stopKind === 'train').length;
    rec.layer = buildTransitStopLayer(gj);
    rec.loaded = true;
    rec.visible = true;
    syncTransitStops();
    setStatus(`Transit stops: ${rec.busCount} bus stops and ${rec.trainCount} train/rail stops loaded. ` +
      'They appear from zoom level 12 and can be tapped when building Matching or Measuring questions.');
  } catch (err) {
    setStatus(`Bus and train stops failed — ${err.message}.`, true);
  } finally {
    rec.loading = false;
    setMapLoadingTask('transit-stops', null, false);
    if (btn) btn.classList.remove('is-busy');
    renderSourceRows();
  }
}

function stopMatchesAlias(stop, alias) {
  const a = normaliseStopName(alias);
  if (!a || !stop.norm) return false;
  return stop.norm === a || stop.norm.startsWith(a + ' ') || stop.norm.includes(' ' + a + ' ') ||
    (a.length >= 7 && stop.norm.includes(a));
}

function matchSupplementStops(stops, definition) {
  const chosen = [];
  let previous = CONFIG.center.slice().reverse(); // [lng,lat]
  for (const aliases of definition.anchors || []) {
    const candidates = (stops || []).filter((s) => aliases.some((a) => stopMatchesAlias(s, a)));
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const da = turf.distance(turf.point(previous), turf.point(a.coordinates), { units: 'kilometers' });
      const db = turf.distance(turf.point(previous), turf.point(b.coordinates), { units: 'kilometers' });
      return da - db;
    });
    const selected = candidates[0];
    if (!chosen.length || turf.distance(turf.point(chosen[chosen.length - 1]), turf.point(selected.coordinates),
        { units: 'meters' }) > 20) {
      chosen.push(selected.coordinates);
      previous = selected.coordinates;
    }
  }
  return chosen;
}

async function fetchOverpassStops() {
  const json = await overpassJson(overpassBusStopQuery(), { timeoutMs: 22000 });
  const stops = parseOverpassStops(json);
  if (stops.length) return stops;
  throw new Error('no named stops');
}

async function routeThroughStops(coords) {
  if (!coords || coords.length < 2) return null;
  const points = coords.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&steps=false`;
  const res = await fetchReliable(url, {}, 15000, 2);
  if (!res.ok) throw new Error(`routing HTTP ${res.status}`);
  const json = await res.json();
  const geometry = json && json.routes && json.routes[0] && json.routes[0].geometry;
  if (!geometry || geometry.type !== 'LineString' || geometry.coordinates.length < 2) {
    throw new Error('routing service returned no line');
  }
  return geometry;
}

async function addMissingBusRouteSupplements(gj) {
  const missing = REQUIRED_BUS_ROUTE_SUPPLEMENTS.filter((d) => !hasRouteRef(gj, d.ref));
  if (!missing.length) return [];
  let stops;
  try { stops = await fetchOverpassStops(); }
  catch (_) { return []; }
  const added = [];
  for (const def of missing) {
    const coords = matchSupplementStops(stops, def);
    if (coords.length < Math.max(5, Math.ceil((def.anchors || []).length * .55))) continue;
    let geometry;
    try { geometry = await routeThroughStops(coords); }
    catch (_) { geometry = { type: 'LineString', coordinates: coords }; }
    const ft = {
      type: 'Feature', geometry,
      properties: {
        ref: def.ref, name: def.name, __displayName: def.ref,
        __routeRefs: [def.ref], __routeName: def.name,
        __routeClass: 'stop-routed supplement', __supplement: true
      }
    };
    gj.features.push(ft); added.push(def.ref);
  }
  return added;
}

async function fetchNtBusRoutes() {
  /* Load the five known NT families immediately. Capability discovery is useful
     for branch/biforløb layers, but it must never sit in front of the main
     routes. Run discovery in parallel, then request only newly discovered
     tables. This is both faster and more reliable on a slow mobile connection. */
  const loadDef = async (def) => {
    try {
      const gj = await fetchFirst(gc2Urls(def.table));
      normaliseCoords(gj);
      annotateRouteGeoJson(gj, def.key);
      return { def, gj, error: null };
    } catch (error) { return { def, gj: null, error }; }
  };

  const fixedPromise = Promise.all(NT_BUS_TABLES.map(loadDef));
  const discoveryPromise = discoverNtBusTables().catch(() => NT_BUS_TABLES.slice());
  // Start OSM at the same time. We only consume it if NT is incomplete, but a
  // slow NT table no longer has to finish before the fallback even begins.
  const osmFallbackPromise = fetchOverpass('["route"="bus"]').catch(() => null);

  const fixedResults = await fixedPromise;
  const discoveredDefs = await discoveryPromise;
  const fixedTables = new Set(NT_BUS_TABLES.map((d) => d.table));
  const extraDefs = discoveredDefs.filter((d) => !fixedTables.has(d.table));
  const extraResults = extraDefs.length ? await Promise.all(extraDefs.map(loadDef)) : [];
  const results = [...fixedResults, ...extraResults];
  const discovered = extraDefs.length > 0;

  let features = [];
  const loaded = [], failed = [];
  for (const r of results) {
    if (r.gj && r.gj.features && r.gj.features.length) {
      loaded.push(r.def.label);
      features.push(...r.gj.features);
    } else failed.push(r.def.label);
  }

  // OSM remains useful when one NT table is unavailable and is the complete
  // fallback when the GC2 service cannot be reached at all. Give it enough time
  // to succeed rather than treating a slow mirror as a missing route network.
  if (!features.length || failed.length) {
    const osm = await osmFallbackPromise;
    if (osm) {
      annotateRouteGeoJson(osm, 'osm');
      const officialRefs = new Set();
      features.forEach((ft) => extractRouteRefs(ft.properties).forEach((r) => officialRefs.add(r)));
      for (const ft of osm.features || []) {
        const refs = extractRouteRefs(ft.properties);
        if (!features.length || refs.some((r) => !officialRefs.has(r))) features.push(ft);
      }
      if (!loaded.length) loaded.push('OpenStreetMap fallback');
    }
  }

  features = dedupeRouteFeatures(features);
  if (!features.length) {
    const reasons = results.map((r) => `${r.def.label}: ${r.error ? r.error.message : 'no features'}`).join(' / ');
    throw new Error(reasons || 'no bus route geometry returned');
  }

  const gj = { type: 'FeatureCollection', features };
  const supplements = await addMissingBusRouteSupplements(gj);
  const summary = routeSummary(gj);
  return { gj, loaded, failed, supplements, summary, discovered };
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
      properties: { navn: label, ref: t.ref || '', operator: t.operator || t.network || '',
                    __routeRefs: t.ref ? [String(t.ref)] : [], __displayName: t.ref ? String(t.ref) : label },
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
  const json = await overpassJson(overpassQuery(filter), { timeoutMs: 30000 });
  const gj = parseOverpassRoutes(json);
  if (!gj.features.length) throw new Error('no routes in the reply');
  return gj;
}

/* ---------- toggling sources ----------------------------------------- */

async function toggleSource(key, btn) {
  const src = S.sources[key];
  const ex = layerByKey('src:' + key);
  if (ex) { setLayerVisible(ex, !ex.visible); return; }
  if (zoneLoads.has(key)) return;

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
  setZoneLoading(key, true);
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
    setZoneLoading(key, false);
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
  setZoneLoading('zone2', true);
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
  } finally {
    setZoneLoading('zone2', false);
  }
}

async function toggleRoute(key, btn) {
  const r = ROUTE_SOURCES[key];
  const ex = layerByKey('route:' + key);
  if (ex) { setLayerVisible(ex, !ex.visible); return; }

  if (btn) btn.classList.add('is-busy');
  setMapLoadingTask(`route:${key}`, r.name, true);
  renderSourceRows();
  setStatus(`Loading ${r.name}…`);
  try {
    let gj, note = '', routeInfo = null;
    if (r.kind === 'nt-all') {
      routeInfo = await fetchNtBusRoutes();
      gj = routeInfo.gj;
      const missing = routeInfo.failed.length ? `; ${routeInfo.failed.join(', ')} supplemented where possible` : '';
      note = `${routeInfo.loaded.join(', ')}${missing}`;
    } else if (r.kind === 'overpass') {
      gj = await fetchOverpass(r.filter);
      ({ note } = normaliseCoords(gj));
      annotateRouteGeoJson(gj, key);
    } else {
      gj = await fetchFirst(gc2Urls(r.table));
      ({ note } = normaliseCoords(gj));
      annotateRouteGeoJson(gj, key);
    }

    const summary = routeInfo ? routeInfo.summary : routeSummary(gj);
    const display = key === 'bus' ? prepareRouteDisplayGeoJson(gj) : gj;
    const rec = addLayer(r.name, display, {
      key: 'route:' + key, kind: 'line', routeLayer: key === 'bus',
      routeLabelGeojson: key === 'bus' ? gj : null,
      routeCount: summary.count, routeRefs: summary.refs,
      baseGeojson: gj
    });
    if (rec) {
      const countText = summary.count ? `${summary.count} numbered routes` : `${gj.features.length} route lines`;
      setStatus(`${r.name}: ${countText} on${note ? ' (' + note + ')' : ''}. ` +
                `Labels repeat along the network; shared corridors list every bus using them.`);
    }
  } catch (err) {
    setStatus(`${r.name} failed — ${err.message}. You can still trace the needed route ` +
              `with the Bus route question's trace button.`, true);
  } finally {
    setMapLoadingTask(`route:${key}`, null, false);
    if (btn) btn.classList.remove('is-busy');
    renderSourceRows();
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

function fetchWithDeadline(url, options = {}, timeoutMs = 30000) {
  if (typeof AbortController === 'undefined') return fetch(url, options);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, Object.assign({}, options, { signal: ctrl.signal }))
    .finally(() => clearTimeout(timer));
}

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Retry quick gateway/server errors once, but do not turn one full network
   timeout into two. This catches the common 502/503/504 hiccup without making
   a genuinely unreachable service take twice as long to fail. */
async function fetchReliable(url, options = {}, timeoutMs = 30000, attempts = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    try {
      const res = await fetchWithDeadline(url, options, timeoutMs);
      if (res.ok || !TRANSIENT_HTTP.has(res.status) || attempt + 1 >= attempts) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if ((err && err.name === 'AbortError') || attempt + 1 >= attempts) throw err;
    }
    await sleep(700 * (attempt + 1));
  }
  throw lastErr || new Error('network request failed');
}

async function overpassJson(query, opts = {}) {
  const body = 'data=' + encodeURIComponent(query);
  const timeoutMs = Math.max(5000, Number(opts.timeoutMs) || 25000);
  const primary = (opts.urls || OVERPASS.slice(0, 2)).filter(Boolean);
  const problems = [];

  // Race independent mirrors instead of waiting for one overloaded server to
  // time out before even trying the next. Abort the remaining request once one
  // mirror returns a valid JSON result.
  const controllers = [];
  const raceMirror = (url) => new Promise((resolve, reject) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl) controllers.push(ctrl);
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeoutMs);
    fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      ...(ctrl ? { signal: ctrl.signal } : {})
    }).then(async (res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      resolve(JSON.parse(text));
    }).catch((e) => reject(e)).finally(() => clearTimeout(timer));
  });

  if (primary.length) {
    try {
      const result = await new Promise((resolve, reject) => {
        let pending = primary.length;
        primary.forEach((url) => raceMirror(url).then(resolve).catch((e) => {
          problems.push(e && e.name === 'AbortError' ? 'timeout' : (e.message || String(e)));
          if (--pending === 0) reject(new Error(problems.join(' / ')));
        }));
      });
      controllers.forEach((c) => { try { c.abort(); } catch (_) {} });
      return result;
    } catch (_) { /* one short fallback attempt below */ }
  }

  const fallbackUrl = opts.noFallback ? null : OVERPASS.find((u) => !primary.includes(u));
  if (fallbackUrl) {
    try {
      const res = await fetchWithDeadline(fallbackUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
      }, Math.min(timeoutMs, 20000));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return JSON.parse(await res.text());
    } catch (e) { problems.push(e && e.name === 'AbortError' ? 'timeout' : (e.message || String(e))); }
  }
  throw new Error(problems.join(' / ') || 'Overpass request failed');
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
  const dot = state === 'loading' ? '↻' : state === 'on' ? '◉' : state === 'off' ? '○' : '·';
  row.innerHTML = `
    <button class="row-btn src-main${state === 'on' ? ' is-on' : ''}${state === 'loading' ? ' is-loading' : ''}">
      <span class="row-title"><span class="src-dot">${dot}</span>${escapeHtml(label)}</span>
      <span class="row-meta">${escapeHtml(meta)}</span>
    </button>${onGear ? '<button class="icon-btn src-gear" title="Edit source">⚙</button>' : ''}`;
  const main = row.querySelector('.src-main');
  main.addEventListener('click', () => { if (state !== 'loading') onTap(main); });
  if (onGear) row.querySelector('.src-gear').addEventListener('click', onGear);
  return row;
}

function renderSourceRows() {
  const zbox = $('#zoneSources');
  zbox.innerHTML = '';
  Object.entries(S.sources).forEach(([key, src]) => {
    const rec = layerByKey('src:' + key);
    const state = zoneLoads.has(key) ? 'loading' : !rec ? 'idle' : rec.visible ? 'on' : 'off';
    const meta = state === 'loading' ? 'Loading boundaries…'
      : rec ? `${rec.geojson.features.length} zones${state === 'on' ? '' : ' · hidden'}`
      : (src.url ? (src.typeName || src.url) : 'not configured — tap ⚙');
    const row = sourceRow(src.name, meta, state,
      (btn) => { claimZoneLayerManually(key); return toggleSource(key, btn); },
      () => openSourceEditor(key));
    zbox.appendChild(row);
  });

  const rbox = $('#routeSources');
  rbox.innerHTML = '';
  Object.entries(ROUTE_SOURCES).forEach(([key, r]) => {
    const rec = layerByKey('route:' + key);
    const loading = mapLoadTasks.has(`route:${key}`);
    const state = loading ? 'loading' : !rec ? 'idle' : rec.visible ? 'on' : 'off';
    const amount = rec && rec.routeCount ? `${rec.routeCount} routes` : (rec ? `${rec.geojson.features.length} route lines` : '');
    const meta = loading ? 'Loading route geometry…' : rec ? `${amount}${state === 'on' ? '' : ' · hidden'}`
                     : (r.meta || r.table);
    rbox.appendChild(sourceRow(r.name, meta, state, (btn) => toggleRoute(key, btn), null));
  });

  const sbox = $('#stopSources');
  if (sbox) {
    sbox.innerHTML = '';
    const stops = S.transitStops;
    const state = stops.loading ? 'loading' : !stops.loaded ? 'idle' : stops.visible ? 'on' : 'off';
    const counts = stops.loading ? 'Loading named stops inside the game area…' : stops.loaded
      ? `${stops.busCount} bus · ${stops.trainCount} rail${state === 'on' ? '' : ' · hidden'}`
      : TRANSIT_STOP_SOURCE.meta;
    sbox.appendChild(sourceRow(TRANSIT_STOP_SOURCE.name, counts, state,
      (btn) => toggleTransitStops(btn), null));
  }
}

function renderWmsList() {
  const box = $('#wmsList');
  if (box) box.innerHTML = '';
}

/* Compatibility no-ops for old imported state. The inactive NT picture overlay
   has been removed; route data is loaded as usable vector geometry instead. */
function toggleWms() { return null; }
function addWms() { return null; }

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
  setMapLoadingTask('layer-catalogue', 'layer catalogue', true);
  try {
    browsed = await browseLayers(url);
    $('#srcBrowseBox').hidden = false;
    renderBrowseList();
    btn.textContent = `${browsed.length} layers — filter below`;
  } catch (err) {
    btn.textContent = original;
    toast('Could not list layers: ' + err.message, true);
  } finally {
    setMapLoadingTask('layer-catalogue', null, false);
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

/* Device location is display-only. It is deliberately kept outside S, is not
   serialised into game links and is never used to fill or log a question. */
function locationErrorMessage(err) {
  if (err && err.code === 1) return 'Location permission was denied. Tap the location button to try again.';
  if (err && err.code === 2) return 'Your location is temporarily unavailable.';
  if (err && err.code === 3) return 'Getting your location timed out.';
  return 'Could not get your location. Check location permission for this page.';
}

function showMe(coord, acc) {
  locationLayer.clearLayers();
  const accuracy = Math.max(5, Number(acc) || 40);
  const label = `Your location · accuracy ±${Math.round(accuracy)} m`;

  L.circle([coord[1], coord[0]], {
    pane: 'locationPane', radius: accuracy,
    color: '#138fbe', weight: 1.5, opacity: .85,
    fillColor: '#32b8ef', fillOpacity: .12,
    interactive: false
  }).addTo(locationLayer);

  L.circleMarker([coord[1], coord[0]], {
    pane: 'locationPane', radius: 9,
    color: '#ffffff', weight: 3,
    fillColor: '#168fd0', fillOpacity: 1,
    interactive: false
  }).bindTooltip(label, { permanent: false, direction: 'top', offset: [0, -9] })
    .addTo(locationLayer);

  L.circleMarker([coord[1], coord[0]], {
    pane: 'locationPane', radius: 3,
    stroke: false, fillColor: '#ffffff', fillOpacity: 1,
    interactive: false
  }).addTo(locationLayer);
}

function acceptDeviceLocation(pos, centerMap = false) {
  const coord = [pos.coords.longitude, pos.coords.latitude];
  deviceLocation = { coord, accuracy: pos.coords.accuracy, timestamp: pos.timestamp || Date.now() };
  showMe(coord, pos.coords.accuracy);
  const btn = $('#locateBtn');
  btn.classList.add('is-on');
  btn.title = 'Center map on my location';
  btn.setAttribute('aria-label', 'Center map on my location');
  locationErrorShown = false;
  if (centerMap) map.setView([coord[1], coord[0]], Math.max(map.getZoom(), 15));
}

function handleLocationError(err, userInitiated = false) {
  $('#locateBtn').classList.remove('is-on');
  if (userInitiated || !locationErrorShown) {
    toast(locationErrorMessage(err), true);
    locationErrorShown = true;
  }
  if (err && err.code === 1 && locationWatchId != null) {
    try { navigator.geolocation.clearWatch(locationWatchId); } catch (_) {}
    locationWatchId = null;
  }
}

function startLocationTracking({ center = false, userInitiated = false } = {}) {
  if (!navigator.geolocation) {
    if (userInitiated) toast('This browser has no location access.', true);
    return;
  }

  if (center) centerOnNextLocation = true;
  if (deviceLocation) {
    showMe(deviceLocation.coord, deviceLocation.accuracy);
    if (centerOnNextLocation) {
      map.setView([deviceLocation.coord[1], deviceLocation.coord[0]], Math.max(map.getZoom(), 15));
      centerOnNextLocation = false;
    }
  }

  if (locationWatchId != null) return;
  locationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const shouldCenter = centerOnNextLocation;
      centerOnNextLocation = false;
      acceptDeviceLocation(pos, shouldCenter);
    },
    (err) => handleLocationError(err, userInitiated),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

$('#locateBtn').addEventListener('click', () => {
  if (deviceLocation) {
    map.setView([deviceLocation.coord[1], deviceLocation.coord[0]], Math.max(map.getZoom(), 15));
  } else {
    startLocationTracking({ center: true, userInitiated: true });
  }
});

/* ---------- tabs & sheet ------------------------------------------------ */

function syncMobileNav(view) {
  const nav = $('#mobileNav');
  if (!nav) return;
  $$('.mobile-nav-btn', nav).forEach((b) => {
    const active = view === 'map' ? b.dataset.mobileView === 'map' : b.dataset.mobileTab === view;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function switchTab(name) {
  const previous = document.querySelector('.tabpane.is-active');
  const enteringAsk = name === 'ask' && (!previous || previous.dataset.pane !== 'ask');
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
  // A freshly entered Ask tab starts clean, but cancelling while already in Ask
  // deliberately leaves that question family open.
  if (enteringAsk && !activeTool) {
    questionDeckOpenKey = null;
    $$('.question-type').forEach((d) => { d.open = false; });
  }
  if ($('#panel').classList.contains('is-open')) syncMobileNav(name);
}
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

const panel = $('#panel');
function currentTabName() {
  const active = document.querySelector('.tabpane.is-active');
  return active ? active.dataset.pane : 'ask';
}
function openSheet(tabName) {
  if (tabName) switchTab(tabName);
  panel.classList.add('is-open');
  syncMobileNav(tabName || currentTabName());
}
function closeSheet() {
  panel.classList.remove('is-open');
  syncMobileNav('map');
}
const mobileNav = $('#mobileNav');
if (mobileNav) mobileNav.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.dataset.mobileView === 'map') closeSheet();
  else if (button.dataset.mobileTab) openSheet(button.dataset.mobileTab);
});
syncMobileNav('map');

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
    transitStopsVisible: !!S.transitStops.visible,
    sources: S.sources,
    cal: S.cal,
    renames: S.renames,
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
  renderSourceRows();
  renderCal();
  applyUnits();
  try { map.fitBounds(L.geoJSON(S.playArea).getBounds(), { padding: [24, 24] }); } catch (_) {}
  if (data.transitStopsVisible) toggleTransitStops();
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
// GitHub Pages is served over HTTPS, so this requests permission and keeps a
// display-only marker current without changing any question workflow.
startLocationTracking();
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
  parseOverpassRoutes, overpassQuery, fetchOverpass, fetchNtBusRoutes,
  extractRouteRefs, routeTokens, routeColor, routeStyle, annotateRouteGeoJson,
  prepareRouteDisplayGeoJson, routeLabelPoints, routeSummary, NT_BUS_TABLES, ROUTE_SOURCES,
  NT_ROUTE_WFS, ntBusLayerDefs, discoverNtBusTables, hasRouteRef,
  REQUIRED_BUS_ROUTE_SUPPLEMENTS, normaliseStopName, parseOverpassStops,
  matchSupplementStops, addMissingBusRouteSupplements, overpassBusStopQuery,
  overpassTransitStopsQuery, parseTransitStops, buildTransitStopLayer,
  toggleTransitStops, syncTransitStops, TRANSIT_STOP_SOURCE,
  areaCategory, AREA_STYLE,
  rammeCategory, zonekortCategory, categoryFor, RAMME_STYLE, RAMME_OTHER, RAMME_LEGEND, ZONEKORT_STYLE,
  renderSourceRows, renderLegend, gc2Urls,
  serialize, deserialize, b64encode, b64decode,
  constraintPolygon, halfPlane, voronoiCell, normaliseCoords, featureName,
  inferNameField, rankedNameFields, prepareSourceLabels,
  renderToolForm, selectTool, switchTab, questionPreview,
  startLocationTracking, showMe,
  previewConstraintFromDraft, syncQuestionPreview, constrainToRadius, previewDragHandle, solveCurrentArea,
  matchingAreaMode, matchingAreaAt, setMatchingAreaFromCoord, matchingPoiMode, MATCHING_POI_DEFS,
  OFFICIAL_AALBORG_LIBRARIES, AALBORG_LIBRARY_FALLBACK, AALBORG_LIBRARY_LOCATIONS,
  normalisePoiName, normaliseAuthorityPlaceName, resolveMatchingPoiFallbacks,
  matchingPoiOverpassQuery, activeGameBbox, parseMatchingPois, ensureMatchingPoiSource, releaseQuestionPoiLayer,
  matchingPoiNameAllowed, matchingPoiElementAllowed, overpassElementAreaM2, overpassElementRepresentativePoint, PARK_AUTO_MIN_AREA_M2, matchingPoiInsidePlayArea, filterMatchingPoisToPlayArea,
  matchingPoiFeatures, setMatchingPoiFromCoord, matchingPoiCell, parsePositiveDecimal,
  measuringBorderMode, zoneBorderLines, nearestZoneBorderDistanceM, zoneBorderBand, landmassRegions,
  ensureZoneSourceVisible, releaseQuestionZoneLayers, claimZoneLayerManually,
  questionAutoZoneSources, zoneLoads, mapLoadTasks, setMapLoadingTask, fetchTransitStopsJson,
  fmtDist, fmtArea, wfsUrl, gc2Url
};
