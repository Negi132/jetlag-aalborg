import { JSDOM } from 'jsdom';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dir = new URL('./', import.meta.url).pathname;
const html = fs.readFileSync(dir + 'index.html', 'utf8')
  // strip the CDN tags; we inject local copies below
  .replace(/<script src="https:[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link rel="stylesheet" href="https:[^"]*"[^>]*>/g, '');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://example.github.io/hideseek/'
});
const { window } = dom;
window.addEventListener('error', e => errors.push('window error: ' + e.message));

// jsdom lacks these; Leaflet + app need them
window.SVGElement.prototype.createSVGRect = function () {};
window.HTMLCanvasElement.prototype.getContext = () => null;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 1200, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 800, configurable: true });
window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
window.alert = () => {}; window.confirm = () => true; window.prompt = () => 'Test zone';
window.navigator.clipboard = { writeText: async () => {} };
window.innerWidth = 1200;

const run = (code, label) => {
  try { window.eval(code); } catch (e) { errors.push(`${label}: ${e.message}\n${(e.stack||'').split('\n')[1]||''}`); }
};

// Find a bundle in node_modules, walking up from this file.
function bundle(rel) {
  let d = dir;
  for (let i = 0; i < 6; i++) {
    const p = d + 'node_modules/' + rel;
    if (fs.existsSync(p)) return p;
    d = d.replace(/[^/]+\/$/, '');
  }
  throw new Error(`Missing ${rel} — run: npm install @turf/turf@7.2.0 leaflet@1.9.4 proj4@2.11.0 jsdom`);
}
run(fs.readFileSync(bundle('leaflet/dist/leaflet-src.js'), 'utf8'), 'leaflet');
run(fs.readFileSync(bundle('@turf/turf/turf.min.js'), 'utf8'), 'turf');
run(fs.readFileSync(bundle('proj4/dist/proj4.js'), 'utf8'), 'proj4');
run(fs.readFileSync(dir + 'data.js', 'utf8'), 'data.js');
run(fs.readFileSync(dir + 'app.js', 'utf8'), 'app.js');

const doc = window.document;
const $ = s => doc.querySelector(s);
const click = el => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log('\n== boot ==');
check('no errors while loading', errors.length === 0, errors.join(' | '));
check('map container got a Leaflet class', /leaflet-container/.test($('#map').className));
const HULL = parseFloat($('#hudArea').textContent);
check('play area defaults to the zone hull, not a circle', window.eval("HS.S.playAreaMeta.type") === 'zones',
      window.eval("HS.S.playAreaMeta.type"));
check('play area is the four zones and non-trivial', HULL > 20 && HULL < 400, `${HULL} mi²`);
check('HUD unit is mi²', $('#hudUnit').textContent === 'mi²');
check('picker shows the zones mode', /is-active/.test(doc.querySelector('#playSeg [data-area="zones"]').className));
check('HUD shows 100% remaining', $('#hudPct').textContent === '100%', `got "${$('#hudPct').textContent}"`);

console.log('\n== tabs ==');
click(doc.querySelector('[data-tab="layers"]'));
check('layers pane opens', doc.querySelector('[data-pane="layers"]').classList.contains('is-active'));
click(doc.querySelector('[data-tab="ask"]'));
check('ask pane returns', doc.querySelector('[data-pane="ask"]').classList.contains('is-active'));

console.log('\n== radar flow ==');
click(doc.querySelector('[data-tool="radar"]'));
check('radar form renders', !$('#toolForm').hidden && /Radar/.test($('#toolForm').textContent));
check('radar offers the deck\u2019s imperial radii', doc.querySelectorAll('#toolForm .chip').length === 9, doc.querySelector('#toolForm .chip').textContent + ' \u2026 ' + [...doc.querySelectorAll('#toolForm .chip')].pop().textContent);
check('Log answer starts disabled', doc.querySelector('#toolForm .solid-btn').disabled === true);

// pick the centre slot, then simulate a map tap
click(doc.querySelector('#toolForm .slot'));
check('slot enters picking state', doc.querySelector('#toolForm .slot').classList.contains('is-picking'));
window.eval("HS.map.fire('click', { latlng: L.latLng(57.0488, 9.9217) })");
check('slot captured the coordinate', /57\.04/.test(doc.querySelector('#toolForm .slot-coord').textContent),
      `"${doc.querySelector('#toolForm .slot-coord').textContent}"`);

// 2 km preset (index 4 = 100,250,500,1000,2000)
click(doc.querySelectorAll('#toolForm .chip')[5]); // ½ mi
click(doc.querySelectorAll('#toolForm .seg button')[0]); // Yes
check('Log answer now enabled', doc.querySelector('#toolForm .solid-btn').disabled === false);
click(doc.querySelector('#toolForm .solid-btn'));

check('constraint stored', window.eval('HS.S.constraints.length') === 1);
check('log entry rendered', doc.querySelectorAll('.log-item').length === 1);
check('log shows the imperial label', /Within \u00bd mi/.test($('#logList').textContent), `"${$('#logList').textContent.trim().replace(/\s+/g,' ').slice(0,60)}"`);
// the \u00bd-mile circle gets clipped by the play-area edge, so \u2264 \u03c0r\u00b2
check('radar circle clipped to the play area', (() => { const v = parseFloat($('#hudArea').textContent);
      return v > 0.3 && v <= Math.PI*0.25 + 0.01; })(), `got "${$('#hudArea').textContent}" vs \u03c0r\u00b2=${(Math.PI*0.25).toFixed(3)}`);
check('HUD percentage shrank to a sliver', /^(0\.\d+|[0-3])%$/.test($('#hudPct').textContent), `got "${$('#hudPct').textContent}"`);
check('view switched to the Log tab', doc.querySelector('[data-pane="log"]').classList.contains('is-active'));

console.log('\n== url state round-trip ==');
await new Promise(r => setTimeout(r, 700)); // saveToUrl is debounced
const hash = window.location.hash;
check('game state written to the URL', hash.startsWith('#g='), `${hash.length} chars`);
const restored = window.eval('HS.deserialize(JSON.parse(HS.b64decode(location.hash.slice(3))))');
check('state decodes back', restored === true);
check('constraint survived the round trip', Math.abs(window.eval('HS.S.constraints[0].radiusM') - 804.672) < 0.01);

