// Two simulated phones sharing a map through a fake ntfy.sh relay.
import { bootApp, reporter } from './harness.mjs';
import { createRelay } from './fake-relay.mjs';

const { check, finish } = reporter();
const relay = createRelay();
const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const MI = 1609.344;

function phone(url, setup = null) {
  const app = bootApp({ url, beforeScripts: (w) => { relay.install(w); if (setup) setup(w); } });
  const ev = (code) => app.window.eval(code);
  const copied = [];
  app.window.navigator.clipboard = { writeText: async (text) => { copied.push(text); } };
  return {
    ...app, ev, copied,
    area: () => ev('(() => { const r = HS.solveCurrentArea(); return r.possible ? turf.area(r.possible) : 0; })()'),
    count: () => ev('HS.S.constraints.length'),
    dot: (id) => app.$(id).classList.contains('has-dot'),
    toastText: () => app.$('#toast').textContent,
    async play(type, card, taps, answer = 0) {
      const { doc, $, click } = app;
      const back = $('#toolForm .question-back');
      if (!$('#toolForm').hidden && back) click(back);
      click(doc.querySelector('[data-tab="ask"]'));
      click([...doc.querySelectorAll('[data-question-type][data-card]')]
        .find((b) => b.dataset.questionType === type && b.dataset.card === card));
      await wait(150);
      for (const [lat, lng] of taps) ev(`HS.map.fire('click', { latlng: L.latLng(${lat}, ${lng}) })`);
      await wait();
      const seg = [...doc.querySelectorAll('#toolForm .seg button')];
      if (seg[answer]) click(seg[answer]);
      await wait();
      const log = [...doc.querySelectorAll('#toolForm .solid-btn')].find((b) => /Log/.test(b.textContent));
      if (log && !log.disabled) click(log);
      await wait();
    }
  };
}

console.log('\n== starting a shared map ==');
const A = phone('https://example.github.io/hideseek/');
check('phone A boots without errors', A.errors.length === 0, A.errors.join(' | '));
check('map share buttons are hidden outside a shared map', A.$('#shareActions').hidden);
A.click(A.doc.querySelector('[data-tab="game"]'));
const startBtn = [...A.doc.querySelectorAll('#shareControls button')].find((b) => /Start a shared map/.test(b.textContent));
check('Game tab offers "Start a shared map"', !!startBtn);
A.click(startBtn);
await wait(150);
const room = A.ev('HS.share.room');
const topic = `jetlag-aalborg-${room}`;
check('a 16-character room code is created', /^[a-z0-9]{16}$/.test(room || ''), room);
check('the room is in the address', new URL(A.window.location.href).searchParams.get('room') === room);
check('the map buttons appear', !A.$('#shareActions').hidden);
check('starting posts the current map', relay.posts(topic).length === 1);
check('the invite link is copied, naming the city', A.copied.some((t) => t.endsWith(`?city=aalborg&room=${room}`)), A.copied.join(' '));
check('the Game tab shows the invite link to copy by hand', A.$('#shareInviteLink').value.endsWith(`?city=aalborg&room=${room}`));
A.window.navigator.clipboard = { writeText: async () => { throw new Error('blocked'); } };
A.click([...A.doc.querySelectorAll('#shareControls button')].find((b) => /Invite/.test(b.textContent)));
await wait();
check('if the clipboard is blocked, it points to the link instead of failing',
      /Game tab/.test(A.$('#toast').textContent) && A.errors.length === 0, A.$('#toast').textContent);
A.window.navigator.clipboard = { writeText: async (text) => { A.copied.push(text); } };

console.log('\n== logging and posting ==');
await A.play('radar', '3 miles', [[57.0488, 9.9217]]);
await A.play('measuring', 'Body of water', [[57.04, 9.93]], 1);
await A.play('matching', '2nd zone', [[57.0488, 9.9217]]);
await A.play('matching', 'Park', [[57.04, 9.93]]);
await A.play('measuring', '1st zone border', [[57.04, 9.93]]);
check('phone A logged five answers', A.count() === 5);
check('Post shows a dot for unposted answers', A.dot('#postMapBtn'));
check('logging alone posts nothing', relay.posts(topic).length === 1);
A.click(A.$('#postMapBtn'));
await wait(150);
check('Post sends the map', relay.posts(topic).length === 2);
check('the Post dot clears after posting', !A.dot('#postMapBtn'));
const posted = relay.posts(topic)[1].message;
check('a five-answer map fits one ntfy message (under 4 KB)', posted.length < 4096, `${posted.length} characters`);
check('posts are compressed shared-map messages', posted.startsWith('HS1.'));

console.log('\n== joining through the invite ==');
const B = phone(`https://example.github.io/hideseek/?city=aalborg&room=${room}`);
await wait(400);
check('phone B boots without errors', B.errors.length === 0, B.errors.join(' | '));
check('opening the invite joins the room', B.ev('HS.share.room') === room && !B.$('#shareActions').hidden);
check('a fresh phone loads the shared map straight away', B.count() === 5, `${B.count()} answers`);
check('both phones show exactly the same remaining area', Math.abs(A.area() - B.area()) < 1, `${A.area().toFixed(0)} vs ${B.area().toFixed(0)} m²`);
check('nothing is flagged on phone B', !B.dot('#pullMapBtn') && !B.dot('#postMapBtn'));

