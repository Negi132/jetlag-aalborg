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
check('HUD shows the play area in mi²', Math.abs(parseFloat($('#hudArea').textContent) - Math.PI*36) < 0.6, `got "${$('#hudArea').textContent}" ${$('#hudUnit').textContent}`);
check('HUD unit is mi²', $('#hudUnit').textContent === 'mi²');
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
check('HUD area fell to \u03c0/4 mi\u00b2', Math.abs(parseFloat($('#hudArea').textContent) - Math.PI*0.25) < 0.02, `got "${$('#hudArea').textContent}"`);
check('HUD percentage gains precision when tiny', $('#hudPct').textContent === '0.69%', `got "${$('#hudPct').textContent}"`);
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
check('muting restores the full area', Math.abs(parseFloat($('#hudArea').textContent) - Math.PI*36) < 0.6);
check('muted row is dimmed', doc.querySelector('.log-item').classList.contains('is-off'));
click(doc.querySelector('.log-item [data-act="toggle"]'));
check('unmuting re-applies it', Math.abs(parseFloat($('#hudArea').textContent) - Math.PI*0.25) < 0.02);
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

// bisector sits 1.01 km off centre, so the survivor is a circular segment,
// not a naive half: r\u00b2\u00b7acos(d/r) \u2212 d\u00b7\u221a(r\u00b2\u2212d\u00b2) = 49.03 mi\u00b2
check('remaining area matches the analytic segment', Math.abs(parseFloat($('#hudArea').textContent) - 49.03) < 0.3,
      `got ${$('#hudArea').textContent} mi\u00b2`);

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
check('HUD back to full area', Math.abs(parseFloat($('#hudArea').textContent) - Math.PI*36) < 0.6);


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
check('unknown zone falls through', window.eval("HS.zonekortCategory({foo:'bar'})") === null);

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
const before = parseFloat($('#hudArea').textContent);
window.eval("HS.usePlayAreaFromLayer(HS.layerByKey('src:zone1'))");
const after = parseFloat($('#hudArea').textContent);
check('play area shrank to the merged zones', after < before && after > 0, `${before} -> ${after} mi²`);
check('the two touching squares merged into one ring',
      window.eval("HS.unionAll(HS.layerByKey('src:zone1').geojson.features).geometry.coordinates.length") === 1);
check('merged play area is stored as custom', window.eval("HS.S.playAreaMeta.type") === 'custom');
// the union of two 0.04x0.03 and 0.05x0.03 deg boxes should be a single 0.09x0.03 box
check('union area equals the sum of the parts', Math.abs(
  window.eval("turf.area(HS.unionAll(HS.layerByKey('src:zone1').geojson.features))") -
  window.eval("HS.layerByKey('src:zone1').geojson.features.reduce((a,f)=>a+turf.area(f),0)")) < 1000);

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


console.log('\n== route loading falls back when the first endpoint dies ==');
// Fail the SQL API, answer on the WFS endpoint.
window.__tried = [];
window.fetch = async (url) => {
  window.__tried.push(url);
  if (url.includes('/api/v2/sql/')) return { ok: false, status: 403, text: async () => 'denied' };
  return { ok: true, status: 200, text: async () => JSON.stringify({
    type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { linjenavn: 'Line 2' },
        geometry: { type: 'LineString', coordinates: [[9.88, 57.05], [9.96, 57.05]] } }]
  }) };
};
click(doc.querySelector('[data-tab="layers"]'));
const busRow = doc.querySelectorAll('#routeSources .src-main')[0];
click(busRow);
await new Promise(r => setTimeout(r, 60));
check('both endpoints were attempted', window.__tried.length === 2, `tried ${window.__tried.length}`);
check('route layer ended up loaded', window.eval("!!HS.layerByKey('route:bybus')"));
check('loaded as lines', window.eval("(HS.layerByKey('route:bybus')||{}).kind") === 'line');
check('route row now shows on', /is-on/.test($('#routeSources').innerHTML));
check('status explains what happened', /route lines on/.test($('#zoneStatus').textContent),
      $('#zoneStatus').textContent.slice(0, 70));
// tapping again hides rather than reloading
const callsBefore = window.__tried.length;
click(doc.querySelectorAll('#routeSources .src-main')[0]);
await new Promise(r => setTimeout(r, 30));
check('second tap only toggles, no refetch', window.__tried.length === callsBefore);
check('route hidden after second tap', window.eval("HS.layerByKey('route:bybus').visible") === false);
click(doc.querySelectorAll('#routeSources .src-main')[0]);
await new Promise(r => setTimeout(r, 30));
check('third tap shows it again', window.eval("HS.layerByKey('route:bybus').visible") === true);

console.log('\n== a dead source reports instead of failing silently ==');
window.fetch = async () => ({ ok: false, status: 404, text: async () => 'nope' });
const z3 = doc.querySelectorAll('#zoneSources .src-main')[2];
click(z3);
await new Promise(r => setTimeout(r, 60));
check('unconfigured zone 3 tells you to use the gear', /tap ⚙/i.test($('#zoneStatus').textContent),
      $('#zoneStatus').textContent.slice(0, 90));
check('status is flagged as a problem', $('#zoneStatus').classList.contains('is-bad'));

console.log('\n== picture overlay toggles ==');
check('NT overlay offered as a row', /NT route map/.test($('#wmsList').textContent));
click(doc.querySelector('#wmsList .src-main'));
check('overlay turned on', window.eval("HS.S.wms.length") === 1 && window.eval("HS.S.wms[0].visible") === true);
click(doc.querySelector('#wmsList .src-main'));
check('overlay turned off, not duplicated',
      window.eval("HS.S.wms.length") === 1 && window.eval("HS.S.wms[0].visible") === false);

console.log('\n== runtime errors ==');
check('nothing threw during the whole run', errors.length === 0, errors.join(' | '));

console.log(`\n──────────────\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
