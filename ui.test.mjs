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
check('zone layer listed', doc.querySelectorAll('#zoneLayers .zone-row').length === 1);
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

console.log('\n== runtime errors ==');
check('nothing threw during the whole run', errors.length === 0, errors.join(' | '));

console.log(`\n──────────────\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
