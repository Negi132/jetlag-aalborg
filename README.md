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

Each level is a **toggle** — tap on, tap off, never duplicated.

| Level | Shows | Source |
|---|---|---|
| 1 | Byzone **red** vs landzone **green** | Plandata WFS |
| 2 | Midtbyen, Nørresundby, Vest and Øst Aalborg | traced (`data.js`) |
| 3 | 30 city districts | traced (`data.js`) |
| 4 | Land-use areas in the municipality's colours | Plandata WFS |

### How zones 2 and 3 were made

The outlines are **traced from your screenshots**, not approximated. The images were processed
directly: boundary lines isolated by colour, the regions between them followed, each outline turned
into a polygon. Zone 2 came out as exactly 4 regions, zone 3 as 30.

**Seamless boundaries.** Pixel tracing and vector simplification can leave tiny enclosed slivers
where independently traced rings almost—but do not quite—meet. When the app builds either level,
it converts all regions into one partition: overlaps are clipped once, enclosed slivers are filled,
and each repaired piece is assigned to the nearest original boundary. The four Zone 2 areas and all
30 Zone 3 districts therefore cover their shared outline without visible cracks or double-owned
strips. Names and zone IDs are preserved.

**Names** come from the screenshot's own red labels: each label was located in the image, read, and
matched to the polygon containing it. 27 of 30 districts are named this way, which is why Skalborg
is now Skalborg. Three are still generic — those sit on the crop edge (Klarup, Storvorde, Stae and
Langholt run off the side of the screenshot, so their districts merged into the background). Use
**Rename a district** in the Layers tab to fix any of them: tap the button, tap the district. Names
are cosmetic — a zone question always uses the polygon, so a wrong label still answers correctly.

### Placing the zones — roads and shoreline

You were right that the boundaries follow real features. The automatic calibration now uses both
the **Limfjord shoreline** and OpenStreetMap linework for main roads, railways and waterways.
Shoreline vertices provide the reliable coarse placement; non-coastal district edges then provide
a robust refinement against nearby transport and water corridors.

> **Layers → Calibrate zones → Fit to roads + coastline automatically**

The first pass searches position and uniform scale against the shoreline. The second pass can also
correct a small X/Y aspect-ratio error and rotation, which a screenshot crop or resize can introduce.
It deliberately fits only a robust subset of district-edge samples, because not every administrative
boundary follows a mapped road. The status line reports approximate shoreline and road-boundary
errors afterwards so you can judge the result.

The transformation is anchored at Midtbyen, and one calibration fixes both zone levels because both
screenshots share the same pixel coordinate system. It is also stored in the game link. The manual
Nytorv pin, scale slider and fine-nudge controls remain available when OpenStreetMap coverage is
incomplete or a local boundary does not follow a mapped feature.

This improves the global alignment; it does not redraw every district edge independently. A boundary
that was imprecise in the source screenshot, or that follows an unmapped/local feature, may still need
a later source-data correction.

### The play area

The union of the four play zones — their actual outline, concave bays and all, not a convex hull.
It's one option in the **Game** tab picker (four play zones / circle / Aalborg Kommune), so it's
always reversible. It re-derives itself whenever you recalibrate.

### Zone 1: why landzone was invisible

Plandata's zonekort usually ships only byzone and sommerhus polygons — landzone is Denmark's default
status, so it simply isn't drawn. The app now fills the rest of the play area in as landzone, and
anything it can't classify counts as landzone too. So byzone is red, sommerhusområde orange, and
everything else green, which is what you actually wanted to see. The green backdrop is drawn
underneath so the red city zones stay on top, and landzone is tappable for zone questions.

### The play area

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
node ui.test.mjs         # 194 checks — the app, driven headlessly
```

`geometry.test.mjs` checks the maths against analytically known answers: that a "no" radar leaves
exactly the play area minus the circle, that the thermometer bisector lands on the midpoint, that
contradictory answers are detected.

`ui.test.mjs` boots the real `index.html` in a fake DOM and clicks through it — logging a radar,
switching units, selecting a bus route, verifying every entry in the land-use legend, checking that
toggling a layer four times doesn't stack four copies, that a dead Overpass mirror falls through to
the backup, that zone 2 tiles exactly the same ground as zone 3, and that UTM32 coordinates land in
Aalborg rather than the North Sea.

The zone tests check the traced outlines structurally: four areas in zone 2 with Midtbyen smallest
and Nørresundby northernmost, Vest west of Øst, the play area concave rather than a hull, and
calibration moving and scaling the zones while keeping the centre pin fixed.

Worth running if you change how a question type works. Both caught real bugs while this was built.
