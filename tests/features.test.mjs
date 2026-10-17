// Drives every layer, every Game-tab control and every question card in the
// real app (jsdom), so a broken feature shows up by name. Each section starts
// from a clean log; the final check fails if a deck card has no test here.
import { bootApp, reporter } from './harness.mjs';

const { window, doc, $, click, errors } = bootApp();
const { check, finish } = reporter();

const ev = (code) => window.eval(code);
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const CENTRE = [57.0488, 9.9217];      // Midtbyen
const SOUTH = [57.03, 9.95];           // Øst Aalborg
const NORTH = [57.062, 9.915];         // Nørresundby
const MI = 1609.344;

const tap = ([lat, lng]) => ev(`HS.map.fire('click', { latlng: L.latLng(${lat}, ${lng}) })`);
const remainingKm2 = () => ev('(() => { const r = HS.solveCurrentArea(); return r.possible ? turf.area(r.possible) / 1e6 : 0; })()');
const constraintCount = () => ev('HS.S.constraints.length');
const clearLog = () => ev('HS.S.constraints = []; HS.recompute()');
const tab = (name) => click(doc.querySelector(`[data-tab="${name}"]`));
const formText = () => $('#toolForm').textContent.replace(/\s+/g, ' ');
const answerButtons = () => [...doc.querySelectorAll('#toolForm .seg button')];
const logButton = () => [...doc.querySelectorAll('#toolForm .solid-btn')].find((b) => /Log/i.test(b.textContent));
const canLog = () => !!logButton() && !logButton().disabled;
const cardButton = (type, card) => [...doc.querySelectorAll('[data-question-type][data-card]')]
  .find((b) => b.dataset.questionType === type && b.dataset.card === card);

function closeQuestion() {
  const back = $('#toolForm .question-back');
  if (!$('#toolForm').hidden && back) click(back);
}

const exercised = new Set();
async function openCard(type, card) {
  closeQuestion();
  tab('ask');
  exercised.add(`${type}|${card}`);
  const btn = cardButton(type, card);
  if (!btn) return false;
  click(btn);
  await wait();
  return !$('#toolForm').hidden;
}

/* Answer, log, and report what happened. */
async function answerAndLog(answerIndex = 0) {
  const answers = answerButtons();
  if (answers[answerIndex]) click(answers[answerIndex]);
  await wait();
  const before = { count: constraintCount(), km2: remainingKm2() };
  const ready = canLog();
  if (ready) click(logButton());
  await wait();
  return { ready, logged: constraintCount() - before.count, before: before.km2, after: remainingKm2() };
}

console.log('\n== boot ==');
check('app booted without errors', errors.length === 0, errors.join(' | '));
const PLAY_KM2 = remainingKm2();
check('play area is the official four-zone union', ev('HS.hasOfficialZonesPlayArea()') && PLAY_KM2 > 90 && PLAY_KM2 < 125, `${PLAY_KM2.toFixed(1)} km²`);

/* ======================= Layers tab ======================= */

console.log('\n== zone layers ==');
tab('layers');
const zoneRows = () => [...doc.querySelectorAll('#zoneSources .src-main')];
check('four zone layer rows', zoneRows().length === 4);
const ZONE_EXPECT = {
  zone1: { legend: /Byzone|Landzone/ },
  zone2: { legend: /Midtbyen/ },
  zone3: { legend: null },
  zone4: { legend: /Uden kommuneplanramme/ }
};
for (const [i, key] of ['zone1', 'zone2', 'zone3', 'zone4'].entries()) {
  click(zoneRows()[i]);
  await wait(60);
  const n = ev(`(HS.layerByKey('src:${key}') || {geojson:{features:[]}}).geojson.features.length`);
  const bundled = ev(`window.HS_ZONE_DATA.zones.${key}.features.length`);
  check(`${key} turns on from the bundled snapshot`, n > 0 && n === bundled, `${n} of ${bundled}`);
  check(`${key} is visible after turning on`, ev(`HS.layerByKey('src:${key}').visible`) === true);
  if (ZONE_EXPECT[key].legend) check(`${key} legend is shown`, ZONE_EXPECT[key].legend.test($('#legend').textContent));
  click(zoneRows()[i]);
  await wait();
  check(`${key} hides on a second tap`, ev(`HS.layerByKey('src:${key}').visible`) === false);
}
const borderWeight = (key) => ev(`(() => { let w = null;
  HS.layerByKey('src:${key}').layer.eachLayer((l) => { if (w === null) w = l.options.weight; }); return w; })()`);