console.log('\n== mute / delete ==');
click(doc.querySelector('.log-item [data-act="toggle"]'));
check('muting restores the full area', Math.abs(parseFloat($('#hudArea').textContent) - HULL) < 0.5);
check('muted row is dimmed', doc.querySelector('.log-item').classList.contains('is-off'));
click(doc.querySelector('.log-item [data-act="toggle"]'));
check('unmuting re-applies it', parseFloat($('#hudArea').textContent) < HULL*0.2);
click(doc.querySelector('.log-item [data-act="del"]'));
check('delete removes the entry', doc.querySelectorAll('.log-item').length === 0);
check('empty-state message returns', !$('#logEmpty').hidden);

console.log('\n== thermometer flow ==');
click(doc.querySelector('[data-tab="ask"]'));
click(doc.querySelector('[data-tool="thermometer"]'));
click(doc.querySelectorAll('#toolForm .slot')[0]);
window.eval("HS.map.fire('click', { latlng: L.latLng(57.0488, 9.9217) })");
click(doc.querySelectorAll('#toolForm .slot')[1]);
window.eval("HS.map.fire('click', { latlng: L.latLng(57.0488, 9.9550) })");
check('travel distance computed', /travelled 1\.2\d mi/.test($('#toolForm').textContent),
      `"${($('#toolForm').textContent.match(/You travelled [^.]*/)||[''])[0]}"`);
click(doc.querySelectorAll('#toolForm .seg button')[0]); // Hotter
click(doc.querySelector('#toolForm .solid-btn'));
check('thermometer logged', window.eval("HS.S.constraints[0].type") === 'thermometer');

check('thermometer removed roughly half the map', (() => { const v = parseFloat($('#hudArea').textContent);
      return v > HULL*0.25 && v < HULL*0.75; })(), `got ${$('#hudArea').textContent} of ${HULL} mi2`);

console.log('\n== free-shape drawing ==');
click(doc.querySelector('[data-tab="ask"]'));
click(doc.querySelector('[data-tool="area"]'));
click(doc.querySelector('#toolForm .ghost-btn'));
check('draw hint bar appears', !$('#drawHint').hidden);
check('Finish is disabled with no points', $('#drawFinish').disabled);
for (const [la, ln] of [[57.06, 9.90], [57.06, 9.96], [57.03, 9.96]]) {
  window.eval(`HS.map.fire('click', { latlng: L.latLng(${la}, ${ln}) })`);
}
check('Finish enables at 3 points', !$('#drawFinish').disabled);
click($('#drawUndo'));
check('undo disables Finish again', $('#drawFinish').disabled);
window.eval("HS.map.fire('click', { latlng: L.latLng(57.03, 9.96) })");
click($('#drawFinish'));
check('hint bar closes after finishing', $('#drawHint').hidden);
check('shape captured into the draft', window.eval('!!HS.draft.geometry'));

console.log('\n== zone layer ==');
click(doc.querySelector('[data-tab="layers"]'));
window.eval(`HS.addLayer('Test districts', {type:'FeatureCollection',features:[
  {type:'Feature',properties:{navn:'Vestbyen'},geometry:{type:'Polygon',coordinates:[[[9.88,57.03],[9.92,57.03],[9.92,57.06],[9.88,57.06],[9.88,57.03]]]}},
  {type:'Feature',properties:{navn:'Oestbyen'},geometry:{type:'Polygon',coordinates:[[[9.92,57.03],[9.97,57.03],[9.97,57.06],[9.92,57.06],[9.92,57.03]]]}}]})`);
check('hand-loaded layer listed', doc.querySelectorAll('#zoneLayers .zone-row').length === 1);
check('zone count shown', /2/.test(doc.querySelector('.zone-count').textContent));
click(doc.querySelector('[data-tab="ask"]'));
click(doc.querySelector('[data-tool="zone"]'));
check('zone dropdown populated', doc.querySelectorAll('#toolForm select option').length === 3);
check('zone names appear', /Vestbyen/.test($('#toolForm').textContent));

console.log('\n== reset ==');
click(doc.querySelector('[data-tab="game"]'));
click($('#resetBtn'));
check('all answers cleared', window.eval('HS.S.constraints.length') === 0);
check('HUD back to full area', Math.abs(parseFloat($('#hudArea').textContent) - HULL) < 0.5);


console.log('\n== units ==');
check('fmtDist small values in feet', window.eval("HS.fmtDist(150)") === '490 ft', window.eval("HS.fmtDist(150)"));
check('fmtDist switches to miles', window.eval("HS.fmtDist(1609.344)") === '1 mi', window.eval("HS.fmtDist(1609.344)"));
check('quarter mile reads as miles', window.eval("HS.fmtDist(402.336)") === '0.25 mi', window.eval("HS.fmtDist(402.336)"));
check('900 ft still reads as feet', window.eval("HS.fmtDist(900*0.3048)") === '900 ft', window.eval("HS.fmtDist(900*0.3048)"));
check('radar presets are imperial', window.eval("HS.RADAR_PRESETS.map(p=>p.label).join(',')") === '250 ft,500 ft,1000 ft,1500 ft,\u00bc mi,\u00bd mi,1 mi,3 mi,5 mi',
      window.eval("HS.RADAR_PRESETS.map(p=>p.label).join(',')"));
check('1 mi preset is exactly 1609.344 m', window.eval("HS.RADAR_PRESETS[6].m") === 1609.344);
// switch to metric and back
click(doc.querySelector('#unitSeg [data-units="metric"]'));
check('metric switch changes the unit label', $('#hudUnit').textContent === 'km\u00b2', $('#hudUnit').textContent);
check('metric distances in metres', window.eval("HS.fmtDist(150)") === '150 m', window.eval("HS.fmtDist(150)"));
check('play-radius unit follows', $('#playRadiusUnit').textContent === 'km');
click(doc.querySelector('#unitSeg [data-units="imperial"]'));
check('back to imperial', $('#hudUnit').textContent === 'mi\u00b2' && $('#playRadiusUnit').textContent === 'mi');

console.log('\n== transit route question ==');
click(doc.querySelector('[data-tab="layers"]'));
window.eval(`HS.addLayer('Test bus lines', {type:'FeatureCollection',features:[
  {type:'Feature',properties:{linjenavn:'Line 2'},geometry:{type:'LineString',coordinates:[[9.88,57.048],[9.96,57.048]]}}]}, {kind:'line'})`);
