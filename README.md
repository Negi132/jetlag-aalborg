# Hide + Seek — Aalborg seeker map

A seeker's map for the home version of *Jet Lag: The Game*'s Hide + Seek. You log each answer
the hider gives you; the map shades away everywhere they can't be. The number in the corner is
how many km² are left.

Everything runs in the browser. No build step, no server, no API keys.

---

## Put it on GitHub Pages

1. Create a repo and drop `index.html`, `styles.css`, `app.js` and `data.js` into the root.
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
| **Zone** — "same district as me?" | The district polygon, from any of the four zone levels. |
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

**Every data source in the Layers tab is editable, and every layer is a toggle.** Tap the ⚙ next to
a zone level to change the service URL, layer name or filter — and use **Browse layers** to have the
server list its own layers rather than guessing. Nothing is baked into the code, so a renamed layer
is a ten-second fix on your phone instead of a commit. Your edits travel in the game link.

### The four administrative zone levels

Each level is a **toggle**. Tap once to turn it on, tap again to turn it off — nothing ever stacks a
second copy, and nothing is one-way.

| Level | Shows | Source |
|---|---|---|
| 1 | Byzone (**red**) vs landzone (**green**) | Plandata WFS |
| 2 | Midtbyen, Nørresundby, Vest Aalborg, Øst Aalborg | **built in** (`data.js`) |
| 3 | Hasseris, Vejgård, Gug, Klarup… 31 districts | **built in** (`data.js`) |
| 4 | Land-use areas in the municipality's own colours | Plandata WFS |

**Zones 2 and 3 are now built in and need no network at all.** They are approximations of your
KortInfo layers, and `data.js` explains exactly how they're made:

Rather than hand-trace 31 district outlines from a screenshot — which invents precision that isn't
there — each district is one **centre point**, and the polygons are generated as nearest-centre
territories clipped to the play area. That gets the layout right and leaves only the exact borders
fuzzy, which is the honest version. Zone 2 is the union of those districts by group, so **zones 2 and
3 can never disagree with each other.**

`zones.test.mjs` checks the result against twelve real Aalborg locations — Nytorv, Hasseris Villaby,
Lindholm station, AAU campus, Klarup, Gistrup and so on all land in the district you'd expect.

**To sharpen it:** nudge a coordinate in `data.js`, or delete a district and draw it by hand in the
Layers tab. To regroup, change the `area` number (1–4). Run `node zones.test.mjs` afterwards.

If you ever get the official layer — via KortInfo's Linkgenerator, say — tap **⚙** on the level,
switch the type to WFS, paste the URL and hit **Browse layers on this server**. That reads the
service's own layer list so you never have to guess a `typeName`.

### Zone 1: why landzone was invisible

Plandata's zonekort usually ships only byzone and sommerhus polygons — landzone is Denmark's default
status, so it simply isn't drawn. The app now fills the rest of the play area in as landzone, and
anything it can't classify counts as landzone too. So byzone is red, sommerhusområde orange, and
everything else green, which is what you actually wanted to see. The green backdrop is drawn
underneath so the red city zones stay on top, and landzone is tappable for zone questions.

### The play area

Defaults to the **convex hull of the four play zones** — no more 6-mile circle. It's a three-way
picker in the **Game** tab (four play zones / circle / Aalborg Kommune), so every choice is
reversible. Roughly 310 km², about 20 × 19 km.

Built-in zone layers are clipped to the play area, so they rebuild automatically when you change it.

### Bus and train routes

**NT's own feed needs credentials we don't have**, which is why it kept failing. The routes now come
from **OpenStreetMap via Overpass**, where Aalborg's buses are mapped as route relations carrying the
line number — real geometry, live, no key. Bus routes and train lines are separate toggles, and both
are tappable for the Bus route question.

Two details handled: stops and platforms are stripped out so you get the road the bus drives, not a
scatter of shelters; and the two direction relations per line are folded into one feature, so tapping
"2" gives you the whole line rather than half of it. Two Overpass mirrors are tried in turn.

The NT feed is still there as a third row in case you get access, and the NT route map picture
overlay remains as a visual fallback.

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
node geometry.test.mjs   # 33 checks  — the constraint maths
node ui.test.mjs         # 168 checks — the app, driven headlessly
node zones.test.mjs      # the Aalborg zone data vs. real locations
```

`geometry.test.mjs` checks the maths against analytically known answers: that a "no" radar leaves
exactly the play area minus the circle, that the thermometer bisector lands on the midpoint, that
contradictory answers are detected.

`ui.test.mjs` boots the real `index.html` in a fake DOM and clicks through it — logging a radar,
switching units, selecting a bus route, verifying every entry in the land-use legend, checking that
toggling a layer four times doesn't stack four copies, that a dead Overpass mirror falls through to
the backup, that zone 2 tiles exactly the same ground as zone 3, and that UTM32 coordinates land in
Aalborg rather than the North Sea.

`zones.test.mjs` probes the generated districts with twelve known Aalborg addresses and sanity-checks
the play-area size.

Worth running if you change how a question type works. Both caught real bugs while this was built.