check('Zone 3 borders are as thick as the bus route lines', borderWeight('zone3') === ev("HS.routeStyle('1').weight"),
      `${borderWeight('zone3')} vs ${ev("HS.routeStyle('1').weight")}`);
check('Zone 3 borders are always neon yellow', ev("HS.layerByKey('src:zone3').color") === '#ffe600');
check('the other zone levels keep thin borders', ['zone1', 'zone2', 'zone4'].every((k) => borderWeight(k) < 2));
check('zone layers never stack copies', ev("HS.S.layers.filter((l) => /^src:zone/.test(l.key)).length") === 4);

console.log('\n== zone source editor ==');
click(doc.querySelectorAll('#zoneSources .src-gear')[1]);
await wait();
check('⚙ opens the source editor for Zone 2', !$('#srcModal').hidden && /Zone 2/.test($('#srcTitle').textContent));
check('editor shows the KortInfo URL and layer', /kortinfo/.test($('#srcUrl').value) && $('#srcType').value === 'ugis:TL445984');
click($('#srcCancel'));
check('Cancel closes the editor', $('#srcModal').hidden);

console.log('\n== bus and train routes ==');
const routeRows = () => [...doc.querySelectorAll('#routeSources .src-main')];
const BUS = [['busBybus', 'bybus'], ['busRegional', 'regional'], ['busExpress', 'express'], ['busLocal', 'local']];
const busRefs = () => ev("(HS.layerByKey('route:bus') || {}).routeRefs || []");
for (const [i, [, cat]] of BUS.entries()) {
  const expected = ev(`HS.routeSummary(HS.bundledGtfsBusCategory('${cat}')).refs`);
  click(routeRows()[i]);
  await wait(40);
  const shown = busRefs();
  check(`${cat} routes turn on`, ev(`HS.BUS_CATEGORY_STATE.${cat}.visible`) && expected.length > 0 &&
        expected.every((ref) => shown.includes(ref)), `${expected.length} routes`);
  click(routeRows()[i]);
  await wait();
  check(`${cat} routes turn off again`, !ev(`HS.BUS_CATEGORY_STATE.${cat}.visible`) &&
        !expected.some((ref) => busRefs().includes(ref)));
}
click(routeRows()[0]); click(routeRows()[3]);
await wait(40);
check('two visible categories share one route layer',
      ev("HS.S.layers.filter((l) => l.key === 'route:bus').length") === 1 && busRefs().includes('38') && busRefs().includes('1'));
check('route number labels are drawn for visible buses', ev("(HS.layerByKey('route:bus').labelLayer || { getLayers: () => [] }).getLayers().length") > 0);
click(routeRows()[0]); click(routeRows()[3]);
await wait();
click(routeRows()[4]);
await wait(40);
check('train lines turn on from GTFS', ev("(HS.layerByKey('route:train') || {}).routeCount") >= 3);
check('train lines are clipped to the play area', ev(`(() => {
  const gj = HS.layerByKey('route:train').geojson;
  const area = turf.buffer(HS.S.playArea, 0.01, { units: 'kilometers' });
  return gj.features.every((f) => turf.coordAll(f).every((c) => turf.booleanPointInPolygon(c, area)));
})()`));
click(routeRows()[4]);
await wait();
check('train lines hide on a second tap', ev("HS.layerByKey('route:train').visible") === false);

console.log('\n== bus and train stops ==');
click($('#stopSources .src-main'));
await wait(60);
const stops = ev('({ loaded: HS.S.transitStops.loaded, visible: HS.S.transitStops.visible, bus: HS.S.transitStops.busCount, rail: HS.S.transitStops.trainCount })');
check('stops load from GTFS with bus and rail markers', stops.loaded && stops.visible && stops.bus > 100 && stops.rail >= 3, JSON.stringify(stops));
check('only stops inside the play area are shown', ev(`(() => {
  const gj = HS.S.transitStops.geojson;
  return gj.features.length > 0 && gj.features.every((f) => turf.booleanPointInPolygon(f, HS.S.playArea));
})()`));
click($('#stopSources .src-main'));
await wait();
check('stops hide on a second tap', ev('HS.S.transitStops.visible') === false);

