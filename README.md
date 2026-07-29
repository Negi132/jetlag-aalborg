# Hide + Seek — Aalborg seeker map

A seeker's map for the home version of *Jet Lag: The Game*'s Hide + Seek. You log each answer
the hider gives you; the map shades away everywhere they can't be. The number in the corner is
how many km² are left.

Everything runs in the browser. No build step, no server, no API keys.

---

## Put it on GitHub Pages

1. Create a repo and drop `index.html`, `styles.css`, `app.js` into the root.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait a minute. It's live at `https://<you>.github.io/<repo>/`.

Add it to your phone's home screen before game day — it's built for one-handed use on a bus.

---

## About Google Maps

You asked for Google Maps, and it's worth being straight about why this doesn't use it.

- **The API key problem.** GitHub Pages serves static public files, so a Maps API key is
  visible to anyone who views source. You can restrict it by HTTP referrer and cap the billing,
  but it's a key on a public page tied to a billing account.
- **Google's terms don't permit its tiles in Leaflet**, so you'd have to rewrite the whole
  rendering layer against the Maps JS API — a different polygon API, different overlay panes,
  different event model.
- **You'd lose nothing visually.** The satellite layer here is Esri's imagery, which is
  comparable, and the default "Plain" basemap is deliberately low-contrast so the shaded
  areas actually read.

