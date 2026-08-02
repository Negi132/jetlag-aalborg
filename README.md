# Hide + Seek — Aalborg seeker map

A seeker's map for the home version of *Jet Lag: The Game*'s Hide + Seek. You log each answer
the hider gives you; the map shades away everywhere they can't be. The number in the corner is
how many km² are left.

Everything runs in the browser. No build step, no server, no API keys.

---

### Temporary zone layers and movable question previews

Zone layers that are opened automatically by a Matching or Measuring card are temporary: closing, cancelling, switching, or logging that question hides the layer again unless you had already enabled it yourself in **Layers**. This keeps the map clear between questions.

Radar centres, both Thermometer endpoints, and the point used by zone-border Measuring are movable while the question remains open. Radar and border-distance points can still be repositioned by tapping the map; all three workflows also expose draggable handles, so a mistaken placement never requires closing and reopening the card.


## Put it on GitHub Pages

1. Create a repo and drop `index.html`, `styles.css`, `app.js` and `data.js` into the root.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait a minute. It's live at `https://<you>.github.io/<repo>/`.

Add it to your phone's home screen before game day — it's built for one-handed use on a bus.

On first load, the map requests device-location permission and displays a blue position marker with
an accuracy circle. The marker follows the device while the page is open. It is display-only: the
coordinate is not saved, shared, or used automatically by any question. The location button simply
recentres the map on the latest reading.

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

## Small-game question deck

The **Ask** tab is organised like the small version's physical question deck rather than as a list
of geometry tools. Each of the six question types shows its card cost, time limit, example wording,
and the available cards:

- **Matching** and **Measuring** open their existing map workflows with the selected subject filled in.
- **Thermometer** provides the ½-mile and 3-mile cards and records the card's minimum-travel rule.
- **Radar** provides ¼, ½, 1, 3, 5, 10, 25, 50 and 100 miles plus a Custom card.
- **Tentacles** remains visible with its full rule, but is deliberately disabled because it belongs
  only to medium and large games.
- **Photos** contains all six small-game prompts and their framing instructions. Logging a photo
  records the question without changing the possible map area.

On phones, the deck uses one-column touch targets, a tall bottom sheet, and sticky answer controls.
All six question families start collapsed; returning to Ask with no active draft returns to that clean
collapsed view.

**Post-game usability fixes.** Custom Radar distances use a mobile-friendly decimal text field rather
than a native number field. Both `0.5` and `0,5` are accepted, and the live Radar circle updates while
you type. Matching cards for the four administrative zone levels now use the official zone polygons
directly: tap where you asked from, choose Match / No match, and the map previews the corresponding
cut. The Landmass Matching card behaves the same way using the Limfjord as Aalborg's practical split
between Nørresundby and the play area south of the fjord.

**Zone-aware question loading.** Choosing an administrative-zone Matching card now turns the relevant
official zone layer on immediately. Zone downloads show an indeterminate loading bar on the map as
well as a busy state in Layers, which is especially useful for the larger Zone 1 and Zone 4 datasets.
Landmass Matching draws the Nørresundby/north and Aalborg/south sides directly on the map even though
it is not an administrative layer.

The Measuring cards for **1st zone border** and **2nd zone border** also load and display the relevant
zone layer immediately. Tap where the question was asked: the app measures that point's distance to
the nearest border and draws a cyan band of that width around *every* border at that level. Before an
answer is selected it shows how much of the currently possible area Closer versus Further would keep;
selecting the answer then uses the normal grey-out preview, and Log answer commits that exact band cut.

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
| **Matching** — "is your nearest ___ the same as mine?" | Point-based cards use nearest-point territories. Administrative-zone cards instead select your containing official zone directly, and Landmass uses the Limfjord split; Match / No match previews the corresponding area immediately. |
| **Tentacles** | Shown for reference, but disabled in this small-game Aalborg build. |
| **Zone** | Same district / parish / postal code as you — one tap on a loaded zone layer. |
| **Photos** | Records the requested photo and its framing rule without narrowing the map directly. |
| **Free shape** | Draw anything by hand when a received photo lets you rule out a region. |

**Units.** The app defaults to feet and miles to match the US deck. Radar cards are the small deck's
¼, ½, 1, 3, 5, 10, 25, 50 and 100 miles, plus Custom — and the area readout is in
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


### Matching POIs: game-area filtering and park-like nature areas