console.log('\n== your own data ==');
{
  const input = $('#zoneFile');
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { navn: 'Imported' },
    geometry: { type: 'Polygon', coordinates: [[[9.90, 57.03], [9.94, 57.03], [9.94, 57.05], [9.90, 57.05], [9.90, 57.03]]] } }] };
  const file = new window.File([JSON.stringify(fc)], 'my-zone.geojson', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await wait(80);
  check('a GeoJSON file loads as a layer', ev("HS.S.layers.some((l) => l.name === 'my-zone')"));
  check('the loaded layer is listed', /my-zone/.test($('#zoneLayers').textContent));

  click($('#drawZoneBtn'));
  await wait();
  check('Draw a zone shows the drawing bar', !$('#drawHint').hidden);
  for (const p of [[57.05, 9.90], [57.05, 9.95], [57.03, 9.95]]) tap(p);
  click($('#drawFinish'));
  await wait();
  check('a drawn zone becomes a named layer', ev("HS.S.layers.some((l) => l.name === 'Test zone')"));
  ev("HS.S.layers.filter((l) => !l.key || !/^(src|route):/.test(l.key)).forEach((l) => HS.removeLayerByKey(l.key))");
}

/* ======================= Game tab ======================= */

console.log('\n== units ==');
tab('game');
click(doc.querySelector('#unitSeg [data-units="metric"]'));
await wait();
check('metric shows km²', $('#hudUnit').textContent === 'km²');
check('metric radar cards stay labelled by the deck', ev('HS.S.units') === 'metric');
click(doc.querySelector('#unitSeg [data-units="imperial"]'));
await wait();
check('imperial shows mi²', $('#hudUnit').textContent === 'mi²');

console.log('\n== basemaps ==');
const tileUrls = () => { const urls = []; ev('HS.map').eachLayer((l) => { if (l._url) urls.push(l._url); }); return urls; };
for (const [base, pattern] of [['streets', /openstreetmap/], ['satellite', /arcgisonline/], ['light', /openstreetmap/]]) {
  click(doc.querySelector(`#baseSeg [data-base="${base}"]`));
  await wait();
  const urls = tileUrls();
  check(`${base} basemap is the only tile layer`, urls.length === 1 && pattern.test(urls[0]), urls.join(' '));
}
check('Plain basemap is desaturated', ev("!!document.querySelector('.basemap-plain')"));
check('no basemap needs an API key', !tileUrls().some((u) => /cartocdn|apikey|access_token/.test(u)));

console.log('\n== fog ==');
$('#fogRange').value = '40';
$('#fogRange').dispatchEvent(new window.Event('input'));
check('fog slider sets the fog opacity', Math.abs(ev('HS.S.fogOpacity') - 0.4) < 1e-9);

console.log('\n== play area modes ==');
click(doc.querySelector('#playSeg [data-area="circle"]'));
await wait();
check('circle mode shows the radius field', !$('#radiusField').hidden && ev('HS.S.playAreaMeta.type') === 'circle');
$('#playRadius').value = '2';
click($('#applyRadius'));
await wait();
check('a 2-mile circle has the right area', Math.abs(remainingKm2() - Math.PI * (2 * MI / 1000) ** 2) / remainingKm2() < 0.01,
      `${remainingKm2().toFixed(2)} km²`);
{
  // The outline is bundled (kommune-outline.js); the old Dataforsyningen API is retired.
  const realFetch = window.fetch;
  const requested = [];
  window.fetch = async (url) => { requested.push(String(url)); throw new Error('offline'); };
  click(doc.querySelector('#playSeg [data-area="kommune"]'));
  await wait(40);
  window.fetch = realFetch;
  check('municipality mode uses the bundled Aalborg Kommune outline, offline',
        ev('HS.S.playAreaMeta.mode') === 'kommune' && requested.length === 0 && remainingKm2() > 1000 && remainingKm2() < 1300,
        `${remainingKm2().toFixed(0)} km², ${requested.length} requests`);
  check('the municipality includes Nibe and Hals', ev(`[[9.64, 56.982], [10.307, 56.9965]].every((c) => turf.booleanPointInPolygon(c, HS.S.playArea))`));
}
click(doc.querySelector('#playSeg [data-area="zones"]'));
await wait(60);
check('zones mode restores the four-zone play area', ev('HS.S.playAreaMeta.type') === 'zones' && Math.abs(remainingKm2() - PLAY_KM2) < 0.5);