All the geometry is done with [Turf.js](https://turfjs.org/) and is completely independent of
the basemap, so if you later decide you want Google, only the drawing code changes. Three
basemaps ship in the **Game** tab: Plain, Streets, Satellite.

---

## How each question narrows the map

Every answer becomes a polygon of *places the hider could still be*. They all get intersected
together, and whatever survives is the bright area.

| Question | What gets drawn |
|---|---|
| **Radar** — "are you within ___ of me?" | A circle. *Yes* keeps the inside, *no* keeps the outside. |
| **Bus route** — "will my bus stop at your station?" | A corridor along the selected route. Default is ¼ mile either side, since the hider has to be at a stop, not on the tarmac. |
| **Thermometer** — "after travelling ___, am I hotter or colder?" | The perpendicular bisector between your start and end point. *Hotter* keeps the half nearer the end point. |
| **Measuring** — "compared to me, are you closer to or further from ___?" | A circle centred on the thing, with a radius equal to *your* distance from it. |
| **Matching** — "is your nearest ___ the same as mine?" | Drop a pin on every candidate in the play area and tap the one nearest you. The map splits into nearest-point territories; you keep yours, or everything but yours. |
| **Tentacles** | Same as matching, plus a radius limit around you. Also handles "not within reach". |
| **Zone** | Same district / parish / postal code as you — one tap on a loaded zone layer. |
| **Free shape** | Draw anything by hand. This is your catch-all for photo clues, sightlines, and hunches. |

**Units.** The app defaults to feet and miles to match the US deck. Radar presets are the deck's
own values — 250 / 500 / 1000 / 1500 ft, then ¼, ½, 1, 3 and 5 miles — and the area readout is in
mi². There's a metric toggle in the **Game** tab if you ever play with a European deck; it converts
everything already logged, because distances are stored in metres internally and only formatted on
the way out.

Two things worth knowing:

- **Muting beats deleting.** Each logged answer has a ◉ toggle. If the map goes black — meaning
  no area is left — one of your answers is wrong. Mute them one at a time to find the culprit
  instead of starting over.
- **Measuring works on point features.** For coastlines, the Limfjord, and administrative
  borders, draw a free shape instead; a single pin can't represent a line.

---

## Zones and routes

**Every data source in the Layers tab is editable.** Tap the ⚙ next to a zone level to change the
service URL, layer name or filter. Nothing is baked into the code, so when a layer gets renamed you
fix it on your phone in ten seconds instead of pushing a commit. Your edits travel in the game link.

### The four administrative zone levels

Your KortInfo layers come from Aalborg's own WebGIS, which needs a per-site generated link and
the administrator's permission to expose data as a service — so it can't be hard-coded. Three of
the four are national planning themes available from **Plandata.dk**, which is preconfigured:

| Level | Your KortInfo layer | Preconfigured source |
|---|---|---|
| 1 | Zonekort (By / Land) | Plandata `theme_pdk_zonekort_samlet_v`, filtered `komnr=851` |
| 2 | Kommuneplanområder | Plandata `theme_pdk_kommuneplanomraade_vedtaget_v` |
| 3 | By- og bydele | **Not configured** — Aalborg-only, no national feed |
| 4 | Kommuneplanrammer | Plandata `theme_pdk_kommuneplanramme_alle_vedtaget_v` |

Level 4 is the one I could confirm exists by that exact name. **Levels 1 and 2 are educated
guesses** — if they fail, the app tells you so and you correct the `typeName` behind the ⚙. You can
list the real names by opening
`https://geoserver.plandata.dk/geoserver/wfs?request=GetCapabilities` and searching for `zonekort`.

For **level 3**, the reliable options are: generate a WFS link from KortInfo's own Linkgenerator and
paste it in, or draw the districts by hand once and export the GeoJSON into the repo. Once drawn,
it's yours forever.

Coordinates get normalised on arrival. Plandata publishes in UTM zone 32, and some services return
lat/lng in the wrong order — both would silently drop your zones in the North Sea, so the app
detects and fixes each case, then tells you it did.

### Bus and train routes

NT's route map runs on GC2, which exposes every layer over SQL and WMS. The Layers tab loads six
route sets — city, regional, X Bus, local, telebus and trains — as **tappable lines**. Tap a route
while the Bus route question is open and it becomes a corridor.

If the vector feed doesn't respond, turn on the **NT route map picture overlay** in the same tab.
You'll still see every route on the map and can trace the one you're on by hand — the Bus route
question has a "trace by hand" button for exactly this.

### Also available

Dataforsyningen postal districts, parishes and the municipality outline are still there via the
Aalborg Kommune boundary button and by pasting these into any zone slot:

```
https://api.dataforsyningen.dk/postnumre?kommunekode=851&format=geojson&landpostnumre
https://api.dataforsyningen.dk/sogne?kommunekode=851&format=geojson
```

---

## Sharing a game

The full game state lives in the URL. Every answer you log rewrites it, so:

- **Refresh-safe** — reloading doesn't lose your game.
- **Copy game link** hands your co-seeker the identical map.
- **Export / Import** writes a JSON file for a game you want to keep.

Nothing is sent anywhere. There's no backend.

---

## Tweaking it

The top of `app.js`:

```js
const CONFIG = { center: [57.0488, 9.9217], zoom: 12, playRadiusMi: 6, komnr: 851 };

const RADAR_PRESETS = [ { label: '250 ft', m: 250 * FT }, … ];
const DEFAULT_SOURCES = { zone1: {…}, zone2: {…}, zone3: {…}, zone4: {…} };
const ROUTE_SOURCES  = { bybus: {…}, regionalbus: {…}, … };
```

Distances are stored in metres everywhere and formatted on the way out, so changing units never
changes a result. `RADAR_PRESETS` carries an explicit label per value — that's why a 1500 ft radar
shows as "1500 ft" and not "0.28 mi".

Colours are CSS custom properties at the top of `styles.css`.

A live game is on `window.HS` if you want to poke at it from the console:

```js
HS.S.constraints          // everything you've logged
HS.addZoneLayer('Bus zones', myGeoJSON)
HS.setCircularPlayArea(HS.map.getCenter(), 4)
```

---

## Tests

```
npm install @turf/turf@7.2.0 leaflet@1.9.4 proj4@2.11.0 jsdom
node geometry.test.mjs   # 33 checks — the constraint maths
node ui.test.mjs         # 72 checks — the app, driven headlessly
```

`geometry.test.mjs` checks the maths against analytically known answers: that a "no" radar leaves
exactly the play area minus the circle, that the thermometer bisector lands on the midpoint, that
contradictory answers are detected.

`ui.test.mjs` boots the real `index.html` in a fake DOM and clicks through it — logging a radar,
switching units, selecting a bus route, checking that UTM32 coordinates land in Aalborg.

Worth running if you change how a question type works. Both caught real bugs while this was built.