Nearest-place Matching considers **only candidates whose representative point lies inside the current play area**. Network requests are now limited to the play area's own bounding box plus a small edge buffer, and the edge-buffer candidates are removed before markers, nearest-place selection, and territory construction. This makes the queries substantially smaller without changing the game rule.

The Park card uses Aalborg Kommune's official park list as its strict base. It also deliberately treats **Østerådalen Nord/Syd, Golfparken and Vandbakken** as park-equivalent for this game. The municipality describes Østerådalen and Vandbakken as recreational/significant green areas, while Golfparken is a public green recreation area and is mapped as a park.

There is also a controlled automatic rule for similar places: a feature outside the curated lists is accepted only when OpenStreetMap maps it explicitly as a **named `leisure=park` polygon**, it is not marked private/no-access, and its mapped footprint is at least **1 hectare**. This is large enough to admit substantial public green spaces like Golfparken/Vandbakken while continuing to reject the tiny residential lawns/back-yard polygons that made the original rule too loose. Official/curated parks are not subject to the size threshold.

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

The **All bus routes** toggle combines NT's separate vector layers for city buses, regional buses,
X buses, local buses and telebuses. It now reads NT's WFS layer catalogue at load time and includes
both the main layers and their separate **biforløb** (branch/secondary-run) layers. This matters for
smaller services and route branches that are visible in NT's map but were absent when the website
requested only the five main tables — including route **38** through Hasseris toward Nørholm and
Klitgård.

OpenStreetMap remains a general fallback. As a final safety net, route 38 is checked explicitly: if
neither NT nor OSM supplied it, the app finds its named stops in OpenStreetMap and routes a line
through them on the road network. That supplement is never added when an official route 38 feature
is already present, so it cannot create a duplicate.

Each numbered route receives a deterministic colour and a slightly different dash phase. Shared
street corridors therefore show several colours instead of one route painting over every route
underneath it. Number labels repeat along the network. When several routes use the same corridor,
the label is combined — for example **11, 12, 14** — while branches return to their individual
route numbers.

The routes remain tappable for the Bus route question. Train lines continue to come from
OpenStreetMap via Overpass, and the NT route-map picture overlay remains available as a visual
fallback.

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

### Live question drafting

Map-based question cards now enter a **live draft** immediately. There is no separate picker or Preview button: tap the map directly, adjust the draft, choose the hider's answer, and press **Log answer** to commit it. Draft geometry is kept in a separate
Leaflet pane and never enters the game log or URL state. It compares the potential answer with the
area currently left after previously logged answers and reports the remaining area.

For Radar, turn preview on and tap the map to place the centre; further taps move it. While previewing,
you can switch between every Radar distance card and the circle updates immediately. Choose Yes or No
to see the resulting cut.

For Thermometer, the first map tap sets the start. The selected card distance is drawn as a travel
ring and a draggable handle stays constrained to that ring. Dragging it previews the Hotter/Colder
bisector for different possible travel directions.

### Bus and train stops

The Layers tab has a separate **Bus & train stops** toggle. It loads OpenStreetMap bus stops, railway
stations, halts and tram stops. Bus and rail points use different symbols, appear from zoom level 12,
and can be tapped directly while preparing Matching or Measuring questions. **Unnamed stops are filtered
out completely**, so anonymous platforms/stop positions no longer clutter the map or Matching candidates.


### Faster loading and shared progress indicator

All network-backed map data now uses the same loading bar at the top of the map: zone boundaries, bus/train routes, bus/train stops, and automatic Matching POIs. Source rows also show a loading state where relevant.

Automatic POIs with authoritative/local fallbacks no longer wait for OpenStreetMap before becoming useful. Known coordinates (for example central libraries, Aalborg Airport, golf courses and curated parks) appear immediately while OpenStreetMap enriches the candidate list in parallel. Queries still use the smaller game-area bounding box, but public map services are now given realistic mobile-network timeouts instead of being aborted after only a few seconds. Independent Overpass mirrors race each other, and split-box retries are used only after the compact whole-area request has had a fair chance to answer.

The **Bus & train stops** request is likewise limited to the current game area plus a small buffer and asks Overpass only for **named** features up front. The old query searched all of greater Aalborg for broad platform/stop-position categories and then discarded anonymous results locally, which was both slow and wasteful. The compact request now gets a longer reliability-first deadline; if it still fails, four small game-area quadrants are tried concurrently.