console.log('\n== nothing changes by itself ==');
await B.play('thermometer', '3 miles', [[57.03, 9.95]]);
B.click(B.$('#postMapBtn'));
await wait(200);
check('phone B posted its new answer', relay.posts(topic).length === 3);
check('phone A is told a newer map exists', A.dot('#pullMapBtn'));
check('…but phone A keeps its own map until it asks', A.count() === 5);
A.click(A.$('#pullMapBtn'));
await wait(200);
check('Get latest loads the shared map', A.count() === 6 && Math.abs(A.area() - B.area()) < 1);
check('the Get latest dot clears', !A.dot('#pullMapBtn') && !A.dot('#postMapBtn'));

console.log('\n== protecting other seekers’ answers ==');
await B.play('radar', '1 mile', [[57.035, 9.93]], 1);
B.click(B.$('#postMapBtn'));
await wait(200);
await A.play('radar', '½ mile', [[57.06, 9.92]]);
let asked = '';
A.window.confirm = (text) => { asked = text; return false; };
A.click(A.$('#postMapBtn'));
await wait(150);
check('posting over a newer map asks first', /newer map/.test(asked), asked);
check('declining keeps the other seeker’s post', relay.posts(topic).length === 4);
asked = '';
A.click(A.$('#pullMapBtn'));
await wait(150);
check('getting the latest with unposted answers asks first', /not posted/.test(asked), asked);
check('declining keeps this phone’s answers', A.count() === 7);
A.window.confirm = () => true;
A.click(A.$('#pullMapBtn'));
await wait(200);
check('accepting replaces them with the shared map', A.count() === 7 && Math.abs(A.area() - B.area()) < 1);

console.log('\n== personal settings stay personal ==');
A.click(A.doc.querySelector('[data-tab="game"]'));
A.click(A.doc.querySelector('#unitSeg [data-units="metric"]'));
A.click(A.$('#postMapBtn'));
await wait(200);
B.click(B.$('#pullMapBtn'));
await wait(200);
check('units are not shared', A.ev('HS.S.units') === 'metric' && B.ev('HS.S.units') === 'imperial');

console.log('\n== different map data ==');
{
  const body = await A.window.eval(`HS.encodeSharedGame(Object.assign({}, { data: 'old/old/old', posted: Date.now(),
    playAreaMeta: { type: 'zones' }, constraints: HS.serialize().constraints }))`);
  await A.window.fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body });
  await wait(100);
  B.click(B.$('#pullMapBtn'));
  await wait(200);
  check('a map from different data loads but warns', /different map data/.test(B.toastText()), B.toastText());
}

console.log('\n== leaving ==');
B.click(B.doc.querySelector('[data-tab="game"]'));
B.window.confirm = () => true;
const leave = [...B.doc.querySelectorAll('#shareControls button')].find((b) => /Leave/.test(b.textContent));
B.click(leave);
await wait();
check('leaving hides the map buttons', B.$('#shareActions').hidden && B.ev('HS.share.room') === null);
check('leaving removes the room from the address', !new URL(B.window.location.href).searchParams.get('room'));
check('answers stay on the phone after leaving', B.count() === 7);
check('the round trip of a compressed map is exact', await A.window.eval(`(async () => {
  const game = { data: HS.mapDataVersion(), posted: 1, playAreaMeta: { type: 'zones' }, constraints: HS.serialize().constraints };
  const back = await HS.decodeSharedGame(await HS.encodeSharedGame(game));
  return JSON.stringify(back) === JSON.stringify(game);
})()`));

console.log('\n== reopening without the game ==');
{
  // A phone that reopens from a home-screen icon comes back with an empty map
  // but remembers the room. It must not offer to post that empty map.
  const saved = { room, appliedId: relay.posts(topic).at(-1).id, signature: 'c1:1|c2:1' };
  const C = phone('https://example.github.io/hideseek/', (w) => {
    w.localStorage.setItem('hs-share-room', room);
    w.localStorage.setItem('hs-share-sync', JSON.stringify(saved));
  });
  await wait(200);
  check('a reopened phone rejoins its room from last time', C.ev('HS.share.room') === room);
  check('an empty reopened map is not offered for posting', C.count() === 0 && !C.dot('#postMapBtn'));
  check('…and Get latest is flagged instead', C.dot('#pullMapBtn'));
  let asked = '';
  C.window.confirm = (text) => { asked = text; return false; };
  const before = relay.posts(topic).length;
  C.click(C.$('#postMapBtn'));
  await wait(150);
  check('posting an empty map asks first', /no answers/.test(asked) && relay.posts(topic).length === before, asked);
  C.window.confirm = () => true;
  C.click(C.$('#pullMapBtn'));
  await wait(200);
  check('Get latest restores the shared map', C.count() === 7 && !C.dot('#pullMapBtn'));
}

console.log('\n== another city ==');
{
  const before = A.count();
  const body = await A.window.eval(`HS.encodeSharedGame({ city: 'aarhus', data: HS.mapDataVersion(), posted: Date.now(),
    playAreaMeta: { type: 'zones' }, constraints: [] })`);
  await A.window.fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body });
  await wait(100);
  A.click(A.$('#pullMapBtn'));
  await wait(200);
  check('a map from another city is refused', A.count() === before && /map of aarhus/i.test(A.toastText()), A.toastText());
}

check('nothing threw on either phone', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].join(' | '));
finish();