console.log('\n== city ==');
{
  tab('game');
  const cityButtons = [...doc.querySelectorAll('#citySeg button')];
  check('the Game tab lists the cities, with Aalborg selected',
        cityButtons.some((b) => b.textContent === 'Aalborg' && b.classList.contains('is-active')),
        cityButtons.map((b) => b.textContent).join(', '));
  check('the page is titled for the city', /Aalborg/.test(doc.title) && $('#citySub').textContent === 'Aalborg seeker map',
        `${doc.title} / ${$('#citySub').textContent}`);
  check('the address names the city, so reloads and links stay in it',
        new URL(window.location.href).searchParams.get('city') === 'aalborg', window.location.href);
  check('the city fills in the zone, route and play-area texts',
        /KortInfo/.test($('#zoneSourcesHint').textContent) && $('#zoneDefaults').children.length === 4
        && /NT’s timetable/.test($('#routesHint').textContent)
        && $('#playSeg [data-area="kommune"]').textContent === 'Aalborg Kommune'
        && $('#playSeg [data-area="zones"]').textContent === 'The four play zones'
        && /Midtbyen, Nørresundby, Vest Aalborg and Øst Aalborg/.test($('#officialZoneStatus').textContent));
  click(cityButtons.find((b) => b.dataset.city === 'aalborg'));
  check('choosing the current city keeps the game', /Already playing in Aalborg/.test($('#toast').textContent));
  check('saved games record the city', ev('HS.serialize().city') === 'aalborg');
  check('a game from another city is refused with a clear message',
        ev(`HS.deserialize({ city: 'aarhus', constraints: [] })`) === false
        && /played in aarhus/i.test(ev(`HS.gameCityProblem({ city: 'aarhus' })`)));
  check('games saved before cities existed load as Aalborg games', ev('HS.gameCityProblem({ constraints: [] })') === null);
  ev("HS.S.constraints.push({ id: 'city1', type: 'radar', center: [9.9217, 57.0488], radiusM: 1609.344, answer: 'yes', active: true }); HS.recompute()");
  let asked = '';
  window.confirm = (text) => { asked = text; return false; };
  ev("HS.switchCity('aarhus')");
  window.confirm = () => true;
  check('switching city with answers asks first, and declining keeps them',
        /starts a new game/.test(asked) && constraintCount() === 1, asked);
  clearLog();
}