check('line layer loaded as lines', window.eval("HS.S.layers.filter(l=>l.kind==='line').length") === 1);
check('line layer counted with ln suffix', /ln/.test($('#zoneLayers').textContent));
click(doc.querySelector('[data-tab="ask"]'));
click(doc.querySelector('[data-tool="transit"]'));
check('transit form renders', /Transit line/.test($('#toolForm').textContent));
check('buffer defaults to a quarter mile', Math.abs(window.eval('HS.draft.bufferM') - 402.336) < 0.01);
// select the route programmatically the same way a map tap would
window.eval(`HS.draft.lineGeom = HS.S.layers.find(l=>l.kind==='line').geojson.features[0].geometry; HS.draft.lineName='Line 2';`);
window.eval('HS.renderToolForm()');
click(doc.querySelectorAll('#toolForm .seg button')[0]); // Same route
click(doc.querySelector('#toolForm .solid-btn'));
check('transit constraint logged', window.eval("HS.S.constraints[0].type") === 'transit');
check('log names the route', /Line 2/.test($('#logList').textContent), $('#logList').textContent.trim().replace(/\s+/g,' ').slice(0,70));
const corridor = parseFloat($('#hudArea').textContent);
check('corridor is a thin sliver of the map', corridor > 0.5 && corridor < 8, `${corridor} mi\u00b2`);

console.log('\n== coordinate normalisation ==');
// lat/lng swapped (Denmark: lat 57 would appear first)
const swapped = window.eval(`(()=>{const g={type:'Feature',properties:{},geometry:{type:'Point',coordinates:[57.05,9.92]}};HS.normaliseCoords(g);return g.geometry.coordinates.join(',');})()`);
check('lat/lng swap detected and fixed', swapped === '9.92,57.05', swapped);
// already correct order must be left alone
const ok = window.eval(`(()=>{const g={type:'Feature',properties:{},geometry:{type:'Point',coordinates:[9.92,57.05]}};HS.normaliseCoords(g);return g.geometry.coordinates.join(',');})()`);
check('correct order left untouched', ok === '9.92,57.05', ok);
// UTM32 metres -> WGS84
const utm = window.eval(`(()=>{const g={type:'Feature',properties:{},geometry:{type:'Point',coordinates:[554000,6323000]}};HS.normaliseCoords(g);return g.geometry.coordinates;})()`);
check('UTM32 reprojected into Aalborg', utm[0] > 9.5 && utm[0] < 10.5 && utm[1] > 56.5 && utm[1] < 57.5,
      `${utm[0].toFixed(4)}, ${utm[1].toFixed(4)}`);

console.log('\n== name guessing across unknown schemas ==');
const nm = k => window.eval(`HS.featureName({properties:${k}})`);
check('finds navn', nm("{navn:'Vestbyen'}") === 'Vestbyen');
check('finds linjenavn', nm("{linjenavn:'2'}") === '2');
check('finds zonestatus', nm("{zonestatus:'Byzone'}") === 'Byzone');
check('falls back to any string', nm("{weird_field:'Something'}") === 'Something');
check('never returns blank', nm("{}") === 'Unnamed');

console.log('\n== request URLs ==');
const wfs = window.eval("HS.wfsUrl({url:'https://geoserver.plandata.dk/geoserver/wfs',typeName:'pdk:x',cql:'komnr=851'})");
check('WFS asks for GeoJSON', /outputFormat=application%2Fjson/.test(wfs));
check('WFS pins WGS84', /srsName=EPSG%3A4326/.test(wfs));
check('WFS passes the CQL filter', /CQL_FILTER=komnr%3D851/.test(wfs));
const gc2 = window.eval("HS.gc2Url('rutekortweb.ntmap_bybus_murl')");
check('GC2 SQL url built', /api\/v2\/sql\/nt\?q=SELECT/.test(gc2) && /srs=4326/.test(gc2), gc2.slice(0,72)+'…');


console.log('\n== zone 1: byzone red / landzone green ==');
const zk = k => window.eval(`(HS.zonekortCategory(${k})||{}).color`);
check('byzone is red', zk("{zonestatus:'Byzone'}") === '#e0554f', zk("{zonestatus:'Byzone'}"));
check('landzone is green', zk("{zonestatus:'Landzone'}") === '#4fae5a', zk("{zonestatus:'Landzone'}"));
check('summer-house zone distinct', zk("{zonestatus:'Sommerhusområde'}") === '#e8a33d');
check('numeric zone code 1 = byzone', zk("{zone:1}") === '#e0554f');
check('numeric zone code 2 = landzone', zk("{zone:2}") === '#4fae5a');
check('anything not city/summer defaults to green landzone', zk("{foo:'bar'}") === '#4fae5a', zk("{foo:'bar'}"));
check('explicit landzone also green', zk("{zonestatus:'Landzone'}") === '#4fae5a');

console.log('\n== zone 4: the municipality legend ==');
const rc = k => window.eval(`(HS.rammeCategory(${k})||{}).key`);
const rcol = k => window.eval(`(HS.rammeCategory(${k})||{}).color`);
check('Boligområde -> B', rc("{anvendelsesnavn:'Boligområde'}") === 'B');
check('B is salmon', rcol("{anvendelsesnavn:'Boligområde'}") === '#f0a184');
check('Centerområde -> C', rc("{anvendelsesnavn:'Centerområde'}") === 'C');
check('Blandet bolig beats Bolig', rc("{anvendelsesnavn:'Blandet bolig- og erhvervsområde'}") === 'D',
      rc("{anvendelsesnavn:'Blandet bolig- og erhvervsområde'}"));
check('Råstofområde -> G', rc("{anvendelsesnavn:'Råstofområde'}") === 'G');
check('Let erhvervsområde -> H', rc("{anvendelsesnavn:'Let erhvervsområde'}") === 'H');
check('Industriområde -> I', rc("{anvendelsesnavn:'Industriområde'}") === 'I');
check('Landsby -> L', rc("{anvendelsesnavn:'Landsby'}") === 'L');
check('Særlige virksomheder -> M', rc("{anvendelsesnavn:'Område til særlige virksomheder'}") === 'M');
check('Offentlig service -> O', rc("{anvendelsesnavn:'Område til offentlig service'}") === 'O');
check('Rekreativt område -> R', rc("{anvendelsesnavn:'Rekreativt område'}") === 'R');
check('Sommerhusområde -> S', rc("{anvendelsesnavn:'Sommerhusområde'}") === 'S');
check('Tekniske anlæg -> T', rc("{anvendelsesnavn:'Område til tekniske anlæg'}") === 'T');
check('all twelve legend entries present', window.eval('HS.RAMME_STYLE.length') === 12);
// fallback: letter buried in an Aalborg plan number
check('plan number 1.1.C2 -> C', rc("{plannr:'1.1.C2'}") === 'C', rc("{plannr:'1.1.C2'}"));
check('plan number 3.2.B1 -> B', rc("{plannr:'3.2.B1'}") === 'B');
check('single-letter anvendelse field', rc("{anvendelse:'I'}") === 'I');
check('unclassifiable returns null', window.eval("HS.rammeCategory({plannr:'zzz'})") === null);

