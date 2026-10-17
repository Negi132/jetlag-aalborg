/* =============================================================
   Hide + Seek — boot loader
   Picks the city, then loads its settings (cities/<id>/city.json),
   its map data and app.js, in that order. Every city has the same
   set of data files in its own folder.
   ============================================================= */

(function () {
  'use strict';

  // Bump with any change to app.js, a city.json or this file, together with
  // boot.js?v= in index.html (the data test checks they match).
  const BUILD = '20261018c-cities';

  /* Every city the site can be played in. `data` versions that city's data
     files; bump it when they are changed by hand. */
  const CITIES = {
    aalborg: { name: 'Aalborg', data: '20261018c-cities' }
  };
  const DEFAULT_CITY = 'aalborg';

  // Loaded in this order before app.js. A missing file is tolerated: the app
  // falls back to live services for whatever it lacks.
  const DATA_FILES = [
    'zone2-fallback.js', 'kommune-outline.js', 'bus-routes.js', 'transit-data.js',
    'poi-data.js', 'hydro-data.js', 'zone-data.js'
  ];

  const known = (id) => Object.prototype.hasOwnProperty.call(CITIES, id);
  function pickCity() {
    let id = null;
    try { id = new URLSearchParams(location.search).get('city'); } catch (_) { /* old browser */ }
    if (!id || !known(String(id).toLowerCase())) {
      try { id = localStorage.getItem('hs-city'); } catch (_) { id = null; }
    }
    id = String(id || '').toLowerCase();
    return known(id) ? id : DEFAULT_CITY;
  }

  const city = pickCity();
  const dir = `cities/${city}/`;
  const boot = window.HS_BOOT = {
    build: BUILD,
    city,
    defaultCity: DEFAULT_CITY,
    cities: Object.keys(CITIES).map((id) => ({ id, name: CITIES[id].name })),
    config: `${dir}city.json?v=${BUILD}`,
    data: DATA_FILES.map((f) => `${dir}${f}?v=${CITIES[city].data}`),
    app: `app.js?v=${BUILD}`
  };

  // The tests load these files themselves.
  if (window.HS_BOOT_MANUAL) return;

  const add = (src) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;   // run in the order added, after the ones before
    document.body.appendChild(s);
  };
  boot.data.forEach(add);
  // Added scripts, unlike <script> tags, do not wait for stylesheets, and the
  // app measures the map as it starts. A stylesheet that fails still counts.
  const styled = Promise.all(Array.from(document.querySelectorAll('link[rel="stylesheet"]'), (link) =>
    (link.sheet ? null : new Promise((done) => {
      link.addEventListener('load', done);
      link.addEventListener('error', done);
    }))));
  const settings = fetch(boot.config).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  Promise.all([settings, styled])
    .then(([city]) => {
      window.HS_CITY = city;
      add(boot.app);
    })
    .catch((err) => {
      console.error('City settings failed to load:', err);
      const t = document.getElementById('toast');
      if (t) {
        t.textContent = `Could not load the ${CITIES[city].name} settings. Check your connection and reload.`;
        t.classList.add('is-bad');
        t.hidden = false;
      }
    });
})();