console.log('\n== share, export, import, reset ==');
{
  ev("HS.S.constraints.push({ id: 'share1', type: 'radar', center: [9.9217, 57.0488], radiusM: 1609.344, answer: 'yes', active: true }); HS.recompute()");
  let copied = null;
  window.navigator.clipboard.writeText = async (text) => { copied = text; };
  click($('#copyLink'));
  await wait();
  check('Copy game link copies a URL with the game state', /#g=/.test(copied || ''), (copied || '').slice(0, 60));

  let exported = null;
  window.URL.createObjectURL = (blob) => { exported = blob; return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  const realAnchorClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {};   // jsdom cannot follow downloads
  click($('#exportBtn'));
  window.HTMLAnchorElement.prototype.click = realAnchorClick;
  await wait();
  const blobText = (blob) => new Promise((resolve) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
  const json = exported ? JSON.parse(await blobText(exported)) : null;
  check('Export writes the game as JSON', json && json.constraints.length === 1 && json.constraints[0].type === 'radar');

  clearLog();
  const input = $('#importFile');
  const file = new window.File([JSON.stringify(json)], 'game.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await wait(80);
  check('Import restores the exported game', constraintCount() === 1 && ev('HS.S.constraints[0].type') === 'radar');

  clearLog();
  const other = new window.File([JSON.stringify(Object.assign({}, json, { city: 'aarhus' }))], 'aarhus.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [other], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  await wait(80);
  check('Import refuses a game from another city', constraintCount() === 0 && /played in aarhus/i.test($('#toast').textContent),
        $('#toast').textContent);

  click($('#resetBtn'));
  await wait();
  check('Reset clears every answer', constraintCount() === 0 && Math.abs(remainingKm2() - PLAY_KM2) < 0.5);
}

/* ======================= Question cards ======================= */

console.log('\n== Matching: places of interest ==');
// Several candidates: "Match" keeps only the nearest-place territory.
for (const card of ['Park', 'Museum', 'Movie theater', 'Hospital', 'Library']) {
  await openCard('matching', card);
  tap(CENTRE);
  await wait();
  const chosen = ev('HS.draft.matchName');
  const r = await answerAndLog(0);
  check(`Matching ${card}: nearest place picked and logged`, !!chosen && r.logged === 1, chosen);
  check(`Matching ${card}: Match keeps only the nearest territory`, r.after < r.before - 0.5, `${r.before.toFixed(1)} → ${r.after.toFixed(1)} km²`);
  clearLog();
}
// A single candidate: its territory is the whole area.
for (const card of ['Commercial airport', 'Amusement park', 'Zoo', 'Foreign consulate']) {
  await openCard('matching', card);
  tap(CENTRE);
  await wait();
  const r = await answerAndLog(0);
  check(`Matching ${card}: logged with its only candidate`, r.logged === 1 && Math.abs(r.after - r.before) < 0.5);
  clearLog();
}
// No candidates inside the play area.
for (const card of ['Aquarium', 'Golf course']) {
  await openCard('matching', card);
  tap(CENTRE);
  await wait();
  check(`Matching ${card}: no candidates, so nothing can be logged`, ev('HS.draft.poiCount') === 0 && !(await answerAndLog(0)).ready);
}

console.log('\n== Matching: zones and landmass ==');
for (const [card, key] of [['1st zone', 'zone1'], ['2nd zone', 'zone2'], ['3rd zone', 'zone3'], ['4th zone', 'zone4']]) {
  await openCard('matching', card);
  check(`Matching ${card}: opens its zone layer`, ev(`!!HS.layerByKey('src:${key}') && HS.layerByKey('src:${key}').visible`));
  tap(CENTRE);
  await wait();
  const zoneName = ev('HS.draft.matchName');
  const r = await answerAndLog(0);
  check(`Matching ${card}: Match keeps the zone you are in`, !!zoneName && r.logged === 1 && r.after < r.before, `${zoneName}: ${r.after.toFixed(1)} km²`);
  closeQuestion();
  check(`Matching ${card}: its temporary zone layer closes afterwards`, ev(`HS.layerByKey('src:${key}').visible`) === false);
  clearLog();
}
await openCard('matching', 'Landmass');
tap(NORTH);
await wait();
{
  const r = await answerAndLog(0);
  const lat = ev('(() => { const p = HS.solveCurrentArea().possible; return turf.centroid(p).geometry.coordinates[1]; })()');
  check('Matching Landmass: Match from Nørresundby keeps the north side', r.logged === 1 && lat > 57.05, lat.toFixed(4));
  clearLog();
}

console.log('\n== Matching: hand-placed candidates ==');
for (const card of ['Transit line', 'Station name length', 'Street / path', 'Mountain']) {
  await openCard('matching', card);
  tap(CENTRE); tap(SOUTH);
  await wait();
  const slots = [...doc.querySelectorAll('#toolForm .slot')];
  check(`Matching ${card}: two tapped candidates are listed`, slots.length === 2);
  if (slots[0]) click(slots[0]);
  await wait();
  const r = await answerAndLog(0);
  check(`Matching ${card}: choosing the nearest and Match logs a cut`, r.logged === 1 && r.after < r.before);
  clearLog();
}

console.log('\n== Measuring: places of interest ==');
for (const card of ['Commercial airport', 'Rail station', 'Park', 'Amusement park', 'Zoo', 'Museum', 'Movie theater', 'Hospital', 'Library', 'Foreign consulate']) {
  await openCard('measuring', card);
  tap(CENTRE);
  await wait();
  const target = ev('HS.draft.targetName');
  const r = await answerAndLog(0);
  check(`Measuring ${card}: nearest target found and Closer logged`, !!target && r.logged === 1 && r.after < r.before, target);
  clearLog();
}
for (const card of ['Aquarium', 'Golf course']) {
  await openCard('measuring', card);
  tap(CENTRE);
  await wait();
  check(`Measuring ${card}: no candidates, so nothing can be logged`, !(await answerAndLog(0)).ready);
}

console.log('\n== Measuring: borders, coastline and water ==');
const bandFill = {};
const readBandFill = () => ev(`(() => { let f = null; HS.previewShapeLayer.eachLayer((g) => {
  if (g.eachLayer) g.eachLayer((l) => { if (l.options.dashArray === '6 4') f = l.options.fillOpacity; }); }); return f; })()`);
for (const card of ['1st zone border', '2nd zone border']) {
  await openCard('measuring', card);
  await wait(60);
  tap(CENTRE);
  await wait();
  bandFill[card] = readBandFill();
  const distance = ev('HS.draft.borderDistanceM');
  const r = await answerAndLog(0);
  check(`Measuring ${card}: distance to the nearest border is measured`, distance > 0, `${Math.round(distance)} m`);
  check(`Measuring ${card}: Closer logs the border band`, r.logged === 1 && r.after < r.before);
  clearLog();
}
for (const card of ['Coastline', 'Body of water']) {
  await openCard('measuring', card);
  tap(CENTRE);
  await wait();
  bandFill[card] = readBandFill();
  const distance = ev('HS.draft.borderDistanceM');
  const r = await answerAndLog(1);   // Further
  check(`Measuring ${card}: distance found and Further logged`, distance > 0 && r.logged === 1 && r.after < r.before,
        `${ev('HS.draft.autoFeatureName') || ''} ${Math.round(distance)} m`);
  clearLog();
}

check('every distance band uses the shared 0.4 preview shading',
      Object.values(bandFill).length === 4 && Object.values(bandFill).every((f) => f === 0.4), JSON.stringify(bandFill));

console.log('\n== Measuring: hand-placed targets ==');
for (const card of ['High-speed train line', 'International border', 'Sea level', 'Mountain']) {
  await openCard('measuring', card);
  tap(CENTRE); tap(SOUTH);
  await wait();
  const placed = ev('Array.isArray(HS.draft.seeker) && Array.isArray(HS.draft.target)');
  const r = await answerAndLog(0);
  check(`Measuring ${card}: seeker and target taps log a cut`, placed && r.logged === 1 && r.after < r.before);
  clearLog();
}

console.log('\n== Thermometer ==');
for (const [card, miles] of [['½ mile', 0.5], ['3 miles', 3]]) {
  await openCard('thermometer', card);
  tap(CENTRE);
  await wait();
  const travel = ev('turf.distance(turf.point(HS.draft.a), turf.point(HS.draft.b), { units: "meters" })');
  check(`Thermometer ${card}: end point is placed at the card distance`, Math.abs(travel - miles * MI) < 1, `${travel.toFixed(2)} m`);
  const r = await answerAndLog(0);
  check(`Thermometer ${card}: Hotter logs without a manual confirmation`, r.ready && r.logged === 1);
  check(`Thermometer ${card}: the bisector cuts the area roughly in two`, r.after > r.before * 0.05 && r.after < r.before * 0.95,
        `${r.before.toFixed(1)} → ${r.after.toFixed(1)} km²`);
  clearLog();
}

console.log('\n== Radar ==');
await openCard('radar', '1 mile');
tap(CENTRE);
await wait();
check('the radar preview circle uses the shared 0.4 shading', ev(`(() => { let f = null;
  HS.previewShapeLayer.eachLayer((l) => { if (l instanceof L.Circle) f = l.options.fillOpacity; }); return f; })()`) === 0.4);
closeQuestion();
for (const [card, miles] of [['¼ mile', 0.25], ['½ mile', 0.5], ['1 mile', 1], ['3 miles', 3], ['5 miles', 5],
                             ['10 miles', 10], ['25 miles', 25], ['50 miles', 50], ['100 miles', 100]]) {
  await openCard('radar', card);
  tap(CENTRE);
  await wait();
  const r = await answerAndLog(0);   // Yes
  const radius = ev('HS.S.constraints[0] && HS.S.constraints[0].radiusM');
  check(`Radar ${card}: Yes logs a ${miles}-mile circle`, r.logged === 1 && Math.abs(radius - miles * MI) < 0.5);
  const expected = Math.min(Math.PI * (miles * MI / 1000) ** 2, PLAY_KM2);
  check(`Radar ${card}: remaining area is the circle within the play area`, r.after <= expected * 1.01 + 0.01);
  clearLog();
}
await openCard('radar', 'Custom');
{
  const input = $('#toolForm input[inputmode="decimal"]');
  input.value = '0,75';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  tap(CENTRE);
  await wait();
  const r = await answerAndLog(1);   // No
  check('Radar Custom: 0,75 is read as ¾ mile and No keeps the outside',
        r.logged === 1 && Math.abs(ev('HS.S.constraints[0].radiusM') - 0.75 * MI) < 0.5 && r.after < r.before && r.after > r.before * 0.8);
  clearLog();
}

console.log('\n== Photos and Tentacles ==');
for (const card of ['A tree', 'The sky', 'Tallest structure in your sightline', 'You', 'Widest street', 'Any building visible from the station']) {
  await openCard('photos', card);
  const r = await answerAndLog(0);
  check(`Photo "${card}" is logged without changing the map`, r.logged === 1 && Math.abs(r.after - r.before) < 1e-6);
  clearLog();
}
{
  const panel = [...doc.querySelectorAll('.question-type')].find((p) => /Tentacles/.test(p.textContent));
  check('Tentacles is shown but disabled', panel && panel.classList.contains('is-disabled') &&
        !panel.querySelector('[data-question-type][data-card]:not([disabled])'));
}

/* ======================= Log tab ======================= */

console.log('\n== log: mute and delete ==');
await openCard('radar', '1 mile');
tap(CENTRE);
await wait();
await answerAndLog(0);
closeQuestion();
tab('log');
const cut = remainingKm2();
check('the answer appears in the log', doc.querySelectorAll('#logList .log-item').length === 1 && /Radar/i.test($('#logList').textContent));
click($('#logList [data-act="toggle"]'));
await wait();
check('muting an answer restores the area', Math.abs(remainingKm2() - PLAY_KM2) < 0.5 && cut < PLAY_KM2 - 1);
click($('#logList [data-act="toggle"]'));
await wait();
check('unmuting applies it again', Math.abs(remainingKm2() - cut) < 0.01);
check('game state survives a URL round trip',
      ev('HS.deserialize(JSON.parse(JSON.stringify(HS.serialize()))) && HS.S.constraints.length === 1'));
click($('#logList [data-act="del"]'));
await wait();
check('deleting an answer removes it', constraintCount() === 0 && doc.querySelectorAll('#logList .log-item').length === 0);

/* ======================= geometry robustness ======================= */

console.log('\n== distances survive repeated vertices ==');
// Rounded or live WFS geometry can repeat a vertex; Turf's point-to-line
// distance throws on the resulting zero-length segment.
{
  const line = { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[9.90, 57.04], [9.93, 57.04], [9.93, 57.04], [9.96, 57.05]] } };
  const pond = { type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[9.93, 57.03], [9.94, 57.03], [9.94, 57.03], [9.94, 57.035], [9.93, 57.035], [9.93, 57.03]]] } };
  window.__line = line; window.__pond = pond;
  check('zone-border distance ignores a repeated vertex', ev(`(() => {
    const d = HS.nearestZoneBorderDistanceM([9.9217, 57.0488], { borderGeojson: { type: 'FeatureCollection', features: [window.__line] } });
    return Number.isFinite(d) && d > 0;
  })()`));
  check('water distance ignores a repeated vertex', ev('Number.isFinite(HS.distanceToFeatureM([9.9217, 57.0488], window.__pond))'));
}

/* ======================= coverage guard ======================= */

console.log('\n== every card is covered ==');
const deck = [...doc.querySelectorAll('[data-question-type][data-card]')]
  .filter((b) => b.dataset.questionType !== 'tentacles')
  .map((b) => `${b.dataset.questionType}|${b.dataset.card}`);
const untested = deck.filter((c) => !exercised.has(c));
check('every enabled question card has a test in features.test.mjs', untested.length === 0, untested.join(', '));
check('nothing threw during the whole run', errors.length === 0, errors.join(' | '));

finish();