console.log('\n== toggling, not stacking ==');
click(doc.querySelector('[data-tab="layers"]'));
const zoneGJ = `{type:'FeatureCollection',features:[
  {type:'Feature',properties:{zonestatus:'Byzone'},geometry:{type:'Polygon',coordinates:[[[9.88,57.03],[9.92,57.03],[9.92,57.06],[9.88,57.06],[9.88,57.03]]]}},
  {type:'Feature',properties:{zonestatus:'Landzone'},geometry:{type:'Polygon',coordinates:[[[9.92,57.03],[9.97,57.03],[9.97,57.06],[9.92,57.06],[9.92,57.03]]]}}]}`;
window.eval(`HS.addLayer('Zone 1 test', ${zoneGJ}, {key:'src:zone1', style:'zonekort'})`);
check('keyed layer loaded once', window.eval("HS.S.layers.filter(l=>l.key==='src:zone1').length") === 1);
// loading the same key again must replace, not append
window.eval(`HS.addLayer('Zone 1 test', ${zoneGJ}, {key:'src:zone1', style:'zonekort'})`);
check('reloading the same key does not stack', window.eval("HS.S.layers.filter(l=>l.key==='src:zone1').length") === 1);
check('keyed layer hidden from the hand-loaded list',
      window.eval("HS.S.layers.filter(l=>!l.key).length") === window.eval("document.querySelectorAll('#zoneLayers .zone-row').length"));
const rec = () => window.eval("HS.layerByKey('src:zone1')");
check('layer starts visible', window.eval("HS.layerByKey('src:zone1').visible") === true);
window.eval("HS.setLayerVisible(HS.layerByKey('src:zone1'), false)");
check('toggle off works', window.eval("HS.layerByKey('src:zone1').visible") === false);
check('map no longer holds it', window.eval("HS.map.hasLayer(HS.layerByKey('src:zone1').layer)") === false);
window.eval("HS.setLayerVisible(HS.layerByKey('src:zone1'), true)");
check('toggle back on works', window.eval("HS.map.hasLayer(HS.layerByKey('src:zone1').layer)") === true);
check('zone row shows the on state', /is-on/.test($('#zoneSources').innerHTML));

console.log('\n== legend ==');
check('legend appears for a styled layer', !$('#legend').hidden);
check('legend names byzone', /Byzone/.test($('#legend').textContent));
check('legend names landzone', /Landzone/.test($('#legend').textContent));
check('legend omits categories not in the data', !/Sommerhus/.test($('#legend').textContent),
      $('#legend').textContent.replace(/\s+/g,' ').slice(0,80));
window.eval("HS.setLayerVisible(HS.layerByKey('src:zone1'), false)");
check('legend hides with the layer', $('#legend').hidden);

console.log('\n== play area from a zone layer ==');
window.eval("HS.setLayerVisible(HS.layerByKey('src:zone1'), true)");
window.eval("HS.setZonesPlayArea(false)");
const paBefore = window.eval("turf.area(HS.S.playArea)");
// zone 1 carries a landzone backdrop spanning the whole play area, so use a
// plain layer here — otherwise its union is the play area by construction.
window.eval(`HS.addLayer('Plain test', {type:'FeatureCollection',features:[
  {type:'Feature',properties:{navn:'A'},geometry:{type:'Polygon',coordinates:[[[9.90,57.03],[9.94,57.03],[9.94,57.06],[9.90,57.06],[9.90,57.03]]]}}]}, {key:'plain:test'})`);
window.eval("HS.usePlayAreaFromLayer(HS.layerByKey('plain:test'))");
const paAfter = window.eval("turf.area(HS.S.playArea)");
check('play area shrank to the merged zones', paAfter < paBefore && paAfter > 0,
      `${(paBefore/1e6).toFixed(1)} -> ${(paAfter/1e6).toFixed(1)} km2`);
check('merged play area is stored as custom', window.eval("HS.S.playAreaMeta.type") === 'custom');
check('and the zones picker can put it back', (() => {
  window.eval("HS.setPlayMode('zones')");
  return Math.abs(window.eval("turf.area(HS.S.playArea)") - paBefore) < 1000;
})());
check('touching polygons merge into one ring', window.eval(`(() => {
  const a = turf.polygon([[[9.88,57.03],[9.92,57.03],[9.92,57.06],[9.88,57.06],[9.88,57.03]]]);
  const b = turf.polygon([[[9.92,57.03],[9.97,57.03],[9.97,57.06],[9.92,57.06],[9.92,57.03]]]);
  const u = HS.unionAll([a,b]);
  return u.geometry.type === 'Polygon' && u.geometry.coordinates.length === 1;
})()`));

check('union area equals the sum of the parts', window.eval(`(() => {
  const a = turf.polygon([[[9.88,57.03],[9.92,57.03],[9.92,57.06],[9.88,57.06],[9.88,57.03]]]);
  const b = turf.polygon([[[9.92,57.03],[9.97,57.03],[9.97,57.06],[9.92,57.06],[9.92,57.03]]]);
  return Math.abs(turf.area(HS.unionAll([a,b])) - (turf.area(a)+turf.area(b))) < 2000;
})()`));

