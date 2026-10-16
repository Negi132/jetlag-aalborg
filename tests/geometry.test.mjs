import * as turf from '@turf/turf';

const CENTER = [9.9217, 57.0488]; // Aalborg [lng,lat]
let playArea = turf.circle(CENTER, 10, { steps: 256, units: 'kilometers' });

function boolOp(fn, a, b) {
  if (!a || !b) return null;
  try { const r = fn(turf.featureCollection([a, b])); if (r !== undefined) return r; } catch (_) {}
  try { return fn(a, b) || null; } catch (_) { return null; }
}
const gIntersect = (a, b) => boolOp(turf.intersect, a, b);
const gDifference = (a, b) => boolOp(turf.difference, a, b);

function worldRect() {
  const bb = turf.bbox(playArea);
  const d = Math.max(1.5, (bb[2]-bb[0]), (bb[3]-bb[1])) * 2 + 1;
  return turf.polygon([[[bb[0]-d,bb[1]-d],[bb[2]+d,bb[1]-d],[bb[2]+d,bb[3]+d],[bb[0]-d,bb[3]+d],[bb[0]-d,bb[1]-d]]]);
}

function playSpanKm(){
  const bb=turf.bbox(playArea);
  return Math.max(5, turf.distance(turf.point([bb[0],bb[1]]),turf.point([bb[2],bb[3]]),{units:'kilometers'}));
}
function halfPlane(a, b, towardB) {
  const mid = turf.midpoint(turf.point(a), turf.point(b)).geometry.coordinates;
  const brg = turf.bearing(turf.point(a), turf.point(b));
  const L = Math.max(20, playSpanKm() * 1.5);
  const STEPS = 48;
  const dir = towardB ? brg : brg + 180;
  const edge = [];
  for (let i = -STEPS; i <= STEPS; i++) {
    const d = (i / STEPS) * L;
    edge.push(d === 0 ? mid : turf.destination(mid, Math.abs(d), d > 0 ? brg + 90 : brg - 90).geometry.coordinates);
  }
  const far = edge.slice().reverse().map(p => turf.destination(p, L * 2, dir).geometry.coordinates);
  return turf.polygon([[...edge, ...far, edge[0]]]);
}

function voronoiCell(points, i) {
  if (!points.length) return null;
  if (points.length === 1) return turf.clone(playArea);
  const pad = turf.buffer(playArea, 30, { units: 'kilometers' });
  const bbox = turf.bbox(pad || playArea);
  const fcPts = turf.featureCollection(points.map(p => turf.point(p)));
  const cells = turf.voronoi(fcPts, { bbox });
  const cell = cells && cells.features && cells.features[i];
  return cell && cell.geometry ? cell : null;
}

function constraintPolygon(c) {
  const invert = p => gDifference(playArea, p);
  switch (c.type) {
    case 'radar': {
      const circle = turf.circle(c.center, c.radiusM/1000, {steps:180, units:'kilometers'});
      return c.answer === 'yes' ? circle : invert(circle);
    }
    case 'thermometer': return halfPlane(c.a, c.b, c.answer === 'hotter');
    case 'measuring': {
      const r = turf.distance(turf.point(c.seeker), turf.point(c.target), {units:'kilometers'});
      if (r <= 0) return null;
      const circle = turf.circle(c.target, r, {steps:180, units:'kilometers'});
      return c.answer === 'closer' ? circle : invert(circle);
    }
    case 'nearest': {
      if (c.answer === 'unreachable') {
        return invert(turf.circle(c.seeker, c.radiusM/1000, {steps:180, units:'kilometers'}));
      }
      const cell = voronoiCell(c.points, c.index);
      if (!cell) return null;
      let poly = c.answer === 'no' ? invert(cell) : cell;
      if (c.radiusM && c.seeker) {
        poly = gIntersect(poly, turf.circle(c.seeker, c.radiusM/1000, {steps:180, units:'kilometers'}));
      }
      return poly;
    }
    case 'zone': case 'area': {
      const poly = turf.feature(c.geometry);
      return c.answer === 'yes' ? poly : invert(poly);
    }
  }
}

