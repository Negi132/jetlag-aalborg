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


console.log('\n== small-game question deck ==');
check('six question-type panels render', doc.querySelectorAll('.question-type').length === 6,
      `${doc.querySelectorAll('.question-type').length}`);
check('Matching shows draw/pick cost and five-minute limit', /draw 3, pick 1/i.test($('#questionDeck').textContent) && /5 min/i.test($('#questionDeck').textContent));
check('Matching card list includes route and landmass cards', /Transit line/.test($('#questionDeck').textContent) && /Landmass/.test($('#questionDeck').textContent));
check('Measuring card list includes coastline and foreign consulate', /Coastline/.test($('#questionDeck').textContent) && /Foreign consulate/.test($('#questionDeck').textContent));
check('Thermometer has exactly the half-mile and three-mile cards', (() => {
  const cards = [...doc.querySelectorAll('[data-question-type="thermometer"]')].map((e) => e.dataset.card);
  return cards.join('|') === '½ mile|3 miles';
})());
check('Radar contains all nine fixed distances plus Custom', (() => {
  const cards = [...doc.querySelectorAll('[data-question-type="radar"]')].map((e) => e.dataset.card);
  return cards.length === 10 && cards.includes('¼ mile') && cards.includes('100 miles') && cards.includes('Custom');
})());
check('Tentacles shows its full rule but is disabled for the small game', (() => {
  const panel = [...doc.querySelectorAll('.question-type')].find((e) => /Tentacles/.test(e.textContent));
  return panel && panel.classList.contains('is-disabled') && /draw 4, pick 2/i.test(panel.textContent) && /medium and large/i.test(panel.textContent);
})());
check('Photos contains all six prompts and the 10-minute small-game limit', (() => {
  const cards = doc.querySelectorAll('[data-question-type="photos"]');
  return cards.length === 6 && /10 min/i.test($('#questionDeck').textContent) &&
    !!doc.querySelector('[data-question-type="photos"][data-card="A tree"]') &&
    !!doc.querySelector('[data-question-type="photos"][data-card="Any building visible from the station"]');
})());
const parkCard = doc.querySelector('[data-question-type="matching"][data-card="Park"]');
click(parkCard);
check('a Matching card opens the answer workspace', !$('#toolForm').hidden && /Matching · Park/.test($('#toolForm').textContent));
check('selected card pre-fills the category', $('#toolForm input[type="text"]').value === 'park', $('#toolForm input[type="text"]').value);
click($('#toolForm .question-back'));
check('back returns to the six-category deck', !$('#questionDeck').hidden && $('#toolForm').hidden);
check('all four default zone sources use KortInfo', window.eval(`
  Object.values(HS.S.sources).every(s => s.url === HS.KORTINFO && s.kind === 'wfs')
`));
check('default WFS layer IDs are the supplied four', window.eval(`
  ['ugis:TL1433667','ugis:TL445984','ugis:TL445987','ugis:TL445981']
    .every((id, i) => HS.S.sources['zone' + (i + 1)].typeName === id)
`));
check('Zone 2 request targets TL445984', /typeName=ugis%3ATL445984/.test(
  window.eval(`HS.wfsUrl(HS.S.sources.zone2)`)));
check('official source IDs are visible in the Layers UI',
      ['TL1433667','TL445984','TL445987','TL445981'].every(id => $('#calBox').textContent.includes(id)));
check('legacy move/scale controls are hidden',
      ['calAuto','calDrag','calScaleVal','calSnippet','calSnap','calReset']
        .every(id => doc.getElementById(id).closest('[hidden]')));
check('play-area note describes an exact union', /Exact union/.test($('#playNote').textContent));
const officialFixture = {
  type: 'FeatureCollection',
  features: [
    ['Midtbyen', 9.90], ['Nørresundby', 9.92], ['Aalborg Vest', 9.94], ['Øst Aalborg', 9.96]
  ].map(([name, x]) => ({
    type: 'Feature', properties: { OmraadeNavn: name },
    geometry: { type: 'Polygon', coordinates: [[[x,57.00],[x+.01,57.00],[x+.01,57.01],[x,57.01],[x,57.00]]] }
  }))
};
window.__officialFixture = officialFixture;
check('Zone 2 name matching identifies all four play areas',
      window.eval(`HS.officialPlayZoneFeatures(window.__officialFixture).length`) === 4);
check('Zone 2 preparation assigns canonical area numbers',
      window.eval(`HS.prepareOfficialZone2(window.__officialFixture).features.map(f => f.properties.area).join(',')`) === '1,2,3,4');
window.__legacyState = {
  constraints: [],
  sources: { zone2: { kind: 'areas', url: '', typeName: '' } },
  playAreaMeta: { type: 'zones' }
};
window.eval('HS.deserialize(window.__legacyState)');
check('legacy links cannot replace official Zone 2 defaults',
      window.eval(`HS.S.sources.zone2.url === HS.KORTINFO && HS.S.sources.zone2.typeName === 'ugis:TL445984'`));

console.log('\n== tabs ==');
click(doc.querySelector('[data-tab="layers"]'));
check('layers pane opens', doc.querySelector('[data-pane="layers"]').classList.contains('is-active'));
click(doc.querySelector('[data-tab="ask"]'));
check('ask pane returns', doc.querySelector('[data-pane="ask"]').classList.contains('is-active'));

