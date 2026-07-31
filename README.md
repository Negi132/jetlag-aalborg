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

Each level is a toggle and now ships with the exact Aalborg KortInfo WFS source already configured:

| Level | Shows | Default WFS layer |
|---|---|---|
| 1 | Byzone / landzone | `ugis:TL1433667` |
| 2 | Midtbyen, Nørresundby, Vest Aalborg and Øst Aalborg | `ugis:TL445984` |
| 3 | By- and city districts | `ugis:TL445987` |
| 4 | Kommuneplan areas | `ugis:TL445981` |

All four use:

```text
https://drift.kortinfo.net/Wfs.aspx?Site=Aalborg&Page=kortHjemmeside
```

KortInfo commonly replies with GML in UTM zone 32 even when GeoJSON and EPSG:4326 are requested. The
app therefore parses both GeoJSON and GML, reprojects projected coordinates, and corrects reversed
axis order automatically.

### Authoritative defaults and browser caching

The four KortInfo layer IDs are now versioned application defaults, not merely suggested values.
Game links created by older versions are migrated so their saved traced-source configuration cannot
silently replace these defaults. New links can still preserve deliberate source edits made in the
current version.

The visible move, scale, automatic placement and road-snapping controls have been removed. The traced
geometry remains only as an internal startup/outage fallback. Project-owned CSS and JavaScript files
also carry a build query string in `index.html`, forcing browsers and GitHub Pages to request the
updated assets after deployment.

### The default play area

The default play area is no longer based on a manually scaled screenshot outline. It is rebuilt from
Zone 2 by identifying and merging every polygon part belonging to these four named areas:

- Midtbyen
- Nørresundby
- Vest Aalborg
- Øst Aalborg

That merge is an exact geometric union, not a convex hull, so concave edges and separated polygon
parts are retained. The app loads Zone 2 quietly after first paint and replaces the temporary
fallback as soon as KortInfo answers. Loading or reloading Zone 2 later also rebuilds the play area,
provided the **four zones** play-area mode is selected.

The name matcher searches every scalar WFS property and tolerates differences such as `Øst Aalborg`
versus `Aalborg Øst`, so the play area does not depend on one undocumented KortInfo field name.

### Zone 3 names

KortInfo's Zone 3 response can contain both the four parent Zone 2 names and the actual district name.
The app now examines the whole layer and selects the label field with district-level variety instead
of blindly taking the first property called `navn`. A field that contains only Midtbyen,
Nørresundby, Vest Aalborg and Øst Aalborg is explicitly rejected as a Zone 3 label source.

### Zone 4 catch-all

Zone 4 now includes a synthetic category **X · Uden kommuneplanramme**. It is used both for official
features whose land-use category cannot be recognised and for the part of the current play area that
is not covered by any Zone 4 polygon. The X area is coloured, shown in the legend, labelled on tap,
and can be selected in a zone question like every official area.

### Offline fallback

The traced Zone 2 and Zone 3 geometry remains in `data.js` only so the site still starts when the
municipal WFS is unavailable. The **Official zones & fallback** panel can retry the official Zone 2
source. No placement or scaling controls are exposed because official WFS geometry already has real
coordinates.

The fallback boundary network is stored as shared arcs, with corner-aware smoothing applied once per
arc before the same coordinates are handed to both neighbouring areas. That keeps the fallback free
of seams while preserving genuine corners.

### Zone 1: filling implicit landzone

Zone services sometimes publish only explicit byzone and sommerhus polygons because landzone is the
default status. When that happens, the app fills the remainder of the current play area as landzone.
Byzone remains red, sommerhusområde orange, and the implicit landzone green; the backdrop is drawn
underneath the explicit polygons and remains tappable for zone questions.

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
node geometry.test.mjs   # constraint maths
node ui.test.mjs         # the full app, driven headlessly
```

`geometry.test.mjs` checks the maths against analytically known answers: that a "no" radar leaves
exactly the play area minus the circle, that the thermometer bisector lands on the midpoint, that
contradictory answers are detected.

`ui.test.mjs` boots the real `index.html` in a fake DOM and clicks through it — logging a radar,
switching units, selecting a bus route, verifying every entry in the land-use legend, checking that
toggling a layer four times doesn't stack four copies, that a dead Overpass mirror falls through to
the backup, that zone 2 tiles exactly the same ground as zone 3, and that UTM32 coordinates land in
Aalborg rather than the North Sea.

The zone tests check the traced fallback structurally and also verify the four shipped KortInfo
layer IDs, the generated Zone 2 WFS request, tolerant matching of the four official area names, and
canonical assignment of area numbers 1–4. The fallback calibration tests remain because that geometry
is still used when KortInfo is unavailable.

Worth running if you change how a question type works. Both caught real bugs while this was built.