console.log('\n== WFS capability browser ==');
const caps = `<?xml version="1.0"?>
<WFS_Capabilities xmlns="http://www.opengis.net/wfs" version="1.1.0">
 <FeatureTypeList>
  <FeatureType>
    <Name>pdk:theme_pdk_zonekort_v</Name>
    <Title>Zonekort</Title>
    <Abstract>Byzone og landzone</Abstract>
  </FeatureType>
  <FeatureType>
    <Name>pdk:theme_pdk_kommuneplanramme_alle_vedtaget_v</Name>
    <Title>Kommuneplanrammer</Title>
  </FeatureType>
  <FeatureType>
    <Name>aalborg:bydele</Name>
    <Title>By- og bydele</Title>
  </FeatureType>
 </FeatureTypeList>
</WFS_Capabilities>`;
window.__caps = caps;
const parsed = window.eval("HS.parseWfsCapabilities(window.__caps)");
check('parses every FeatureType', parsed.length === 3, `got ${parsed.length}`);
check('reads the typeName', parsed[0].name === 'pdk:theme_pdk_zonekort_v', parsed[0].name);
check('reads the human title', parsed[2].title === 'By- og bydele', parsed[2].title);
check('falls back to name when no title', window.eval(
  "HS.parseWfsCapabilities('<WFS_Capabilities><FeatureTypeList><FeatureType><Name>x:y</Name></FeatureType></FeatureTypeList></WFS_Capabilities>')[0].title") === 'x:y');
check('namespaced XML also parses', window.eval(
  "HS.parseWfsCapabilities('<wfs:WFS_Capabilities xmlns:wfs=\\'http://www.opengis.net/wfs\\'><wfs:FeatureTypeList><wfs:FeatureType><wfs:Name>ns:layer</wfs:Name></wfs:FeatureType></wfs:FeatureTypeList></wfs:WFS_Capabilities>')[0].name") === 'ns:layer');
check('garbage yields an empty list', window.eval("HS.parseWfsCapabilities('not xml at all').length") === 0);

console.log('\n== route endpoints have a fallback ==');
const urls = window.eval("JSON.stringify(HS.gc2Urls('rutekortweb.ntmap_bybus_murl'))");
const u = JSON.parse(urls);
check('two strategies offered', u.length === 2);
check('first is the GC2 SQL API', /api\/v2\/sql\/nt/.test(u[0]));
check('second is the GC2 WFS', /\/wfs\/nt\/rutekortweb\/4326/.test(u[1]), u[1].slice(0,60));
check('WFS strategy strips the schema from typeName', /typeName=ntmap_bybus_murl/.test(u[1]));


console.log('\n== Overpass route parsing ==');
window.__op = {
  elements: [
    { type: 'relation', id: 1,
      tags: { type: 'route', route: 'bus', ref: '2', name: 'Vejgaard - Universitetet', operator: 'NT' },
      members: [
        { type: 'node', ref: 90, role: 'stop', lat: 57.05, lon: 9.92 },
        { type: 'way', ref: 10, role: 'platform', geometry: [{lat:57.05,lon:9.939},{lat:57.05,lon:9.938}] },
        { type: 'way', ref: 11, role: '', geometry: [{lat:57.045,lon:9.947},{lat:57.040,lon:9.960}] },
        { type: 'way', ref: 12, role: '', geometry: [{lat:57.040,lon:9.960},{lat:57.016,lon:9.978}] }
      ] },
    { type: 'relation', id: 2,
      tags: { type: 'route', route: 'bus', ref: '2', name: 'Vejgaard - Universitetet' },
      members: [ { type: 'way', ref: 13, role: '', geometry: [{lat:57.016,lon:9.978},{lat:57.045,lon:9.947}] } ] },
    { type: 'relation', id: 3,
      tags: { type: 'route', route: 'bus', ref: '11', name: 'Hasseris' },
      members: [ { type: 'way', ref: 14, role: '', geometry: [{lat:57.039,lon:9.885},{lat:57.047,lon:9.921}] } ] },
    { type: 'relation', id: 4, tags: { route: 'bus', ref: '99' },
      members: [ { type: 'way', ref: 15, role: 'stop', geometry: [{lat:57.0,lon:9.9}] } ] }
  ]
};
const parsedR = window.eval("HS.parseOverpassRoutes(window.__op)");
check('one feature per line, directions folded together', parsedR.features.length === 2,
      `got ${parsedR.features.length}: ${parsedR.features.map(f=>f.properties.navn).join(' | ')}`);
check('platform geometry dropped', !JSON.stringify(parsedR).includes('9.939'));
check('label combines ref and name', parsedR.features[0].properties.navn === '2 \u00b7 Vejgaard - Universitetet',
      parsedR.features[0].properties.navn);
check('both directions merged into one MultiLineString',
      parsedR.features[0].geometry.type === 'MultiLineString' &&
      parsedR.features[0].geometry.coordinates.length === 3,
      `${parsedR.features[0].geometry.type}, ${parsedR.features[0].geometry.coordinates.length} parts`);
check('relation with no usable geometry skipped', !parsedR.features.some(f => f.properties.ref === '99'));
check('sorted by line number', parsedR.features.map(f=>f.properties.ref).join(',') === '2,11',
      parsedR.features.map(f=>f.properties.ref).join(','));
check('operator carried through', parsedR.features[0].properties.operator === 'NT');
const q = window.eval("HS.overpassQuery('[\"route\"=\"bus\"]')");
check('query asks for geometry', /out geom;/.test(q));
check('query bounded to greater Aalborg', /relation\(56\.94,9\.7,57\.18,10\.25\)/.test(q), q.slice(0,64));
check('query filters to bus route relations', /\["type"="route"\]\["route"="bus"\]/.test(q));

console.log('\n== routes load, second Overpass mirror is the fallback ==');
window.__tried = [];
window.fetch = async (url) => {
  window.__tried.push(url);
  if (url.includes('overpass-api.de')) return { ok: false, status: 504, text: async () => 'gateway' };
  return { ok: true, status: 200, text: async () => JSON.stringify(window.__op) };
};
click(doc.querySelector('[data-tab="layers"]'));
click(doc.querySelectorAll('#routeSources .src-main')[0]);
await new Promise(r => setTimeout(r, 80));
check('both Overpass mirrors were tried', window.__tried.length === 2, `tried ${window.__tried.length}`);
check('route layer ended up loaded', window.eval("!!HS.layerByKey('route:bus')"));
check('loaded as tappable lines', window.eval("(HS.layerByKey('route:bus')||{}).kind") === 'line');
check('route row now shows on', /is-on/.test($('#routeSources').innerHTML));
check('status reports the count', /2 route lines on/.test($('#zoneStatus').textContent),
      $('#zoneStatus').textContent.slice(0, 60));
