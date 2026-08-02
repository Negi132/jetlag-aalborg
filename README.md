# Hide + Seek — Aalborg seeker map

## Current local-data architecture

The normal game no longer waits for live route/stop/POI discovery. GitHub Actions periodically builds three compact local datasets:

- `bus-routes.js` from Rejseplanen GTFS (39 current NT routes in the game area),
- `transit-data.js` from Rejseplanen GTFS (scheduled passenger train services plus named bus/train stops), and
- `poi-data.js` from Geofabrik OSM plus the project's curated Aalborg lists.

Train lines and bus/train stops therefore load locally just like bus routes. OpenStreetMap/Overpass remains only as an emergency fallback for transit data. POI-based **Matching and Measuring** questions share the same bundled catalogue; Measuring markers are tappable targets. The Measuring **Rail station** card reuses the scheduled GTFS rail-station points from `transit-data.js`. Aalborg Airport is intentionally retained even though it sits just outside the Zone-2 play boundary, because it is the relevant Commercial airport for the game.

## Bus routes: bundled Rejseplanen GTFS

Bus overlays no longer depend on live OpenStreetMap/Overpass discovery during normal use. The project ships `bus-routes.js`, generated from the official Rejseplanen GTFS feed dated 2026-07-27. It contains every timetable shape variant that reaches the Aalborg game area, cropped to a small Aalborg envelope. The browser then clips those local lines against the exact live union of the four Zone 2 play polygons before drawing them.

Current bundled routes are **14 Bybus**, **15 Regionalbus**, **8 Expresbus**, and **2 Lokalbus**. Lokalbus includes routes **38 and 271**. Overpass remains only as an emergency fallback if `bus-routes.js` is missing.


A seeker's map for the home version of *Jet Lag: The Game*'s Hide + Seek. You log each answer
the hider gives you; the map shades away everywhere they can't be. The number in the corner is
how many km² are left.

Everything runs in the browser. No build step, no server, no API keys.

---

### Temporary zone layers and movable question previews

Zone layers that are opened automatically by a Matching or Measuring card are temporary: closing, cancelling, switching, or logging that question hides the layer again unless you had already enabled it yourself in **Layers**. This keeps the map clear between questions.

Radar centres, both Thermometer endpoints, and the point used by zone-border Measuring are movable while the question remains open. Radar and border-distance points can still be repositioned by tapping the map; all three workflows also expose draggable handles, so a mistaken placement never requires closing and reopening the card.


## Put it on GitHub Pages

1. Create a repo and upload the complete project, including `bus-routes.js`, `transit-data.js`, `poi-data.js`, `.github/` and `scripts/`.
2. In **Settings → Actions → General → Workflow permissions**, enable **Read and write permissions**.
3. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
4. Open **Actions → Update Aalborg map data and deploy Pages** and run it once manually.
5. After the green deployment finishes, the site is live at `https://<you>.github.io/<repo>/`. See `GITHUB_AUTO_UPDATE_SETUP.md` for the full setup/update notes.

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

The bus controls now mirror the four categories in NT's supplied **Find din køreplan** list:

- **Bybus**
- **Regionalbus**
- **Expresbus**
- **Lokalbus**

The route references from that timetable list are built into `app.js` as the authoritative catalogue.
Choosing a category asks OpenStreetMap only for relations whose route numbers occur in that NT
catalogue, rather than asking for every bus relation in greater Aalborg. Large categories are divided
into small requests and successful replies are merged, which is both lighter and more tolerant of an
individual Overpass request failing.

**Only the part inside the current play area is retained.** After route geometry is downloaded, every
line is split at the exact Zone-2 play-area boundary and all outside pieces are discarded. This is an
actual polygon clip, not a rectangular crop. If the play area is changed later, already-loaded bus
data is re-clipped locally without another network request.

The four category buttons are independent toggles, but visible categories are combined into a single
rendering layer. That preserves the existing shared-corridor behaviour: routes keep distinct colours
and repeated number labels, and a street shared by several visible routes can still display a combined
label such as **11, 12, 14**.

Known public-map holes still have supplements for lines 11, 14 and 38. In particular, line 11 retains
its bundled last-resort geometry if no network source supplies it.

Train lines remain a separate toggle, but now prefer the local Rejseplanen GTFS transit bundle; the older OSM train loader is only an emergency fallback.

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

The Layers tab has a separate **Bus & train stops** toggle. It normally loads scheduled named stops from the local Rejseplanen GTFS bundle; the old OpenStreetMap loader remains only as a fallback. It distinguishes bus stops from railway
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

**Superseded for buses by the category-based loader above.** The old internal NT/GC2 table URLs
returned HTTP 404, so the current version uses the NT timetable's route-number catalogue to drive
smaller OpenStreetMap requests for Bybus, Regionalbus, Expresbus and Lokalbus separately. Lines
11, 14 and 38 retain supplement logic; line 11 additionally has bundled fallback geometry.

Train lines and normal passenger stops are now bundled from Rejseplanen GTFS in `transit-data.js`; the older OSM relation/stop loaders remain only as emergency fallbacks. Because the bundled rail markers come from scheduled passenger service, Limfjordsbanen heritage-only halts such as Østerådalen, Gug, Hadsundvej and Limfjorden are not presented as normal train stations. Identically named bus stops remain unaffected.

---

## Automatic weekly bus-route updates