function solve(constraints) {
  let possible = turf.clone(playArea);
  for (const c of constraints) {
    const poly = constraintPolygon(c);
    if (!poly) { console.log('  !! null polygon for', c.type); continue; }
    possible = gIntersect(possible, poly);
    if (!possible) return null;
  }
  return possible;
}

const km2 = f => f ? (turf.area(f)/1e6) : 0;
let pass = 0, fail = 0;
function check(name, cond, extra='') {
  if (cond) { pass++; console.log(`  PASS  ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}
// does the possible-area contain this test point?
const has = (poly, pt) => poly ? turf.booleanPointInPolygon(turf.point(pt), poly) : false;

const seeker = CENTER;
// a hider 2km due east of centre
const hiderE = turf.destination(CENTER, 2, 90).geometry.coordinates;
// a hider 7km due west
const hiderW = turf.destination(CENTER, 7, 270).geometry.coordinates;

console.log('\n== play area ==');
check('circle area ≈ π·10² = 314 km²', Math.abs(km2(playArea) - 314) < 6, `got ${km2(playArea).toFixed(1)}`);

console.log('\n== radar ==');
let r = solve([{type:'radar', center:seeker, radiusM:3000, answer:'yes'}]);
check('YES 3km keeps the 2km-east hider', has(r, hiderE));
check('YES 3km drops the 7km-west hider', !has(r, hiderW));
check('YES 3km area ≈ 28 km²', Math.abs(km2(r) - 28.3) < 1.5, `got ${km2(r).toFixed(1)}`);

r = solve([{type:'radar', center:seeker, radiusM:3000, answer:'no'}]);
check('NO 3km drops the near hider', !has(r, hiderE));
check('NO 3km keeps the far hider', has(r, hiderW));
check('NO 3km area ≈ 314-28 = 286', Math.abs(km2(r) - 285.7) < 3, `got ${km2(r).toFixed(1)}`);

console.log('\n== thermometer ==');
// seeker starts at centre, walks 2km east -> hotter means hider is on the east side
const startP = CENTER;
const endP = turf.destination(CENTER, 2, 90).geometry.coordinates;
r = solve([{type:'thermometer', a:startP, b:endP, answer:'hotter'}]);
check('HOTTER keeps an eastern hider', has(r, turf.destination(CENTER, 5, 90).geometry.coordinates));
check('HOTTER drops a western hider', !has(r, hiderW));
// bisector sits 1km east of centre, so the surviving piece is a circular
// segment: r²·acos(d/r) − d·√(r²−d²) = 137.11 km², not a naive half-circle.
check('HOTTER area matches the analytic segment (137.11)', Math.abs(km2(r) - 137.11) < 0.5, `got ${km2(r).toFixed(2)}`);

r = solve([{type:'thermometer', a:startP, b:endP, answer:'colder'}]);
check('COLDER keeps the western hider', has(r, hiderW));
check('COLDER drops the far-eastern hider', !has(r, turf.destination(CENTER, 5, 90).geometry.coordinates));

// bisector must sit at the midpoint: 1km east of centre
const justEastOfBisector = turf.destination(CENTER, 1.2, 90).geometry.coordinates;
const justWestOfBisector = turf.destination(CENTER, 0.8, 90).geometry.coordinates;
r = solve([{type:'thermometer', a:startP, b:endP, answer:'hotter'}]);
check('bisector sits at the 1km midpoint (east side in)', has(r, justEastOfBisector));
check('bisector sits at the 1km midpoint (west side out)', !has(r, justWestOfBisector));

console.log('\n== measuring ==');
// target 5km north of centre; seeker at centre -> "closer" = within 5km of target
const target = turf.destination(CENTER, 5, 0).geometry.coordinates;
r = solve([{type:'measuring', seeker, target, answer:'closer'}]);
check('CLOSER keeps a point 1km from target', has(r, turf.destination(target, 1, 180).geometry.coordinates));
check('CLOSER drops a point 8km from target', !has(r, turf.destination(target, 8, 180).geometry.coordinates));
r = solve([{type:'measuring', seeker, target, answer:'further'}]);
check('FURTHER drops a point 1km from target', !has(r, turf.destination(target, 1, 180).geometry.coordinates));

console.log('\n== matching (voronoi) ==');
const pA = turf.destination(CENTER, 4, 0).geometry.coordinates;   // north
const pB = turf.destination(CENTER, 4, 180).geometry.coordinates; // south
const pC = turf.destination(CENTER, 6, 90).geometry.coordinates;  // east
r = solve([{type:'nearest', points:[pA,pB,pC], index:0, answer:'yes'}]);
check('match on the north point keeps a northern hider', has(r, turf.destination(CENTER, 5, 0).geometry.coordinates));
check('match on the north point drops a southern hider', !has(r, turf.destination(CENTER, 5, 180).geometry.coordinates));
r = solve([{type:'nearest', points:[pA,pB,pC], index:0, answer:'no'}]);
check('no-match on north drops the northern hider', !has(r, turf.destination(CENTER, 5, 0).geometry.coordinates));
check('no-match on north keeps the southern hider', has(r, turf.destination(CENTER, 5, 180).geometry.coordinates));

console.log('\n== tentacle (voronoi + radius) ==');
r = solve([{type:'nearest', points:[pA,pB,pC], index:0, answer:'yes', radiusM:5000, seeker}]);
check('tentacle keeps a point near A but within 5km of seeker', has(r, turf.destination(CENTER, 4.5, 0).geometry.coordinates));
check('tentacle drops a point near A but 8km out', !has(r, turf.destination(CENTER, 8, 0).geometry.coordinates));
r = solve([{type:'nearest', answer:'unreachable', radiusM:5000, seeker}]);
check('unreachable drops everything within 5km', !has(r, turf.destination(CENTER, 2, 0).geometry.coordinates));
check('unreachable keeps things beyond 5km', has(r, turf.destination(CENTER, 8, 0).geometry.coordinates));

console.log('\n== stacking constraints ==');
const stack = [
  {type:'radar', center:seeker, radiusM:5000, answer:'yes'},
  {type:'thermometer', a:startP, b:endP, answer:'hotter'},
  {type:'measuring', seeker, target, answer:'further'}
];
r = solve(stack);
console.log(`  remaining after 3 questions: ${km2(r).toFixed(1)} km² of ${km2(playArea).toFixed(0)}`);
check('stacked result is smaller than any single one', km2(r) < 78, `got ${km2(r).toFixed(1)}`);
check('stacked result is non-empty', r !== null && km2(r) > 0);

console.log('\n== contradiction detection ==');
r = solve([
  {type:'radar', center:seeker, radiusM:2000, answer:'yes'},
  {type:'radar', center:seeker, radiusM:5000, answer:'no'}
]);
check('impossible pair yields null', r === null);

console.log('\n== fog rendering (difference vs world) ==');
const poss = solve([{type:'radar', center:seeker, radiusM:3000, answer:'yes'}]);
const fog = gDifference(worldRect(), poss);
check('fog polygon exists', !!fog);
check('fog has a hole where the possible area is', !has(fog, seeker));
check('fog covers a far-away point', has(fog, [9.0, 56.0]));

console.log('\n== custom play area (municipality-like polygon) ==');
playArea = turf.polygon([[[9.6,56.9],[10.3,56.9],[10.3,57.3],[9.6,57.3],[9.6,56.9]]]);
r = solve([{type:'radar', center:seeker, radiusM:4000, answer:'no'}]);
check('inverted radar respects a rectangular play area', r && km2(r) > 0 && !has(r, seeker));
check('inverted radar stays inside the play area', !has(r, [11.5, 57.0]));

console.log(`\n──────────────\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