console.log('\n== radar flow ==');
window.eval("selectTool('radar')");
check('radar form renders', !$('#toolForm').hidden && /Radar/.test($('#toolForm').textContent));
check('radar offers the deck\u2019s imperial radii', doc.querySelectorAll('#toolForm .chip').length === 13, doc.querySelector('#toolForm .chip').textContent + ' \u2026 ' + [...doc.querySelectorAll('#toolForm .chip')].pop().textContent);
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
window.eval("selectTool('thermometer')");
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
window.eval("selectTool('area')");
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
window.eval("selectTool('zone')");
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
check('radar presets are imperial', window.eval("HS.RADAR_PRESETS.map(p=>p.label).join(',')") === '250 ft,500 ft,1000 ft,1500 ft,\u00bc mi,\u00bd mi,1 mi,3 mi,5 mi,10 mi,25 mi,50 mi,100 mi',
      window.eval("HS.RADAR_PRESETS.map(p=>p.label).join(',')"));
check('1 mi preset is exactly 1609.344 m', window.eval("HS.RADAR_PRESETS[6].m") === 1609.344);
check('a photo log is neutral and leaves the full play area possible', window.eval(`(() => {
  const p = HS.constraintPolygon({type:'photo', subject:'A tree'});
  return p && Math.abs(turf.area(p) - turf.area(HS.S.playArea)) < 0.01;
})()`));
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
window.eval("selectTool('transit')");
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

console.log('\n== complete NT bus families and route labels ==');
const ntTables = window.eval('HS.NT_BUS_TABLES.map(x=>x.table)');
check('all five NT bus families are configured', ntTables.length === 5, ntTables.join(' | '));
check('yellow/local bus table is included', ntTables.includes('rutekortweb.ntmap_lokalbus_murl'));
check('telebus table is included', ntTables.includes('rutekortweb.ntmap_telebus_murl'));
check('bus source prefers the combined NT loader', window.eval("HS.ROUTE_SOURCES.bus.kind") === 'nt-all');
window.__ntCapsLayers = [
  {name:'rutekortweb:ntmap_regionalbus_murl', title:'Regionalbus'},
  {name:'rutekortweb:ntmap_regionalbus_biforloeb_murl', title:'Regionalbus biforløb'},
  {name:'rutekortweb:ntmap_lokalbus_biforloeb_murl', title:'Lokalbus biforløb'},
  {name:'rutekortweb:ntmap_tog_murl', title:'Tog'}
];
const discoveredBusTables = window.eval("HS.ntBusLayerDefs(window.__ntCapsLayers).map(x=>x.table)");
check('WFS discovery includes regional branch runs', discoveredBusTables.includes('rutekortweb.ntmap_regionalbus_biforloeb_murl'));
check('WFS discovery includes local branch runs', discoveredBusTables.includes('rutekortweb.ntmap_lokalbus_biforloeb_murl'));
check('WFS discovery excludes trains', !discoveredBusTables.includes('rutekortweb.ntmap_tog_murl'));
check('route 38 is a required fallback route', window.eval("HS.REQUIRED_BUS_ROUTE_SUPPLEMENTS.some(x=>x.ref==='38')"));
window.__stopsFixture = [
  {type:'node',lat:57.043,lon:9.918,tags:{name:'Aalborg St. (Perron C9)'}},
  {type:'node',lat:57.042,lon:9.910,tags:{name:'Prinsensgade (Aalborg)'}},
  {type:'node',lat:57.039,lon:9.899,tags:{name:'Sankt Jørgens Gade (Hasserisgade)'}},
  {type:'node',lat:57.034,lon:9.879,tags:{name:'Fyrrebakken (Hasserisvej)'}},
  {type:'node',lat:57.031,lon:9.864,tags:{name:'Hundeklemmen'}},
  {type:'node',lat:57.028,lon:9.850,tags:{name:'Nørholmsvej (Under Lien)'}},
  {type:'node',lat:57.025,lon:9.820,tags:{name:'Nældevej'}},
  {type:'node',lat:57.020,lon:9.760,tags:{name:'Nørholm'}},
  {type:'node',lat:57.015,lon:9.720,tags:{name:'Klitgård'}}
];
window.__parsedStops = window.eval("HS.parseOverpassStops({elements:window.__stopsFixture})");
const matched38Stops = window.eval("HS.matchSupplementStops(window.__parsedStops, HS.REQUIRED_BUS_ROUTE_SUPPLEMENTS[0])");
check('route 38 stop names match despite parenthetical text', matched38Stops.length >= 8, `got ${matched38Stops.length}`);
const extractedRefs = window.eval("HS.extractRouteRefs({rutenr:'Linje 11, 12 og 14'}).join(', ')");
check('combined line-number fields are parsed', extractedRefs === '11, 12, 14', extractedRefs);
window.__sharedRoutes = {type:'FeatureCollection',features:[
  {type:'Feature',properties:{rutenr:'11'},geometry:{type:'LineString',coordinates:[[9.88,57.04],[9.98,57.04]]}},
  {type:'Feature',properties:{rutenr:'12'},geometry:{type:'LineString',coordinates:[[9.88,57.04],[9.98,57.04]]}},
  {type:'Feature',properties:{rutenr:'14'},geometry:{type:'LineString',coordinates:[[9.88,57.04],[9.98,57.04]]}}
]};
window.eval("HS.annotateRouteGeoJson(window.__sharedRoutes, 'local')");
const sharedLabels = window.eval("HS.routeLabelPoints(window.__sharedRoutes).map(x=>x.text)");
check('shared corridor labels contain every bus', sharedLabels.includes('11, 12, 14'), sharedLabels.join(' | '));
const routeDisplay = window.eval("HS.prepareRouteDisplayGeoJson(window.__sharedRoutes)");
check('one coloured display path is made per bus', routeDisplay.features.length === 3, `got ${routeDisplay.features.length}`);
check('different route numbers receive different colours', new Set(routeDisplay.features.map(f=>f.properties.__routeColor)).size === 3);

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

