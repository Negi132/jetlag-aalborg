/* Checks the approximate Aalborg zone data in data.js against real
   locations. Run this after nudging any district coordinates.
   Needs: npm install @turf/turf@7.2.0 */
import * as turf from '@turf/turf';
import fs from 'fs';

const src = fs.readFileSync(new URL('./data.js', import.meta.url), 'utf8');
const AREAS = eval('(' + src.match(/const AALBORG_AREAS = (\{[\s\S]*?\});/)[1].replace(/;$/,'') + ')');
const D = eval('(' + src.match(/const AALBORG_DISTRICTS = (\[[\s\S]*?\n\]);/)[1] + ')');
const PAD = 2.2;
const pts = D.map(([n,la,ln,a])=>turf.point([ln,la],{navn:n,area:a}));
const hull = turf.buffer(turf.convex(turf.featureCollection(pts)), PAD, {units:'kilometers'});
console.log(`districts: ${D.length}`);
console.log(`hull area: ${(turf.area(hull)/1e6).toFixed(0)} km2  (Aalborg Kommune is 1140 km2)`);
const bb = turf.bbox(hull);
console.log(`extent: ${turf.distance(turf.point([bb[0],bb[1]]),turf.point([bb[2],bb[1]])).toFixed(1)} km E-W x ${turf.distance(turf.point([bb[0],bb[1]]),turf.point([bb[0],bb[3]])).toFixed(1)} km N-S`);

const cells = turf.voronoi(turf.featureCollection(pts), {bbox: turf.bbox(turf.buffer(hull,12,{units:'kilometers'}))});
const zones = cells.features.map((c,i)=>{ if(!c) return null;
  let z=null; try{ z=turf.intersect(turf.featureCollection([c,hull])); }catch(e){}
  if(z) z.properties = pts[i].properties; return z; }).filter(Boolean);

// do well-known Aalborg spots land in the right district?
const probes = [
  ['Nytorv (city centre)',        57.0480, 9.9200, 'Aalborg Midtby'],
  ['Aalborg station',             57.0430, 9.9165, 'Aalborg Midtby'],
  ['Haraldslund, Vestbyen',       57.0505, 9.9000, 'Vestbyen'],
  ['Hasseris Villaby',            57.0395, 9.8870, 'Hasseris'],
  ['Nørresundby centre',          57.0585, 9.9250, 'Nørresundby Midtby'],
  ['Lindholm station',            57.0705, 9.8955, 'Lindholm'],
  ['AAU campus',                  57.0155, 9.9770, 'Universitetsområdet'],
  ['Gug church',                  57.0135, 9.9330, 'Gug'],
  ['Klarup',                      57.0100, 10.0500,'Klarup'],
  ['Gistrup',                     56.9910, 10.0140,'Gistrup'],
  ['Skalborg',                    57.0160, 9.8850, 'Skalborg'],
  ['Vejgaard Torv',               57.0440, 9.9470, 'Vejgård'],
];
let ok=0;
for (const [label,la,ln,want] of probes){
  const hit = zones.find(z=>turf.booleanPointInPolygon(turf.point([ln,la]), z));
  const got = hit? hit.properties.navn : '(outside)';
  const good = got===want; ok+=good?1:0;
  console.log(`${good?'ok  ':'DIFF'} ${label.padEnd(24)} -> ${got}`);
}
console.log(`\n${ok}/${probes.length} probes land in the expected district`);
let bad = probes.length - ok;
if (turf.area(hull)/1e6 < 150 || turf.area(hull)/1e6 > 700) {
  console.log('WARN hull area looks wrong for greater Aalborg'); bad++;
}

// area coverage
for (const k of Object.keys(AREAS)){
  const mine = zones.filter(z=>String(z.properties.area)===k);
  let u=mine[0]; for(let i=1;i<mine.length;i++){ try{u=turf.union(turf.featureCollection([u,mine[i]]))||u;}catch(e){} }
  console.log(`area ${k} ${AREAS[k].name.padEnd(14)} ${mine.length} districts, ${(turf.area(u)/1e6).toFixed(0)} km2`);
}

process.exit(bad ? 1 : 0);