KortInfo WFS, NT/GC2 and train-route requests also use longer deadlines again. Short 4–12 second client cutoffs were tested and proved too aggressive in real play, so the app now prefers waiting visibly behind the loading bar to incorrectly reporting that a slow public service has failed. Quick 502/503/504 gateway errors are retried once. NT's five known bus families start loading immediately while branch-layer discovery runs in parallel, so reliability no longer adds an avoidable capabilities delay in front of the main routes.

### Mobile navigation

On phones, the old permanent Questions drawer handle has been replaced by a five-button bottom bar: **Map, Ask, Log, Layers, Game**. The area HUD is hidden, and the drawing controls appear only while manually tracing a line or custom shape.

### Post-game UI/library refinements

- Cancelling or closing a question now leaves its question family expanded while you remain in **Ask**, so you can immediately choose another card in the same category. Leaving Ask and coming back still starts with all six families collapsed.
- The redundant **Open map** / **Clear map draft** controls were removed. The compact draft/impact text remains; use the mobile **Map** tab to view the map, and Close/Cancel to clear a draft.
- Danish `aa` and `å` spellings are now canonicalised **for every automatic POI category**, not just libraries. This fixes cases such as **Vejgaard/Vejgård** while also making duplicate/fallback matching consistent for museums, parks, golf courses, hospitals, etc.
- Library Matching now uses Aalborg Bibliotekernes complete current physical network as its authoritative list: **10 libraries plus Haraldslund service point**. All eleven locations have authoritative fallback metadata. The six central locations retain fixed current coordinates; if one of the other official branches is missing from OSM, its official street address is resolved through Dataforsyningen. The usual play-area filter still runs afterward, so Nibe/Hals/etc. cannot affect an Aalborg-small-game nearest-library question merely because they are on the municipal list.


### Loading reliability (August 2026)

Transit data deliberately uses different strategies by data type. Bus routes combine NT's public vector layers, OSM supplementation and named-stop reconstruction for known current lines that are missing from the map feed (currently 11 and 38). Train lines use physical OSM railway ways rather than heavy route relations. Bus/train stops load progressively in six small sections, so successful sections appear even if another Overpass request times out.

Automatic Matching POIs use authoritative local fallbacks where available (libraries, Aalborg Airport, Aalborg Zoo, golf and Aalborg University Hospital sites) and use OSM as enrichment rather than as the sole source.


## Loading reliability rollback (2026-08-02)

After real-game testing showed that the aggressive compact/parallel loaders were dropping data,
network-backed map data now uses the older, more reliable strategy again. POIs first request the
full greater-Aalborg search rectangle and are filtered to the actual game area afterwards. Bus/train
stops first use the proven full Overpass query; only a failed full request falls back to four smaller
areas. Train lines prefer the original train route relations, with physical railway tracks as a
fallback. The common loading indicator remains visible while these requests are running.

Bus line 11 is also bundled with a local fallback geometry. The earlier route-11 fallback still
depended on successfully downloading named stops, which meant it disappeared during the same
Overpass failures it was intended to protect against. The bundled line is used only when NT and OSM
both fail to provide a real line-11 feature.

---

## 2026-08 transport-source correction

NT's public Vidi map is still online, but the old internal GC2 SQL/WFS table URLs used by earlier
versions now return HTTP 404. The functional **All bus routes** layer therefore uses OpenStreetMap
route relations as its primary browser-safe source. Lines 11, 14 and 38 have local supplement logic
when a public map export omits them; line 11 additionally has bundled fallback geometry.

The train-route layer remains based on OSM train route relations because it gives a cleaner passenger
corridor than drawing every physical rail track. A successful train response is cached locally for
seven days so subsequent loads on the same device are immediate.

The transit-stop layer deliberately hides Limfjordsbanen's heritage-only railway halts at
Østerådalen, Gug, Hadsundvej and Limfjorden. This affects only rail markers: identically named bus
stops remain visible.


### Reliability notes — bus routes and local POIs

- Bus routes are fetched from OpenStreetMap in four overlapping Aalborg sections and merged.
  This avoids the all-or-nothing failure of one very large route-relation request. A whole-area
  request is used only as an extra recovery pass when the sectional result looks suspiciously small.
- Aalborg Bibliotekerne's physical libraries/service point are stored as authoritative local
  candidates, so the Library Matching card opens immediately and does not wait for Overpass.
- Aalborg's three current cinemas, Aalborg Airport, Aalborg Zoo and the two golf-course fallbacks
  are likewise local authoritative candidates.
- Hospital markers closer than 350 m are treated as the same hospital campus for Matching; an
  authoritative site marker wins over duplicate OSM building/campus labels.