const callsBefore = window.__tried.length;
click(doc.querySelectorAll('#routeSources .src-main')[0]);
await new Promise(r => setTimeout(r, 30));
check('second tap only toggles, no refetch', window.__tried.length === callsBefore);
check('route hidden after second tap', window.eval("HS.layerByKey('route:bus').visible") === false);
click(doc.querySelectorAll('#routeSources .src-main')[0]);
await new Promise(r => setTimeout(r, 30));
check('third tap shows it again', window.eval("HS.layerByKey('route:bus').visible") === true);

console.log('\n== traced zone 2 and zone 3 ==');
click(doc.querySelector('[data-tab="layers"]'));
const zoneRows = () => doc.querySelectorAll('#zoneSources .src-main');
click(zoneRows()[2]);                        // zone 3
await new Promise(r => setTimeout(r, 40));
check('zone 3 builds with no network', window.eval("!!HS.layerByKey('src:zone3')"));
check('one polygon per traced district',
      window.eval("HS.layerByKey('src:zone3').geojson.features.length") === window.eval("window.ZONE3_PX.length"),
      `${window.eval("HS.layerByKey('src:zone3').geojson.features.length")} of ${window.eval("window.ZONE3_PX.length")}`);
check('districts are real outlines, not boxes', window.eval(`(() => {
  const fs = HS.layerByKey('src:zone3').geojson.features;
  const v = fs.map(f => f.geometry.coordinates[0].length);
  return Math.min(...v) > 8 && v.reduce((a,b)=>a+b,0) > 600;
})()`), `${window.eval("HS.layerByKey('src:zone3').geojson.features.reduce((a,f)=>a+f.geometry.coordinates[0].length,0)")} vertices total`);
check('districts carry names read off the screenshot', window.eval(`(() => {
  const ns = HS.layerByKey('src:zone3').geojson.features.map(f=>f.properties.navn);
  return ns.includes('Hasseris') && ns.includes('Vejgård') && ns.includes('Nørresundby Midtby');
})()`), window.eval("HS.layerByKey('src:zone3').geojson.features.map(f=>f.properties.navn).slice(0,4).join(', ')"));
check('no district name is duplicated', window.eval(`(() => {
  const ns = HS.layerByKey('src:zone3').geojson.features.map(f=>f.properties.navn);
  return new Set(ns).size === ns.length;
})()`));
check('Skalborg is not called Dall Villaby', window.eval(`(() => {
  const fs = HS.layerByKey('src:zone3').geojson.features;
  const sk = fs.find(f=>f.properties.navn==='Skalborg');
  const dv = fs.find(f=>f.properties.navn==='Dall Villaby');
  if (!sk || !dv) return false;
  // Dall Villaby lies south of Skalborg on the map
  return turf.centroid(dv).geometry.coordinates[1] < turf.centroid(sk).geometry.coordinates[1];
})()`));

click(zoneRows()[1]);                        // zone 2
await new Promise(r => setTimeout(r, 40));
check('zone 2 has exactly four areas',
      window.eval("HS.layerByKey('src:zone2').geojson.features.length") === 4);
check('the four are named and numbered', window.eval(
      "HS.layerByKey('src:zone2').geojson.features.map(f=>f.properties.navn).sort().join('|')")
      === '1. Midtbyen|2. Nørresundby|3. Vest Aalborg|4. Øst Aalborg',
      window.eval("HS.layerByKey('src:zone2').geojson.features.map(f=>f.properties.navn).sort().join('|')"));
check('Midtbyen is the smallest zone', window.eval(`(() => {
  const fs = HS.layerByKey('src:zone2').geojson.features;
  const byArea = fs.slice().sort((a,b)=>turf.area(a)-turf.area(b));
  return byArea[0].properties.navn === '1. Midtbyen';
})()`));
check('Nørresundby is the northernmost', window.eval(`(() => {
  const fs = HS.layerByKey('src:zone2').geojson.features;
  const north = fs.slice().sort((a,b)=>turf.centroid(b).geometry.coordinates[1]-turf.centroid(a).geometry.coordinates[1]);
  return north[0].properties.navn === '2. Nørresundby';
})()`));
check('Vest Aalborg is west of Øst Aalborg', window.eval(`(() => {
  const fs = HS.layerByKey('src:zone2').geojson.features;
  const g = n => turf.centroid(fs.find(f=>f.properties.navn.includes(n))).geometry.coordinates[0];
  return g('Vest') < g('Øst');
})()`));
check('each area gets its own colour', window.eval("new Set(HS.AREA_STYLE().map(c=>c.color)).size") === 4);
check('area legend lists all four', /Nørresundby/.test($('#legend').textContent) &&
      /Vest Aalborg/.test($('#legend').textContent));

console.log('\n== play area follows the four zones ==');
window.eval("HS.setPlayMode('zones')");
check('play area is the union of zone 2, not a hull', window.eval(`(() => {
  const u = turf.area(HS.unionAll(HS.layerByKey('src:zone2').geojson.features));
  return Math.abs(turf.area(HS.S.playArea) - u) / u < 0.01;
})()`));
check('and it is genuinely concave, unlike a hull', window.eval(`(() => {
  const pa = HS.S.playArea;
  const hull = turf.convex(turf.explode(pa));
  return turf.area(hull) > turf.area(pa) * 1.12;   // hull noticeably bigger
})()`), `play ${(window.eval("turf.area(HS.S.playArea)")/1e6).toFixed(0)} km2`);

console.log('\n== calibration ==');
const before = window.eval("JSON.stringify(turf.centroid(HS.layerByKey('src:zone2').geojson.features[0]).geometry.coordinates)");
window.eval("HS.S.cal = Object.assign({}, HS.S.cal, {lat: 57.0480, lng: 9.9187}); HS.applyCal(true)");
const after = window.eval("JSON.stringify(turf.centroid(HS.layerByKey('src:zone2').geojson.features[0]).geometry.coordinates)");
check('pinning the centre moves the zones', before !== after);
check('the pin lands where asked', window.eval(`(() => {
  const a = HS.anchorPx(), gr = HS.georef();
  const [lng, lat] = HS.pxToLngLat(a[0], a[1], gr);
  return Math.abs(lng - 9.9187) < 1e-6 && Math.abs(lat - 57.0480) < 1e-6;
})()`));
const span1 = window.eval(`(() => { const b = turf.bbox(HS.buildAreaZones());
  return turf.distance(turf.point([b[0],b[1]]), turf.point([b[2],b[1]])); })()`);
