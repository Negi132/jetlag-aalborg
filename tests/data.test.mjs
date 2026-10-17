// Checks the city settings, the generated data bundles and the files
// index.html loads without booting the app, so a broken weekly refresh fails
// CI before it is deployed.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import * as turf from '@turf/turf';
import { ROOT, reporter } from './harness.mjs';

const { check, finish } = reporter();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// boot.js lists the cities and the data files every city has.
const bootSandbox = { window: { HS_BOOT_MANUAL: true }, location: { search: '' }, localStorage: { getItem: () => null } };
vm.createContext(bootSandbox);
vm.runInContext(read('boot.js'), bootSandbox, { filename: 'boot.js' });
const BOOT = bootSandbox.window.HS_BOOT;
const DATA_FILES = BOOT.data.map((f) => f.split('?')[0].split('/').pop());

// The bundle checks below are for Aalborg; the city checks run for every city.
const CITY_ID = 'aalborg';
const DIR = `cities/${CITY_ID}/`;
const CITY = JSON.parse(read(`${DIR}city.json`));
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of DATA_FILES) {
  vm.runInContext(read(DIR + file), sandbox, { filename: DIR + file });
}
const W = sandbox.window;

const playFc = JSON.parse(read(`${DIR}play_area.geojson`));
const play = playFc.features.length === 1 ? playFc.features[0] : turf.union(turf.featureCollection(playFc.features));
const playBbox = turf.bbox(play);
const km2 = (f) => turf.area(f) / 1e6;
const REGION = [9.4, 56.7, 10.6, 57.4];   // generous box around Aalborg

function allPositions(geometry, out = []) {
  if (!geometry) return out;
  if (geometry.type === 'GeometryCollection') { geometry.geometries.forEach((g) => allPositions(g, out)); return out; }
  const walk = (c) => (typeof c[0] === 'number' ? out.push(c) : c.forEach(walk));
  walk(geometry.coordinates);
  return out;
}
const inRegion = ([x, y]) => Number.isFinite(x) && Number.isFinite(y) &&
  x >= REGION[0] && x <= REGION[2] && y >= REGION[1] && y <= REGION[3];
const featuresInRegion = (features) => features.every((f) => allPositions(f.geometry).every(inRegion));
const lineCoords = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
const hasRepeatedVertex = (g) => lineCoords(g).some((l) => l.some((c, i) => i && c[0] === l[i - 1][0] && c[1] === l[i - 1][1]));
const intersectsPlay = (f) => { try { return turf.booleanIntersects(f, play); } catch (_) { return false; } };