The bus overlays are generated from Rejseplanen's static GTFS feed and stored in
`bus-routes.js`. A GitHub Actions workflow now refreshes that file automatically.

### One-time GitHub setup

1. Push this complete project to the repository's default `main` branch.
2. Open **Settings → Actions → General → Workflow permissions** and allow
   **Read and write permissions**.
3. Open **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**.
4. Open the repository's **Actions** tab, choose
   **Update Aalborg map data and deploy Pages**, and click **Run workflow**.
5. Open that run and check the `Regenerate Aalborg bus routes` step. A healthy
   run currently reports 14 Bybus, 15 Regionalbus, 8 Expresbus and 2 Lokalbus
   routes (39 total). The exact counts may legitimately change when NT changes
   the network.

After that, the workflow runs every Sunday at **04:17 Europe/Copenhagen**. It:

- downloads the newest `GTFS.zip` directly from Rejseplanen;
- extracts NT's scheduled bus shapes;
- keeps the routes that intersect the Aalborg game area;
- preserves distinct scheduled route variants;
- regenerates and validates `bus-routes.js`;
- refuses to replace the working map if the source suddenly collapses to an
  obviously incomplete route set;
- commits a changed route bundle back to the repository; and
- deploys the same validated version to GitHub Pages.

Ordinary pushes to `main` skip the GTFS download and simply deploy the current
repository, so normal site edits do not need to download the national feed.

### Files used by the updater

- `.github/workflows/update-bus-routes.yml` — schedule, update and Pages deploy.
- `scripts/update_bus_routes.py` — GTFS extraction, spatial filtering and safety checks.
- `scripts/play_area.geojson` — stable local play-area reference used by the generator.
- `scripts/bus_route_categories.json` — NT category snapshot used to distinguish
  Bybus, Regionalbus, Expresbus and Lokalbus.
- `BUS_ROUTE_AUDIT.md` — human-readable result of the most recent successful generation.

The browser still performs the final route clip against the live official Zone 2
polygon. The generator's local play-area reference is used to decide what data is
worth bundling, not as a replacement for the official in-game boundary.

---

## Automatic Matching-POI bundle

The automatic Matching cards now prefer `poi-data.js`, a small local snapshot generated by the
same GitHub Actions workflow that refreshes the GTFS bus routes. This removes live Overpass waiting
from normal gameplay.

On scheduled/manual update runs GitHub downloads Geofabrik's current Denmark OpenStreetMap PBF,
filters it server-side with `osmium`, applies this project's existing Aalborg POI rules, merges the
stable authoritative local lists, validates the result, and commits `poi-data.js` plus
`POI_AUDIT.md`. The large Denmark source file is temporary and is never deployed to GitHub Pages.

The bundled categories are Commercial airport, Park, Amusement park, Zoo, Aquarium, Golf course,
Museum, Movie theater, Hospital, Library and Foreign consulate. Empty categories are valid and are
recorded explicitly. If the generated snapshot is missing, unvalidated, or a scheduled refresh
fails, `app.js` falls back to the previous live/curated loader instead of silently removing POIs.

OpenStreetMap-derived POI data is © OpenStreetMap contributors and is used under ODbL 1.0.

## Automated local map-data snapshots

The weekly GitHub Actions updater now builds all slow-changing game geometry into local JavaScript bundles before deployment:

- `bus-routes.js` — NT bus route shapes from Rejseplanen GTFS.
- `transit-data.js` — scheduled train lines plus bus/train stops from GTFS.
- `poi-data.js` — Matching/Measuring POIs from Geofabrik OSM plus curated authoritative fallbacks.
- `hydro-data.js` — Limfjord north/south coastline geometry and body-of-water targets for automatic Measuring.
- `zone-data.js` — snapshots of Aalborg Kommune's official KortInfo Zone 1–4 WFS layers.

The browser prefers these local bundles, so normal play does not wait on Overpass or KortInfo. Live network loaders remain fallbacks where appropriate. The generated audit files (`BUS_ROUTE_AUDIT.md`, `TRANSIT_AUDIT.md`, `POI_AUDIT.md`, `HYDRO_AUDIT.md`, `ZONE_AUDIT.md`) document each refresh.

### Measuring automation

POI-based Measuring keeps a movable seeker position. Rail-station Measuring automatically selects the scheduled passenger station nearest that position. Coastline Measuring detects whether the seeker is in Nørresundby and uses the northern Limfjord shore there; everywhere else it uses the southern shore. Body-of-water Measuring automatically selects the nearest bundled water feature. Zone-border, coastline, water, POI, and generic Measuring previews remain drafts until **Log answer** and can be repositioned before logging.

> **Zone updater compatibility:** Aalborg KortInfo may answer its WFS in GML even when GeoJSON is requested. The updater accepts both GeoJSON and GML, reprojects UTM32 when necessary, and retains the last valid zone snapshot if KortInfo is temporarily unavailable.

### Automated zone-cache resilience

The scheduled map-data workflow treats Aalborg KortInfo as an optional refresh source rather than a dependency for the whole build. Zone requests use a padded game-area WFS BBOX and native/projected GML first, Zone 2 is refreshed before the other levels, and Zone 1/3/4 are refreshed independently. Existing valid snapshots are retained per layer when the municipality is temporarily unavailable. The GitHub Actions zone step also has a hard two-minute ceiling and is non-blocking, so bus, train, stop, POI and hydro updates still deploy even during a KortInfo outage.