window.eval("HS.S.cal = Object.assign({}, HS.S.cal, {mul: 1.5}); HS.applyCal(true)");
const span2 = window.eval(`(() => { const b = turf.bbox(HS.buildAreaZones());
  return turf.distance(turf.point([b[0],b[1]]), turf.point([b[2],b[1]])); })()`);
check('scaling widens the zones proportionally', Math.abs(span2 / span1 - 1.5) < 0.02,
      `${span1.toFixed(1)} km -> ${span2.toFixed(1)} km`);
check('scaling keeps the centre pin fixed', window.eval(`(() => {
  const a = HS.anchorPx(), gr = HS.georef();
  const [lng, lat] = HS.pxToLngLat(a[0], a[1], gr);
  return Math.abs(lng - 9.9187) < 1e-6 && Math.abs(lat - 57.0480) < 1e-6;
})()`));
check('play area followed the calibration', window.eval(`(() => {
  const u = turf.area(HS.unionAll(HS.buildAreaZones().features));
  return Math.abs(turf.area(HS.S.playArea) - u) / u < 0.01;
})()`));
window.eval("HS.S.cal = HS.defaultCal(); HS.applyCal(true)");
check('reset returns to the shipped estimate', Math.abs(window.eval(`(() => {
  const b = turf.bbox(HS.buildAreaZones());
  return turf.distance(turf.point([b[0],b[1]]), turf.point([b[2],b[1]])); })()`) - span1) < 0.01);
check('calibration survives a save/load round trip', window.eval(`(() => {
  HS.S.cal = {lat: 57.05, lng: 9.93, mul: 1.2};
  const blob = JSON.parse(JSON.stringify(HS.serialize()));
  HS.S.cal = HS.defaultCal();
  HS.deserialize(blob);
  return Math.abs(HS.S.cal.mul - 1.2) < 1e-9 && Math.abs(HS.S.cal.lng - 9.93) < 1e-9;
})()`));

console.log('\n== zone toggles stay reversible ==');
click(zoneRows()[2]);
check('zone 3 toggles off', window.eval("HS.layerByKey('src:zone3').visible") === false);
click(zoneRows()[2]);
check('zone 3 toggles back on', window.eval("HS.layerByKey('src:zone3').visible") === true);
check('still only one zone 3 layer', window.eval("HS.S.layers.filter(l=>l.key==='src:zone3').length") === 1);

console.log('\n== zone 1 landzone backdrop ==');
window.eval(`HS.addLayer('Zone 1 backdrop test', {type:'FeatureCollection',features:[
  {type:'Feature',properties:{zonestatus:'Byzone'},geometry:{type:'Polygon',coordinates:[[[9.90,57.04],[9.94,57.04],[9.94,57.06],[9.90,57.06],[9.90,57.04]]]}}]},
  {key:'src:zone1b', style:'zonekort'})`);
const zb = () => window.eval("HS.layerByKey('src:zone1b').geojson.features");
check('a landzone polygon was added alongside the byzone', zb().length === 2, `${zb().length} features`);
check('landzone is drawn first so byzone sits on top',
      zb()[0].properties.zonestatus === 'Landzone', zb()[0].properties.zonestatus);
check('landzone fills the rest of the play area', window.eval(`(() => {
  const fs = HS.layerByKey('src:zone1b').geojson.features;
  const total = turf.area(HS.unionAll(fs));
  return Math.abs(total - turf.area(HS.S.playArea)) / turf.area(HS.S.playArea) < 0.02;
})()`));
check('landzone renders green', window.eval(
      "(HS.categoryFor('zonekort', HS.layerByKey('src:zone1b').geojson.features[0].properties)||{}).color") === '#4fae5a');
check('byzone renders red', window.eval(
      "(HS.categoryFor('zonekort', HS.layerByKey('src:zone1b').geojson.features[1].properties)||{}).color") === '#e0554f');

console.log('\n== picture overlay toggles ==');
check('NT overlay offered as a row', /NT route map/.test($('#wmsList').textContent));
click(doc.querySelector('#wmsList .src-main'));
check('overlay turned on', window.eval("HS.S.wms.length") === 1 && window.eval("HS.S.wms[0].visible") === true);
click(doc.querySelector('#wmsList .src-main'));
check('overlay turned off, not duplicated',
      window.eval("HS.S.wms.length") === 1 && window.eval("HS.S.wms[0].visible") === false);


console.log('\n== zone 4 tooltip and legend order ==');
check('legend is alphabetical by letter', window.eval(`(() => {
  const ks = HS.RAMME_STYLE.slice().sort((a,b)=>a.key.localeCompare(b.key)).map(c=>c.key);
  return ks.join('') === 'BCDGHILMORST';
})()`), window.eval("HS.RAMME_STYLE.slice().sort((a,b)=>a.key.localeCompare(b.key)).map(c=>c.key).join('')"));
check('matching order still puts D before B', window.eval(
      "HS.RAMME_STYLE.findIndex(c=>c.key==='D') < HS.RAMME_STYLE.findIndex(c=>c.key==='B')"));
window.eval(`HS.addLayer('Rammer test', {type:'FeatureCollection',features:[
  {type:'Feature',properties:{plannr:'1.1.C2', anvendelsesnavn:'Centerområde'},
   geometry:{type:'Polygon',coordinates:[[[9.91,57.04],[9.93,57.04],[9.93,57.05],[9.91,57.05],[9.91,57.04]]]}},
  {type:'Feature',properties:{plannr:'2.2.S1', anvendelsesnavn:'Sommerhusområde'},
   geometry:{type:'Polygon',coordinates:[[[9.94,57.04],[9.95,57.04],[9.95,57.05],[9.94,57.05],[9.94,57.04]]]}},
  {type:'Feature',properties:{plannr:'3.3.B4', anvendelsesnavn:'Boligområde'},
   geometry:{type:'Polygon',coordinates:[[[9.96,57.04],[9.97,57.04],[9.97,57.05],[9.96,57.05],[9.96,57.04]]]}},
  {type:'Feature',properties:{plannr:'4.4.R1', anvendelsesnavn:'Rekreativt område'},
   geometry:{type:'Polygon',coordinates:[[[9.98,57.04],[9.99,57.04],[9.99,57.05],[9.98,57.05],[9.98,57.04]]]}}]},
  {key:'src:zone4t', style:'rammer', nameField:'plannr'})`);