console.log('\n== combined NT bus routes load ==');
window.__tried = [];
const ntFeature = (ref, y = 57.04) => ({
  type:'Feature', properties:{rutenr:ref},
  geometry:{type:'LineString',coordinates:[[9.88,y],[9.98,y]]}
});
window.fetch = async (url) => {
  const text = String(url);
  window.__tried.push(text);
  if (/GetCapabilities/i.test(text)) return { ok:true, status:200, text:async()=>`<WFS_Capabilities><FeatureTypeList>
    <FeatureType><Name>rutekortweb:ntmap_bybus_murl</Name><Title>Bybus</Title></FeatureType>
    <FeatureType><Name>rutekortweb:ntmap_regionalbus_murl</Name><Title>Regionalbus</Title></FeatureType>
    <FeatureType><Name>rutekortweb:ntmap_regionalbus_biforloeb_murl</Name><Title>Regionalbus biforløb</Title></FeatureType>
    <FeatureType><Name>rutekortweb:ntmap_xbus_murl</Name><Title>Expresbus</Title></FeatureType>
    <FeatureType><Name>rutekortweb:ntmap_lokalbus_murl</Name><Title>Lokalbus</Title></FeatureType>
    <FeatureType><Name>rutekortweb:ntmap_telebus_murl</Name><Title>Telebus</Title></FeatureType>
    <FeatureType><Name>rutekortweb:ntmap_tog_murl</Name><Title>Tog</Title></FeatureType>
  </FeatureTypeList></WFS_Capabilities>` };
  if (text.includes('ntmap_regionalbus_biforloeb_murl')) return { ok:true, status:200, text:async()=>JSON.stringify({type:'FeatureCollection',features:[ntFeature('38',57.047)]}) };
  if (text.includes('ntmap_bybus_murl')) return { ok:true, status:200, text:async()=>JSON.stringify({type:'FeatureCollection',features:[ntFeature('2')]}) };
  if (text.includes('ntmap_regionalbus_murl')) return { ok:true, status:200, text:async()=>JSON.stringify({type:'FeatureCollection',features:[ntFeature('950X',57.045)]}) };
  if (text.includes('ntmap_xbus_murl')) return { ok:true, status:200, text:async()=>JSON.stringify({type:'FeatureCollection',features:[ntFeature('970X',57.05)]}) };
  if (text.includes('ntmap_lokalbus_murl')) return { ok:true, status:200, text:async()=>JSON.stringify({type:'FeatureCollection',features:[ntFeature('11, 12, 14',57.055)]}) };
  if (text.includes('ntmap_telebus_murl')) return { ok:true, status:200, text:async()=>JSON.stringify({type:'FeatureCollection',features:[ntFeature('99',57.06)]}) };
  return { ok:false, status:404, text:async()=>'' };
};
click(doc.querySelector('[data-tab="layers"]'));
click(doc.querySelectorAll('#routeSources .src-main')[0]);
await new Promise(r => setTimeout(r, 120));
check('every NT bus family was requested', window.eval('HS.NT_BUS_TABLES.every(t=>window.__tried.some(u=>u.includes(t.table.split(".").pop())))'));
check('route layer ended up loaded', window.eval("!!HS.layerByKey('route:bus')"));
check('loaded as tappable lines', window.eval("(HS.layerByKey('route:bus')||{}).kind") === 'line');
check('all numbered routes are counted', window.eval("HS.layerByKey('route:bus').routeCount") === 8,
      `got ${window.eval("HS.layerByKey('route:bus').routeCount")}`);