console.log('\n== index.html assets ==');
{
  const html = read('index.html');
  const local = [...html.matchAll(/(?:src|href)="(?!https?:)([^"]+)"/g)].map((m) => m[1]);
  check('index.html loads boot.js and the stylesheet',
        local.some((r) => r.startsWith('boot.js?')) && local.some((r) => r.startsWith('styles.css?')), local.join(', '));
  const bootRef = local.find((r) => r.startsWith('boot.js?')) || '';
  check('boot.js?v= in index.html matches the BUILD in boot.js', bootRef === `boot.js?v=${BOOT.build}`, `${bootRef} vs ${BOOT.build}`);
  for (const ref of local) {
    const file = ref.split('?')[0];
    check(`${file} exists`, fs.existsSync(path.join(ROOT, file)));
    check(`${file} has a ?v= cache-busting version`, /\?v=[\w-]+$/.test(ref), ref);
  }
  const cdn = [...html.matchAll(/(?:src|href)="(https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)[^"]+)"/g)].map((m) => m[1]);
  check('CDN libraries are pinned to exact versions', cdn.length === 4 && cdn.every((u) => /@\d+\.\d+\.\d+\//.test(u)), cdn.join(' '));
}

console.log('\n== cities ==');
const POI_KEYS = ['airport', 'park', 'amusement', 'zoo', 'aquarium', 'golf', 'museum', 'cinema', 'hospital', 'library', 'consulate'];
for (const { id, name } of BOOT.cities) {
  const dir = `cities/${id}/`;
  let city = null;
  try { city = JSON.parse(read(`${dir}city.json`)); } catch (e) { check(`${dir}city.json is valid JSON`, false, e.message); continue; }
  check(`${id}: city.json has its own id and name`, city.id === id && city.name === name, `${city.id} / ${city.name}`);
  check(`${id}: map centre is inside the search bounds`, (() => {
    const [lat, lng] = city.map.center;
    const [w, s, e, n] = city.bounds.search;
    return lng > w && lng < e && lat > s && lat < n;
  })());
  for (const key of ['search', 'playArea', 'stops', 'pois']) {
    const b = city.bounds[key];
    check(`${id}: bounds.${key} is [west, south, east, north]`, Array.isArray(b) && b.length === 4 && b[0] < b[2] && b[1] < b[3], JSON.stringify(b));
  }
  check(`${id}: all four zone levels are configured`,
        ['zone1', 'zone2', 'zone3', 'zone4'].every((k) => city.zones.sources[k] && city.zones.sources[k].typeName && city.zones.sources[k].name));
  const areas = city.zones.areas || [];
  check(`${id}: play areas have unique numbers, names, colours and lower-case aliases`, areas.length > 0 &&
        new Set(areas.map((a) => a.area)).size === areas.length &&
        areas.every((a) => a.name && /^#[0-9a-f]{6}$/i.test(a.color) && a.aliases.length && a.aliases.every((x) => x === x.toLowerCase())));
  const cats = city.transit.busCategories || [];
  check(`${id}: bus categories have unique keys and route lists`, cats.length > 0 &&
        new Set(cats.map((c) => c.key)).size === cats.length && cats.every((c) => c.name && Array.isArray(c.routes)));
  check(`${id}: bus inference rules are valid and name real categories`, (city.transit.inferRules || []).every((r) => {
    try { new RegExp(r.pattern); } catch (_) { return false; }
    return r.category === null || cats.some((c) => c.key === r.category);
  }));
  check(`${id}: POI settings cover exactly the known cards`,
        JSON.stringify(Object.keys(city.pois.categories).sort()) === JSON.stringify(POI_KEYS.slice().sort()));
  const places = Object.values(city.pois.categories).flatMap((c) => c.places || []);
  const [pw, ps, pe, pn] = city.bounds.pois;
  check(`${id}: every curated place has coordinates inside bounds.pois`, places.every((p) => p.name && Array.isArray(p.coordinates) &&
        p.coordinates[0] > pw && p.coordinates[0] < pe && p.coordinates[1] > ps && p.coordinates[1] < pn));
  if (city.landmass) {
    check(`${id}: landmass north areas are real play areas`, city.landmass.northAreas.every((n) => areas.some((a) => a.area === n)));
  }
  for (const file of [...DATA_FILES, 'play_area.geojson']) check(`${id}: ${file} exists`, fs.existsSync(path.join(ROOT, dir, file)));
}
check('the default city is one of the cities', BOOT.cities.some((c) => c.id === BOOT.defaultCity));

console.log(`\n== play area (${DIR}play_area.geojson) ==`);
{
  const names = playFc.features.map((f) => f.properties.navn).sort();
  const expected = CITY.zones.areas.map((a) => a.name).sort();
  check('play area has the city\'s Zone 2 areas', names.join('|') === expected.join('|'), names.join('|'));
  check('play area is about 107 km²', km2(play) > 90 && km2(play) < 125, `${km2(play).toFixed(1)} km²`);
}

console.log('\n== zone2-fallback.js ==');
{
  const fb = W.HS_ZONE2_FALLBACK;
  check('fallback has four features numbered 1–4', fb && fb.features.map((f) => f.properties.area).sort().join() === '1,2,3,4');
  check('fallback names match the play areas',
        fb.features.map((f) => f.properties.navn).sort().join('|') === '1. Midtbyen|2. Nørresundby|3. Vest Aalborg|4. Øst Aalborg');
  const union = turf.union(turf.featureCollection(fb.features));
  check('fallback covers the same ground as the play area (±2%)',
        Math.abs(km2(union) - km2(play)) / km2(play) < 0.02, `${km2(union).toFixed(1)} vs ${km2(play).toFixed(1)} km²`);
  check('fallback polygons are valid', fb.features.every((f) => turf.booleanValid(f)));
}

console.log('\n== kommune-outline.js ==');
{
  const k = W.HS_KOMMUNE_OUTLINE;
  check('municipality outline is a valid polygon', k && /Polygon$/.test(k.geometry.type) && turf.booleanValid(k));
  check('municipality outline is about 1,130 km²', km2(k) > 1050 && km2(k) < 1250, `${km2(k).toFixed(0)} km²`);
  // OSM's municipal boundary follows the coast, so only the Limfjord water of
  // the play area (~13 km²) may lie outside it.
  const inside = km2(turf.intersect(turf.featureCollection([play, k])));
  check('municipality outline covers the play area apart from the fjord', inside > km2(play) * 0.85, `${inside.toFixed(1)} of ${km2(play).toFixed(1)} km²`);
}

console.log('\n== bus-routes.js ==');
{
  const b = W.HS_GTFS_BUS_ROUTES;
  const cats = ['bybus', 'regional', 'express', 'local'];
  check('bundle has features and GTFS metadata', b && b.features.length > 0 && !!b.metadata.feed_date, b && b.metadata.feed_date);
  check('every route has a known category and a route number',
        b.features.every((f) => cats.includes(f.properties.category) && !!f.properties.ref));
  check('every route is a line with at least two points',
        b.features.every((f) => /LineString$/.test(f.geometry.type) && lineCoords(f.geometry).every((l) => l.length >= 2)));
  check('all route coordinates are around Aalborg', featuresInRegion(b.features));
  const outside = b.features.filter((f) => !intersectsPlay(f)).map((f) => f.properties.ref);
  check('every bundled route reaches the play area', outside.length === 0, outside.join(','));
  for (const cat of cats) {
    const refs = new Set(b.features.filter((f) => f.properties.category === cat).map((f) => f.properties.ref));
    check(`${cat} has routes`, refs.size > 0, `${refs.size}`);
    check(`${cat} metadata lists the same routes as its features`,
          [...refs].sort().join() === [...(b.metadata.categories[cat] || [])].sort().join());
  }
  const owners = new Map();
  for (const f of b.features) owners.set(f.properties.ref, new Set([...(owners.get(f.properties.ref) || []), f.properties.category]));
  check('no route number is in two categories', [...owners.values()].every((s) => s.size === 1));
}

console.log('\n== transit-data.js ==');
{
  const t = W.HS_GTFS_TRANSIT;
  check('bundle is marked ready', t && t.ready === true);
  check('feed validity dates are present', /^\d{4}-\d{2}-\d{2}$/.test(t.feedStart) && /^\d{4}-\d{2}-\d{2}$/.test(t.feedEnd), `${t.feedStart} → ${t.feedEnd}`);
  const trains = t.trainRoutes.features;
  check('at least three train services', trains.length >= 3, `${trains.length}`);
  check('every train service is a line that reaches the play area',
        trains.every((f) => /LineString$/.test(f.geometry.type) && intersectsPlay(f)));
  const stops = t.stops.features;
  check('stops are only bus or train', stops.every((f) => ['bus', 'train'].includes(f.properties.__stopKind)));
  check('every stop is a named point', stops.every((f) => f.geometry.type === 'Point' && !!String(f.properties.name || '').trim()));
  const pad = [playBbox[0] - 0.03, playBbox[1] - 0.025, playBbox[2] + 0.03, playBbox[3] + 0.025];
  check('stops lie in the padded play-area envelope', stops.every(({ geometry: { coordinates: [x, y] } }) =>
    x >= pad[0] && x <= pad[2] && y >= pad[1] && y <= pad[3]));
  const insideBus = stops.filter((f) => f.properties.__stopKind === 'bus' && turf.booleanPointInPolygon(f, play)).length;
  const insideRail = stops.filter((f) => f.properties.__stopKind === 'train' && turf.booleanPointInPolygon(f, play)).length;
  check('plenty of bus stops inside the play area', insideBus >= 150, `${insideBus}`);
  check('at least three rail stations inside the play area', insideRail >= 3, `${insideRail}`);
  const keys = stops.map((f) => `${f.properties.__stopKind}|${f.properties.name}|${f.geometry.coordinates}`);
  check('no duplicated stop markers', new Set(keys).size === keys.length);
}

console.log('\n== poi-data.js ==');
{
  const p = W.HS_POI_DATA;
  const expected = ['airport', 'park', 'amusement', 'zoo', 'aquarium', 'golf', 'museum', 'cinema', 'hospital', 'library', 'consulate'];
  check('bundle is marked ready', p && p.ready === true);
  check('all eleven POI categories are present', expected.every((k) => p.categories[k]), Object.keys(p.categories).join(','));
  const all = expected.flatMap((k) => p.categories[k].features);
  check('every POI is a named point', all.every((f) => f.geometry.type === 'Point' && !!String(f.properties.name || '').trim()));
  check('all POI coordinates are around Aalborg', featuresInRegion(all));
  const inPlay = (k) => p.categories[k].features.filter((f) => turf.booleanPointInPolygon(f, play)).length;
  for (const [k, min] of [['park', 10], ['museum', 3], ['hospital', 2], ['library', 4], ['cinema', 1], ['airport', 1], ['zoo', 1]]) {
    check(`at least ${min} ${k} POI(s) inside the play area`, inPlay(k) >= min, `${inPlay(k)}`);
  }
}

console.log('\n== hydro-data.js ==');
{
  const h = W.HS_HYDRO_DATA;
  check('bundle is ready and current (v6+)', h && h.ready === true && h.version >= 6, h && `v${h.version}`);
  const north = h.coastlines.north.features, south = h.coastlines.south.features;
  check('both Limfjord banks have coastline lines', north.length > 0 && south.length > 0 &&
        [...north, ...south].every((f) => /LineString$/.test(f.geometry.type)));
  const meanLat = (fs) => { const ps = fs.flatMap((f) => allPositions(f.geometry)); return ps.reduce((a, c) => a + c[1], 0) / ps.length; };
  check('the north bank lies north of the south bank', meanLat(north) > meanLat(south),
        `${meanLat(north).toFixed(4)} vs ${meanLat(south).toFixed(4)}`);
  const water = h.waterBodies.features;
  check('there are body-of-water targets', water.length > 10, `${water.length}`);
  check('every water body has a stable id, marker and bounds',
        water.every((f) => f.properties.__waterId && Array.isArray(f.properties.__markerCoord) && Array.isArray(f.properties.__bbox)));
  check('water ids are unique', new Set(water.map((f) => f.properties.__waterId)).size === water.length);
  check('the pre-unioned water-distance geometry is present', h.waterDistance && h.waterDistance.features.length > 0);
  check('all hydro coordinates are around Aalborg', featuresInRegion([...north, ...south, ...water]));
}

console.log('\n== zone-data.js ==');
{
  const z = W.HS_ZONE_DATA;
  check('zone snapshot is ready and render-prepared (v3)', z && z.ready === true && z.version >= 3 && z.displayPrepared === true,
        z && `ready=${z.ready} v${z.version}`);
  for (const key of ['zone1', 'zone2', 'zone3', 'zone4']) {
    const fs = (z.zones[key] || {}).features || [];
    check(`${key} has display polygons`, fs.length > 0 && fs.every((f) => /Polygon$/.test(f.geometry.type)), `${fs.length}`);
    check(`${key} stays within the play-area bounds`, fs.every((f) => {
      const [x0, y0, x1, y1] = turf.bbox(f);
      return x0 >= playBbox[0] - 1e-4 && y0 >= playBbox[1] - 1e-4 && x1 <= playBbox[2] + 1e-4 && y1 <= playBbox[3] + 1e-4;
    }));
    const borders = (z.borders[key] || {}).features || [];
    check(`${key} has real border lines for Measuring`, borders.length > 0 && borders.every((f) => /LineString$/.test(f.geometry.type)), `${borders.length}`);
    const repeated = borders.filter((f) => hasRepeatedVertex(f.geometry)).length;
    check(`${key} border lines have no zero-length segments`, repeated === 0, `${repeated} with repeats`);
  }
  const z2 = z.zones.zone2.features;
  check('zone 2 has the four play areas', z2.map((f) => f.properties.area).sort().join() === '1,2,3,4');
  const z2Area = km2(turf.union(turf.featureCollection(z2)));
  check('zone 2 matches the play area (±1%)', Math.abs(z2Area - km2(play)) / km2(play) < 0.01, `${z2Area.toFixed(1)} km²`);
  check('zone 1 includes the implicit landzone remainder', z.zones.zone1.features.some((f) => f.properties.__zone1Other));
  check('zone 4 includes the X · Uden kommuneplanramme area', z.zones.zone4.features.some((f) => f.properties.__zone4Other));
  check('zone 3 districts have names', z.zones.zone3.features.every((f) => Object.values(f.properties).some((v) => typeof v === 'string' && v.trim())));
}

finish();