const tips = window.eval(`(() => {
  const out = [];
  HS.layerByKey('src:zone4t').layer.eachLayer(l => out.push(l.getTooltip().getContent()));
  return out;
})()`);
check('tapping an area shows only the letter', tips.join(',') === 'C,S,B,R', JSON.stringify(tips));
check('no plan number in any tooltip', tips.every(t => !/\d/.test(t)));
const legTxt = $('#legend').textContent.slice($('#legend').textContent.indexOf('Rammer test'));
const shown = (legTxt.match(/([A-Z]) ·/g) || []).map(t => t[0]);
check('legend lists the letters alphabetically',
      shown.length >= 3 && shown.join('') === shown.slice().sort().join(''),
      shown.join(''));


console.log('\n== no gaps between neighbouring zones ==');
check('zone 3 covers its own outline with no slivers', window.eval(`(() => {
  const fs = HS.buildDistrictZones().features;
  const sum = fs.reduce((a,f)=>a+turf.area(f),0);
  const outline = HS.unionAll(fs);
  // if regions abut exactly, the union equals the sum of the parts
  return Math.abs(sum - turf.area(outline)) / turf.area(outline) < 0.02;
})()`), window.eval(`(() => {
  const fs = HS.buildDistrictZones().features;
  const sum = fs.reduce((a,f)=>a+turf.area(f),0);
  return 'sum ' + (sum/1e6).toFixed(1) + ' km2 vs union ' + (turf.area(HS.unionAll(fs))/1e6).toFixed(1);
})()`));
check('zone 2 areas abut with no gaps', window.eval(`(() => {
  const fs = HS.buildAreaZones().features;
  const sum = fs.reduce((a,f)=>a+turf.area(f),0);
  return Math.abs(sum - turf.area(HS.unionAll(fs))) / sum < 0.02;
})()`));
// Abutting polygons share an edge, and contour tracing is pixel-quantised,
// so neighbours overlap by up to one pixel (~28 m) along a shared border.
// What matters is that they overlap slightly rather than leaving a gap.
check('districts share edges instead of leaving gaps', window.eval(`(() => {
  const fs = HS.buildDistrictZones().features;
  let worstFrac = 0, worstAbs = 0;
  for (let i=0;i<fs.length;i++) for (let j=i+1;j<fs.length;j++) {
    let inter=null;
    try { inter = turf.intersect(turf.featureCollection([fs[i],fs[j]])); } catch(e) {}
    if (!inter) continue;
    const a = turf.area(inter);
    const smaller = Math.min(turf.area(fs[i]), turf.area(fs[j]));
    worstAbs = Math.max(worstAbs, a);
    worstFrac = Math.max(worstFrac, a / smaller);
  }
  window.__wf = worstFrac; window.__wa = worstAbs;
  return worstFrac < 0.03;
})()`), 'worst overlap ' + (100*window.eval("window.__wf||0")).toFixed(2) + '% of the smaller district');

console.log('\n== coastline auto-fit ==');
check('shoreline vertices were recorded', window.eval("HS.coastVertices().length") > 100,
      window.eval("HS.coastVertices().length") + ' vertices');
check('Overpass coastline query is well formed', window.eval(`(() => {
  const q = HS.overpassCoastQuery();
  return q.includes('"natural"="coastline"') && q.includes('out geom;')
      && q.includes('way(56.94,9.7,57.18,10.25)');
})()`), window.eval("HS.overpassCoastQuery()").slice(0, 60));
check('overpass geometry densifies into points', window.eval(`(() => {
  const pts = HS.parseOverpassPoints({elements:[{type:'way',geometry:[
    {lat:57.05,lon:9.90},{lat:57.05,lon:9.95}]}]}, 0.05);
  return pts.length > 40 && Math.abs(pts[0][0]-9.90) < 1e-9;
})()`), window.eval("HS.parseOverpassPoints({elements:[{type:'way',geometry:[{lat:57.05,lon:9.90},{lat:57.05,lon:9.95}]}]},0.05).length") + ' points');
check('grid index finds the nearest point', window.eval(`(() => {
  const idx = HS.makeIndex([[9.90,57.00],[10.00,57.00]], 0.01);
  const d = idx.nearest(9.905, 57.00);
  return d != null && Math.abs(d - 0.3025) < 0.05;
})()`));

// Synthetic test: build a "coastline" from the recorded shoreline vertices
// under a known transform, then check the optimiser recovers it.
check('optimiser recovers a known placement', window.eval(`(() => {
  const truth = { mul: 1.18, lat: 57.0600, lng: 9.9500 };
  const g = window.GEOREF, a = HS.anchorPx();
  const s = g.s * truth.mul;
  const lng0 = truth.lng - s*a[0], my0 = HS.__mercY(truth.lat) + s*a[1];
  const verts = HS.coastVertices();
  const coast = verts.map(([x,y]) => [lng0 + s*x, HS.__invMercY(my0 - s*y)]);
  const start = { mul: 1.0, lat: 57.0480, lng: 9.9187 };
  const best = HS.fitCoastline(verts, coast, start);
  window.__fit = best;
  return Math.abs(best.mul - truth.mul) < 0.03 &&
         Math.abs(best.lat - truth.lat) < 0.004 &&
         Math.abs(best.lng - truth.lng) < 0.007;
})()`), window.eval("JSON.stringify(window.__fit && {mul:+window.__fit.mul.toFixed(3), lat:+window.__fit.lat.toFixed(4), lng:+window.__fit.lng.toFixed(4)})") + ' vs {mul:1.18, lat:57.06, lng:9.95}');
check('optimiser does not collapse the zones', window.eval("window.__fit.mul") > 0.9);

console.log('\n== renaming a district ==');
check('renames apply', window.eval(`(() => {
  HS.S.renames = { 0: 'My own name' };
  const fs = HS.buildDistrictZones().features;
  return fs[0].properties.navn === 'My own name';
})()`));
check('renames survive save/load', window.eval(`(() => {
  HS.S.renames = { 3: 'Gammel Hasseris' };
  const blob = JSON.parse(JSON.stringify(HS.serialize()));
  HS.S.renames = {};
  HS.deserialize(blob);
  return HS.S.renames['3'] === 'Gammel Hasseris';
})()`));
window.eval("HS.S.renames = {}");

console.log('\n== runtime errors ==');
check('nothing threw during the whole run', errors.length === 0, errors.join(' | '));

console.log(`\n──────────────\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