check('local routes 11, 12 and 14 are present', window.eval("['11','12','14'].every(r=>HS.layerByKey('route:bus').routeRefs.includes(r))"));
check('small regional route 38 is loaded from a branch layer', window.eval("HS.layerByKey('route:bus').routeRefs.includes('38')"));
check('branch layer was requested dynamically', window.__tried.some(u=>u.includes('ntmap_regionalbus_biforloeb_murl')));
check('periodic route labels were created', window.eval("HS.layerByKey('route:bus').labelLayer.getLayers().length") > 0);
check('route row now shows on', /is-on/.test($('#routeSources').innerHTML));
check('status reports numbered routes', /8 numbered routes on/.test($('#zoneStatus').textContent),
      $('#zoneStatus').textContent.slice(0, 90));
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
  const v = fs.map(f => f.geometry.coordinates[0].length).sort((a,b)=>a-b);
  window.__vmin = v[0]; window.__vmed = v[v.length>>1];
  // a few tiny slivers are legitimately simple; the typical district is not
  return v[0] >= 4 && v[v.length>>1] > 12 && v.reduce((a,b)=>a+b,0) > 800;
})()`), `${window.eval("HS.layerByKey('src:zone3').geojson.features.reduce((a,f)=>a+f.geometry.coordinates[0].length,0)")} vertices, median ${window.eval("window.__vmed")}, smallest ${window.eval("window.__vmin")}`);
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


console.log('\n== no gaps between neighbouring zones ==');
check('zone 3 tiles its own outline exactly', window.eval(`(() => {
  const fs = HS.buildDistrictZones().features;
  const sum = fs.reduce((a,f)=>a+turf.area(f),0);
  const outline = turf.area(HS.unionAll(fs));
  window.__z3 = [sum, outline];
  return Math.abs(sum - outline) / outline < 0.002;
})()`), (() => { const v = window.eval("window.__z3")||[0,1];
  return 'sum ' + (v[0]/1e6).toFixed(2) + ' km2 vs union ' + (v[1]/1e6).toFixed(2); })());
check('zone 2 tiles its own outline exactly', window.eval(`(() => {
  const fs = HS.buildAreaZones().features;
  const sum = fs.reduce((a,f)=>a+turf.area(f),0);
  return Math.abs(sum - turf.area(HS.unionAll(fs))) / sum < 0.002;
})()`));
check('no two districts overlap', window.eval(`(() => {
  const fs = HS.buildDistrictZones().features;
  let worst = 0;
  for (let i=0;i<fs.length;i++) for (let j=i+1;j<fs.length;j++) {
    let inter=null;
    try { inter = turf.intersect(turf.featureCollection([fs[i],fs[j]])); } catch(e) {}
    if (inter) worst = Math.max(worst, turf.area(inter) / Math.min(turf.area(fs[i]),turf.area(fs[j])));
  }
  window.__ov = worst;
  return worst < 0.005;
})()`), 'worst overlap ' + (100*(window.eval("window.__ov")||0)).toFixed(3) + '% of the smaller');
check('the four play zones cover the districts', window.eval(`(() => {
  const z2 = turf.area(HS.unionAll(HS.buildAreaZones().features));
  const z3 = turf.area(HS.unionAll(HS.buildDistrictZones().features));
  window.__cov = z3/z2;
  return z3/z2 > 0.85 && z3/z2 < 1.15;
})()`), 'zone 3 covers ' + (100*(window.eval("window.__cov")||0)).toFixed(0) + '% of zone 2');

console.log('\n== zone toggles stay reversible ==');
click(doc.querySelector('[data-tab="layers"]'));
const zr = () => doc.querySelectorAll('#zoneSources .src-main');
if (!window.eval("!!HS.layerByKey('src:zone3')")) {
  click(zr()[2]); await new Promise(r=>setTimeout(r,40));
}
const vis = () => window.eval("HS.layerByKey('src:zone3').visible");
const start = vis();
click(zr()[2]);
check('tapping flips the layer', vis() === !start);
click(zr()[2]);
check('tapping again flips it back', vis() === start);
click(zr()[2]); click(zr()[2]);
check('four taps later there is still exactly one layer',
      window.eval("HS.S.layers.filter(l=>l.key==='src:zone3').length") === 1 && vis() === start);

console.log('\n== boundaries snapped to roads ==');
check('a boundary along a road is straightened onto it', window.eval(`(() => {
  const segs = [];
  for (let i=0;i<40;i++) segs.push([9.90+i*0.002,57.05,9.90+(i+1)*0.002,57.05,1]);
  for (let i=0;i<40;i+=3){ const x=9.90+i*0.002; segs.push([x,57.045,x,57.055,2+i]); }
  const sn = HS.snapRingsToRoads(HS.segmentIndex(segs, 0.004), 70);
  const ring = []; for (let i=0;i<40;i++) ring.push([i, (i%2?0.1:-0.1)]);
  const gr = { s: 0.002, lng0: 9.901, my0: HS.__mercY(57.05) };
  const out = sn.mapRing(ring.concat([ring[0]]), gr);
  const lats = out.map(p=>p[1]);
  window.__sp = (Math.max(...lats)-Math.min(...lats))*111200;
  return window.__sp < 5;
})()`), 'residual spread ' + (window.eval("window.__sp")||0).toFixed(1) + ' m');
check('a boundary that follows no road is left alone', window.eval(`(() => {
  const segs = [];
  for (let j=0;j<12;j++){ const y=57.045+j*0.0009;
    for (let i=0;i<40;i++) segs.push([9.90+i*0.002,y,9.90+(i+1)*0.002,y,100+j]); }
  for (let i=0;i<40;i+=2){ const x=9.90+i*0.002; segs.push([x,57.045,x,57.055,200+i]); }
  const sn = HS.snapRingsToRoads(HS.segmentIndex(segs, 0.004), 70);
  const ring = []; for (let i=0;i<40;i++) ring.push([i, i]);
  sn.mapRing(ring.concat([ring[0]]), { s: 0.002, lng0: 9.901, my0: HS.__mercY(57.0455) });
  const st = sn.stats(); window.__lo = st.total - st.moved; window.__lt = st.total;
  return st.moved < st.total * 0.25;
})()`), window.eval("window.__lo") + ' of ' + window.eval("window.__lt") + ' left untouched');
check('snapping keeps the zones joined', window.eval(`(() => {
  const before = HS.buildDistrictZones().features;
  const segs = [];
  for (const f of before) { const c = f.geometry.coordinates[0];
    for (let i=1;i<c.length;i++) segs.push([c[i-1][0]+0.0002,c[i-1][1]+0.0001,c[i][0]+0.0002,c[i][1]+0.0001,1]); }
  HS.S.roadIndex = HS.segmentIndex(segs, 0.004); HS.S.snapOn = true; HS.S.snapM = 120;
  const after = HS.buildDistrictZones().features;
  const sum = after.reduce((a,f)=>a+turf.area(f),0);
  const d = Math.abs(sum - turf.area(HS.unionAll(after)))/turf.area(HS.unionAll(after));
  HS.S.roadIndex = null; HS.S.snapOn = false;
  window.__sd = d;
  return d < 0.005;
})()`), 'sum vs union differ by ' + (100*(window.eval("window.__sd")||0)).toFixed(3) + '%');

console.log('\n== automatic placement ==');
check('scale and position are both recovered', window.eval(`(() => {
  const truth = { mul: 1.22, lat: 57.0610, lng: 9.9400 };
  const g = { s: window.BASE_PX_DEG }, a = HS.anchorPx();
  const s = g.s * truth.mul;
  const lng0 = truth.lng - s*a[0], my0 = HS.__mercY(truth.lat) + s*a[1];
  const put = ([x,y]) => [lng0 + s*x, HS.__invMercY(my0 - s*y)];
  const cv = HS.coastVertices(), coast = cv.map(put);
  const bnd = HS.boundaryVertices(2);
  const segs = [];
  for (let i=1;i<bnd.length;i++){ const p=put(bnd[i-1]), q=put(bnd[i]); segs.push([p[0],p[1],q[0],q[1],i]); }
  const best = HS.fitToGeography(cv, coast, bnd, HS.segmentIndex(segs,0.004),
                                 { mul: 1.0, lat: 57.048, lng: 9.9187 }, []);
  window.__af = best;
  return Math.abs(best.mul - truth.mul) < 0.02;
})()`), 'recovered ' + (window.eval("window.__af && window.__af.mul")||0).toFixed(3) + ' vs 1.220');


console.log('\n== boundaries follow the source: smooth curves, sharp corners ==');
const turnList = (expr) => window.eval(`(() => {
  const fs = ${expr};
  const turns = [];
  for (const f of fs) {
    const c = f.geometry.coordinates[0];
    const u = [];
    for (let i=1;i<c.length;i++) {
      const dx=(c[i][0]-c[i-1][0])*0.545, dy=c[i][1]-c[i-1][1];
      const n=Math.hypot(dx,dy); if(n>1e-12) u.push([dx/n,dy/n]);
    }
    for (let i=1;i<u.length;i++) {
      const d=Math.max(-1,Math.min(1,u[i-1][0]*u[i][0]+u[i-1][1]*u[i][1]));
      turns.push(Math.acos(d)*180/Math.PI);
    }
  }
  return turns;
})()`);
const t3 = turnList("HS.buildDistrictZones().features");
const gentle3 = t3.filter(t=>t<15).length/t3.length;
const sharp3  = t3.filter(t=>t>60).length/t3.length;
check('most of a district border runs gently', gentle3 > 0.5,
      `${(100*gentle3).toFixed(0)}% of turns under 15\u00b0`);
check('but real corners are kept sharp', sharp3 > 0.05 && t3.some(t=>t>85),
      `${(100*sharp3).toFixed(0)}% over 60\u00b0, sharpest ${Math.max(...t3).toFixed(0)}\u00b0`);

// The boundary in the photo: Midtbyen. Smooth along Østre Allé, hard turns
// at Vestre Fjordvej and the tunnel.
const tm = turnList("HS.buildAreaZones().features.filter(f=>f.properties.navn.includes('Midtbyen'))");
const gm = tm.filter(t=>t<15).length/tm.length;
check('Midtbyen runs smoothly along its long stretches', gm > 0.6,
      `${(100*gm).toFixed(0)}% of turns under 15\u00b0`);
check('Midtbyen keeps its hard turns', tm.filter(t=>t>60).length >= 3,
      `${tm.filter(t=>t>60).length} turns over 60\u00b0, sharpest ${Math.max(...tm).toFixed(0)}\u00b0`);
check('no staircase left over', t3.filter(t=>t>25 && t<50).length/t3.length < 0.25,
      `${(100*t3.filter(t=>t>25&&t<50).length/t3.length).toFixed(0)}% in the 25-50\u00b0 band`);
check('detail was not thrown away', window.eval(`(() => {
  const v = HS.buildDistrictZones().features.reduce((a,f)=>a+f.geometry.coordinates[0].length,0);
  window.__v = v; return v > 1500;
})()`), window.eval("window.__v") + ' vertices across the districts');
check('and the zones are still perfectly joined', window.eval(`(() => {
  const fs = HS.buildDistrictZones().features;
  const sum = fs.reduce((a,f)=>a+turf.area(f),0);
  return Math.abs(sum - turf.area(HS.unionAll(fs))) / sum < 0.002;
})()`));

console.log('\n== placing the zones ==');
const c0 = window.eval("JSON.stringify(HS.S.cal)");
check('placement starts from data.js', window.eval(`(() => {
  const c = HS.S.cal || HS.defaultCal(), p = window.PLACEMENT;
  return Math.abs(c.lat-p.lat)<1e-9 && Math.abs(c.lng-p.lng)<1e-9 && Math.abs(c.mul-p.scale)<1e-9;
})()`));

console.log('  -- nudging by an exact distance --');
check('nudging east moves the zones east by the amount asked', window.eval(`(() => {
  const before = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  HS.nudgeCal(250, 0);
  const after = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  const d = turf.distance(turf.point(before), turf.point(after), {units:'kilometers'})*1000;
  window.__d = d;
  return Math.abs(d - 250) < 3 && after[0] > before[0];
})()`), 'moved ' + (window.eval("window.__d")||0).toFixed(1) + ' m for a 250 m nudge');
check('nudging north moves north by the amount asked', window.eval(`(() => {
  const before = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  HS.nudgeCal(0, 100);
  const after = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  const d = turf.distance(turf.point(before), turf.point(after), {units:'kilometers'})*1000;
  return Math.abs(d - 100) < 2 && after[1] > before[1];
})()`));
check('nudges undo exactly', window.eval(`(() => {
  const a = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  HS.nudgeCal(-250, -100);
  const b = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  HS.nudgeCal(250, 100); HS.nudgeCal(-250, -100);
  const c = turf.centroid(HS.buildAreaZones().features[0]).geometry.coordinates;
  return Math.abs(b[0]-c[0])<1e-9 && Math.abs(b[1]-c[1])<1e-9;
})()`));
window.eval(`HS.S.cal = ${c0}; HS.applyCal(true);`);

console.log('  -- resizing about the screen centre --');
check('a 1% resize changes the span by 1%', window.eval(`(() => {
  const span = () => { const b = turf.bbox(HS.buildAreaZones());
    return turf.distance(turf.point([b[0],b[1]]), turf.point([b[2],b[1]])); };
  const a = span(); HS.scaleCal(1.01); const b = span();
  window.__r = b/a;
  return Math.abs(b/a - 1.01) < 0.002;
})()`), 'ratio ' + (window.eval("window.__r")||0).toFixed(4));
check('resizing keeps the map centre fixed', window.eval(`(() => {
  const mid = HS.map.getCenter();
  const at = () => { const gr = HS.georef();
    // where does the map centre fall in overlay pixel space?
    return [(mid.lng - gr.lng0)/gr.s, (HS.__mercY(mid.lat) - gr.my0)/(-gr.s)]; };
  const a = at(); HS.scaleCal(1.05); const b = at();
  window.__px = Math.hypot(a[0]-b[0], a[1]-b[1]);
  return window.__px < 0.6;      // same overlay pixel stays under the centre
})()`), 'centre drifted ' + (window.eval("window.__px")||0).toFixed(2) + ' overlay px');
check('resizes undo exactly', window.eval(`(() => {
  const m0 = HS.S.cal.mul;
  HS.scaleCal(1.01); HS.scaleCal(1/1.01);
  return Math.abs(HS.S.cal.mul - m0) < 1e-9;
})()`));
check('resizing refuses to run away', window.eval(`(() => {
  const m0 = HS.S.cal.mul;
  for (let i=0;i<200;i++) HS.scaleCal(1.1);
  const big = HS.S.cal.mul <= 5;
  for (let i=0;i<400;i++) HS.scaleCal(0.9);
  return big && HS.S.cal.mul >= 0.2;
})()`));
window.eval(`HS.S.cal = ${c0}; HS.applyCal(true);`);

console.log('  -- dragging --');
check('drag mode stops the map panning', window.eval(`(() => {
  HS.setCalMode(true);
  const off = !HS.map.dragging.enabled();
  HS.setCalMode(false);
  return off && HS.map.dragging.enabled();
})()`));

console.log('  -- making it permanent --');
check('the snippet is a valid PLACEMENT line', window.eval(`(() => {
  const line = HS.placementSnippet();
  window.__line = line;
  if (line.indexOf('const PLACEMENT = {') !== 0 || line.slice(-2) !== '};') return false;
  const o = eval('(' + line.slice('const PLACEMENT = '.length, -1) + ')');
  const c = HS.S.cal || HS.defaultCal();
  return Math.abs(o.lat-c.lat) < 1e-5 && Math.abs(o.lng-c.lng) < 1e-5
      && Math.abs(o.scale-(c.mul||1)) < 1e-4;
})()`), window.eval("window.__line"));
check('pasting the snippet reproduces the placement exactly', window.eval(`(() => {
  HS.nudgeCal(137, -42); HS.scaleCal(1.037);
  const line = HS.placementSnippet();
  const want = HS.buildAreaZones().features.map(f => turf.centroid(f).geometry.coordinates);
  // simulate a fresh load with that PLACEMENT baked into data.js
  const saved = window.PLACEMENT;
  window.PLACEMENT = eval(line.replace('const PLACEMENT =','(').replace(/;$/,')'));
  HS.S.cal = HS.defaultCal();
  const got = HS.buildAreaZones().features.map(f => turf.centroid(f).geometry.coordinates);
  window.PLACEMENT = saved;
  const worst = Math.max(...want.map((w,i) =>
    turf.distance(turf.point(w), turf.point(got[i]), {units:'kilometers'})*1000));
  window.__worst = worst;
  return worst < 1;             // under a metre
})()`), 'reproduced to ' + (window.eval("window.__worst")||0).toFixed(2) + ' m');
window.eval(`HS.S.cal = ${c0}; HS.applyCal(true);`);
check('placement still survives the game link', window.eval(`(() => {
  HS.S.cal = { lat: 57.05, lng: 9.93, mul: 1.2 };
  const blob = JSON.parse(JSON.stringify(HS.serialize()));
  HS.S.cal = HS.defaultCal();
  HS.deserialize(blob);
  return Math.abs(HS.S.cal.mul - 1.2) < 1e-9 && Math.abs(HS.S.cal.lng - 9.93) < 1e-9;
})()`));
window.eval(`HS.S.cal = ${c0}; HS.applyCal(true);`);

console.log('\n== Østre Allé as the anchor ==');
check('a reference road is defined', window.eval("(window.REFERENCE_ROADS||[]).length") >= 1,
      window.eval("(window.REFERENCE_ROADS||[]).map(r=>r.name).join(', ')"));
check('it is Midtbyen\u2019s southern edge', window.eval(`(() => {
  const r = window.REFERENCE_ROADS[0];
  const mid = window.ZONE2_PX.find(z => z.n === 1);
  // every reference point must be a vertex of the Midtbyen ring
  return r.px.every(p => mid.ring.some(q => q[0] === p[0] && q[1] === p[1]));
})()`));
check('the reference line densifies evenly', window.eval(`(() => {
  const l = HS.referenceLines(2)[0];
  let maxGap = 0;
  for (let i=1;i<l.px.length;i++) maxGap = Math.max(maxGap,
    Math.hypot(l.px[i][0]-l.px[i-1][0], l.px[i][1]-l.px[i-1][1]));
  window.__gap = maxGap;
  return l.px.length > window.REFERENCE_ROADS[0].px.length * 3 && maxGap <= 2.5;
})()`), window.eval("HS.referenceLines(2)[0].px.length") + ' points, max gap ' +
        (window.eval("window.__gap")||0).toFixed(1) + ' px');
check('named-road query asks for the road by name', window.eval(`(() => {
  const q = HS.overpassNamedRoadQuery(['Østre Allé']);
  return q.includes('["name"="Østre Allé"]') && q.includes('out geom;');
})()`));

// The anchor should sharpen the fit: give it a deliberately poor start and
// only the reference road plus a short coastline to work from.
check('the anchor pins scale and position', window.eval(`(() => {
  const truth = { mul: 1.31, lat: 57.0555, lng: 9.9310 };
  const g = { s: window.BASE_PX_DEG }, a = HS.anchorPx();
  const s = g.s * truth.mul;
  const lng0 = truth.lng - s*a[0], my0 = HS.__mercY(truth.lat) + s*a[1];
  const put = ([x,y]) => [lng0 + s*x, HS.__invMercY(my0 - s*y)];
  const line = HS.referenceLines(2)[0];
  // the "real" Østre Allé, as it would be if the truth transform held
  const real = line.px.map(put);
  const cv = HS.coastVertices();
  const coast = cv.map(put);
  const best = HS.fitToGeography(cv, coast, HS.boundaryVertices(4), null,
                                 { mul: 1.0, lat: 57.040, lng: 9.900 },
                                 [{ name: 'Østre Allé', px: line.px, real }]);
  window.__anchored = best;
  return Math.abs(best.mul - truth.mul) < 0.01 &&
         Math.abs(best.lat - truth.lat) < 0.001 &&
         Math.abs(best.lng - truth.lng) < 0.0015;
})()`), window.eval("window.__anchored ? 'recovered ' + window.__anchored.mul.toFixed(3) + ' / ' + window.__anchored.lat.toFixed(4) + ', ' + window.__anchored.lng.toFixed(4) : ''") + ' vs 1.310 / 57.0555, 9.9310');
check('the fit still runs when the named road is missing', window.eval(`(() => {
  const cv = HS.coastVertices();
  const g = { s: window.BASE_PX_DEG }, a = HS.anchorPx();
  const s = g.s * 1.2;
  const lng0 = 9.94 - s*a[0], my0 = HS.__mercY(57.05) + s*a[1];
  const coast = cv.map(([x,y]) => [lng0+s*x, HS.__invMercY(my0-s*y)]);
  const best = HS.fitToGeography(cv, coast, HS.boundaryVertices(4), null,
                                 { mul: 1.0, lat: 57.048, lng: 9.9187 }, []);
  return Math.abs(best.mul - 1.2) < 0.05;
})()`));


console.log('\n== live boundaries from Aalborg KortInfo ==');
check('the KortInfo endpoint is wired in', window.eval("HS.KORTINFO").includes('drift.kortinfo.net')
      && window.eval("HS.KORTINFO").includes('Site=Aalborg'), window.eval("HS.KORTINFO"));

// KortInfo answers in GML, not GeoJSON, so that has to parse too.
window.__gml = `<?xml version="1.0"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml">
 <gml:featureMember>
  <ki:bydele xmlns:ki="http://kortinfo.net">
   <ki:navn>Vestbyen</ki:navn>
   <ki:geometri>
    <gml:Polygon srsName="EPSG:25832">
     <gml:exterior><gml:LinearRing>
      <gml:posList>552000 6322000 553000 6322000 553000 6323000 552000 6323000 552000 6322000</gml:posList>
     </gml:LinearRing></gml:exterior>
    </gml:Polygon>
   </ki:geometri>
  </ki:bydele>
 </gml:featureMember>
 <gml:featureMember>
  <ki:bydele xmlns:ki="http://kortinfo.net">
   <ki:navn>Hasseris</ki:navn>
   <ki:geometri><gml:Polygon>
     <gml:exterior><gml:LinearRing>
      <gml:posList>553000 6322000 554000 6322000 554000 6323000 553000 6323000 553000 6322000</gml:posList>
     </gml:LinearRing></gml:exterior>
   </gml:Polygon></ki:geometri>
  </ki:bydele>
 </gml:featureMember>
</wfs:FeatureCollection>`;
const g = window.eval("HS.parseGml(window.__gml)");
check('GML parses into features', g.type === 'FeatureCollection' && g.features.length === 2,
      `${g.features.length} features`);
check('rings come through closed', window.eval(`(() => {
  const r = HS.parseGml(window.__gml).features[0].geometry.coordinates[0];
  return r.length === 5 && r[0][0] === r[4][0] && r[0][1] === r[4][1];
})()`));
check('attributes survive, so districts keep their names', g.features[0].properties.navn === 'Vestbyen'
      && g.features[1].properties.navn === 'Hasseris',
      g.features.map(f=>f.properties.navn).join(', '));
check('UTM32 coordinates reproject into Aalborg', window.eval(`(() => {
  const gj = HS.parseGml(window.__gml);
  HS.normaliseCoords(gj);
  const c = gj.features[0].geometry.coordinates[0][0];
  window.__ll = c;
  return c[0] > 9.5 && c[0] < 10.5 && c[1] > 56.8 && c[1] < 57.4;
})()`), window.eval("window.__ll") ? window.eval("window.__ll").map(v=>v.toFixed(4)).join(', ') : '');
check('a GML service exception is reported, not swallowed', window.eval(`(() => {
  try {
    HS.parseGml('<ServiceExceptionReport><ServiceException>Access denied</ServiceException></ServiceExceptionReport>');
    return false;
  } catch (e) { window.__ex = e.message; return /Access denied/.test(e.message); }
})()`), window.eval("window.__ex"));
check('GML2 coordinates syntax also parses', window.eval(`(() => {
  const x = HS.parseGml('<FeatureCollection><featureMember><a><Polygon><outerBoundaryIs><LinearRing>' +
    '<coordinates>9.9,57.0 9.91,57.0 9.91,57.01 9.9,57.01 9.9,57.0</coordinates>' +
    '</LinearRing></outerBoundaryIs></Polygon></a></featureMember></FeatureCollection>');
  return x.features.length === 1 && x.features[0].geometry.coordinates[0].length === 5;
})()`));
check('the traced outlines still work if KortInfo says no', window.eval(`(() => {
  return HS.buildDistrictZones().features.length === window.ZONE3_PX.length;
})()`));

console.log('\n== official zone labels ==');
check('Zone 3 rejects the four parent-area names as district labels', window.eval(`(() => {
  const districts = ['Vestbyen','Hasseris','Skalborg','Vejgaard','Gug','Kærby','Nørre Tranders','Sønder Tranders'];
  const features = districts.map((name, i) => ({ type:'Feature', geometry:null, properties:{
    navn: i < 4 ? 'Vest Aalborg' : 'Øst Aalborg',
    bydelsnavn: name,
    objectid: 100000 + i
  }}));
  const gj = { type:'FeatureCollection', features };
  window.__zone3Field = HS.inferNameField(features, 'zone3');
  HS.prepareSourceLabels(gj, 'zone3', '');
  window.__zone3Labels = gj.features.map((f) => f.properties.__displayName);
  return window.__zone3Field === 'bydelsnavn' &&
         window.__zone3Labels.join('|') === districts.join('|');
})()`), window.eval("window.__zone3Field + ': ' + window.__zone3Labels.join(', ')"));

check('Zone 4 creates a labelled X area for uncovered land', window.eval(`(() => {
  const centre = turf.centroid(HS.S.playArea);
  const covered = turf.buffer(centre, 0.15, { units:'kilometers' });
  covered.properties = { anvendelse:'Boligområde', plannr:'1.1.B1' };
  const base = turf.featureCollection([covered]);
  const rec = HS.addLayer('Zone 4 fixture', base, {
    key:'test:zone4-catchall', style:'rammer', sourceKey:'zone4', baseGeojson:base
  });
  window.__zone4Catch = rec && rec.geojson.features.find((f) => f.properties && f.properties.__zone4Other);
  return !!window.__zone4Catch && HS.rammeCategory(window.__zone4Catch.properties).key === 'X' &&
         HS.featureName(window.__zone4Catch, rec) === 'X · Uden kommuneplanramme';
})()`), window.eval("window.__zone4Catch ? window.__zone4Catch.properties.__displayName : 'missing'"));
check('the X catch-all appears in the Zone 4 legend', /X · Uden kommuneplanramme/.test($('#legend').textContent));

console.log('\n== question preview mode ==');
check('the Layers tab contains a transit-stops toggle', !!$('#stopSources'));
check('Radar preview is non-committing and computes an impact', window.eval(`(() => {
  HS.selectTool('radar');
  HS.draft.center = [9.9217,57.0488];
  HS.draft.radiusM = 0.5 * 1609.344;
  HS.draft.answer = 'yes';
  HS.questionPreview.active = true;
  HS.questionPreview.type = 'radar';
  const before = HS.S.constraints.length;
  HS.syncQuestionPreview();
  return HS.S.constraints.length === before && HS.questionPreview.metrics &&
         HS.questionPreview.metrics.afterM2 < HS.questionPreview.metrics.beforeM2;
})()`));
check('Thermometer handle stays on the selected travel ring', window.eval(`(() => {
  const a = [9.9217,57.0488];
  const raw = [9.95,57.06];
  const b = HS.constrainToRadius(a, raw, 804.672);
  const d = turf.distance(turf.point(a), turf.point(b), {units:'kilometers'})*1000;
  return Math.abs(d-804.672) < 0.5;
})()`));

console.log('\n== bus and train stops ==');
check('stop query requests both bus and railway features', window.eval(`(() => {
  const q = HS.overpassTransitStopsQuery();
  return q.includes('highway"="bus_stop') && q.includes('railway"~"^(station|halt|tram_stop)$');
})()`));
check('stop parser classifies bus and train points', window.eval(`(() => {
  const gj = HS.parseTransitStops({elements:[
    {type:'node',id:1,lat:57.04,lon:9.91,tags:{highway:'bus_stop',name:'Test bus'}},
    {type:'node',id:2,lat:57.05,lon:9.92,tags:{railway:'station',name:'Test station'}}
  ]});
  return gj.features.length === 2 && gj.features[0].properties.__stopKind === 'bus' &&
         gj.features[1].properties.__stopKind === 'train';
})()`));

console.log('\n== runtime errors ==');
check('nothing threw during the whole run', errors.length === 0, errors.join(' | '));

console.log(`\n──────────────\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
