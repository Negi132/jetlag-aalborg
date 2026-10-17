# Hide + Seek — Aalborg seeker map

A seeker's map for the small-game version of *Jet Lag: The Game*'s Hide + Seek, played in Aalborg.
Log each answer the hider gives and the map shades away everywhere they can't be.

The app itself is not tied to Aalborg: each city's zones, places, transit and rules live in its own
folder, `cities/<id>/`, and the **City** setting in the **Game** tab switches between them. Aalborg is
the only city so far.

**Live site:** https://negi132.github.io/jetlag-aalborg/ — add it to your phone's home screen before
game day; it is built for one-handed use on a bus.

Everything runs in the browser: no backend, no build step, no API keys. The whole game state lives
in the URL (`?city=aalborg#g=…`), so a reload never loses it and **Copy game link** hands a co-seeker
the identical map.

---

## Playing

The **Ask** tab mirrors the small game's physical question deck. Pick a card, tap the map where the
question was asked, choose the hider's answer and press **Log answer**. Until then the question is a
live draft: it previews how much area each answer would leave and never enters the game log.

Every answer becomes a polygon of *places the hider could still be*; all of them are intersected and
whatever survives stays bright.

| Question | What it cuts |
|---|---|
| **Matching** — "is your nearest ___ the same as mine?" | Point cards (parks, museums, libraries…) use nearest-place territories. Zone cards use the official zone you are in; Landmass splits Nørresundby from the area south of the Limfjord. |
| **Measuring** — "are you closer to or further from ___?" | A band around the target(s) whose width is *your* distance from the nearest one. Works for points, zone borders, the Limfjord coastline and bodies of water. |
| **Thermometer** — "after travelling ___, am I hotter or colder?" | The perpendicular bisector between start and end; *hotter* keeps the end side. |
| **Radar** — "are you within ___ of me?" | A circle; *yes* keeps the inside. Fixed ¼–100 mile cards plus Custom (`0.5` and `0,5` both work). |
| **Photos** | Logged for the record without changing the map. |
| **Tentacles** | Shown for reference, disabled (medium/large games only). |
| **Free shape** | Draw any area by hand, e.g. after a photo rules a region out. |

- **Mute instead of delete.** If the map goes black, one answer is wrong. Each logged answer has a ◉
  toggle, so you can mute them one by one to find it.
- **Units.** Imperial by default to match the US deck; metric is in the **Game** tab. Distances are
  stored in metres and only formatted for display, so switching never changes a result.
- **Layers.** Toggle the four official zone levels, bus routes by NT category, train lines and
  stops. Zone layers opened automatically by a question close again afterwards.
- **Location.** The blue marker shows your device position. It is display-only and never saved or
  shared.
- **City.** The **Game** tab lists the cities. Switching reloads the page with that city's data and
  starts a new game; a saved or shared game from another city is refused with a message saying
  which city it belongs to.

### Shared map

Seekers can share one map instead of crowding around one phone. In the **Game** tab, one seeker taps
**Start a shared map** and sends the invite link; everyone else opens it. Two buttons then appear
above the location button:

- **⤒ Post map** sends this phone's answers to everyone. A dot on it means this phone has answers it
  has not posted yet.
- **⤓ Get latest map** replaces this phone's answers with the newest posted map. A dot on it means
  someone has posted something newer.

Nothing changes on anyone's phone by itself, so an answer logged by mistake goes nowhere until it is
posted. Posting over a newer map you have not loaded, or loading over answers you have not posted,
asks first. Each phone still previews questions on its own; only logged answers and the play area are
shared, while units, basemap, shading strength and your location dot stay personal.

Rooms are per city. The relay is [ntfy.sh](https://ntfy.sh), a free public service (no account or key). It keeps a post
for 12 hours, and the weekly health check confirms it is still up. Answers travel as small recipes
(what was asked and where) that each phone rebuilds from its own data files, so a whole game is
usually 1–3 KB. Phones should run the same version of the site for identical maps; if they don't,
loading a map says so. **Copy game link** still works as a fallback.

### Aalborg's rules

These are set in [`cities/aalborg/city.json`](cities/aalborg/city.json).

- **Play area:** the exact union of Zone 2's four areas — Midtbyen, Nørresundby, Vest Aalborg and
  Øst Aalborg. Points of interest, stops and routes outside it are ignored.
- **Parks:** Aalborg Kommune's official park list, plus Østerådalen Nord/Syd, Golfparken and
  Vandbakken as park-equivalents, plus any named public OSM `leisure=park` of at least 1 hectare.
- **Libraries:** Aalborg Bibliotekerne's physical branches (and the Haraldslund service point).
- **Golf course:** the only golf course near the play area (Ørnehøj Golfklub) lies just outside it,
  so the Golf cards currently have no candidates.
- **Commercial airport:** Aalborg Airport, placed at its passenger terminal, which is inside the play area.
- **Coastline:** both mainland Limfjord banks count as one coastline; islands such as Egholm are ignored.
- **Rail stations:** only stations with scheduled passenger service (heritage-only halts are excluded).
- **Zone 4:** areas with no kommuneplanramme fall into a selectable **X · Uden kommuneplanramme** zone.

---

## How it is built

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app, the same for every city. Leaflet draws the map, Turf.js does the geometry, proj4 reprojects UTM32 zone data. |
| `boot.js` | Picks the city (`?city=`, else the last one used, else Aalborg), loads its `city.json` and data files, then `app.js`. Also the list of cities. |
| `cities/<id>/city.json` | Everything city-specific: map centre and bounds, the zone service and its four layers, the Zone 2 play areas and colours, the Landmass split, the coastline, the bus operator and its categories, excluded rail halts, and the curated places for each card. Read by both the app and the generators. |
| `cities/<id>/bus-routes.js` | The operator's bus routes from Rejseplanen GTFS, tagged by category (Aalborg: NT's Bybus / Regionalbus / Expresbus / Lokalbus). |
| `cities/<id>/transit-data.js` | Scheduled passenger train lines plus named bus and rail stops, from GTFS. |
| `cities/<id>/poi-data.js` | Points of interest for Matching and Measuring, from OpenStreetMap plus the curated lists. |
| `cities/<id>/hydro-data.js` | Coastline and bodies of water, from OpenStreetMap (Aalborg: the generalized Limfjord banks). |
| `cities/<id>/zone-data.js` | Snapshot of the four zone layers, clipped to the play area (Aalborg: about 1.3 MB gzipped). |
| `cities/<id>/zone2-fallback.js` | Simplified outlines of the Zone 2 play areas, used only if `zone-data.js` and the zone service are both unavailable. |
| `cities/<id>/kommune-outline.js` | The municipality's boundary (OpenStreetMap) for the "whole municipality" play area. Built by hand with `scripts/make_kommune_outline.py --city <id>`; borders rarely change. |
| `cities/<id>/play_area.geojson` | Official Zone 2, written by `update_zones.py`; every other generator filters by it. |
| `cities/<id>/*_AUDIT.md` | What the latest data refresh produced. |
| `scripts/` | Python generators for the data files (shared helpers and the city loader in `common.py`; all take `--city`), plus OSM filter lists. |
| `tests/` | Headless test suite (jsdom). |

Generated data files are committed and shipped with the site, so phones never wait on slow public
map services during play, and a phone only ever downloads its own city's files. `app.js` still has
live fallbacks for zones (the city's WFS, cached on the device for 45 days), POIs, stops and train
lines (Overpass) if a bundle is missing.

### Data refresh and deploy

[`.github/workflows/update-map-data.yml`](.github/workflows/update-map-data.yml) does everything:

| Trigger | What happens |
|---|---|
| Push to `main` | Run tests, then deploy to GitHub Pages. If the push changes `scripts/` or a `city.json`, the data is regenerated first, as on a scheduled run. |
| Sunday 04:17 Copenhagen time, or **Run workflow** | Download Rejseplanen GTFS and Geofabrik's Denmark OSM extract, regenerate every city's data files, run tests, commit changed data as `github-actions[bot]`, deploy. |

Every step loops over the cities (`python scripts/cities.py` lists them). One city's zone service
being down does not stop the others.

The generators refuse to overwrite good data when a source looks incomplete (route or stop counts
collapsing, implausible zone bounds), and the test suite must pass before anything is committed or
deployed. Only `index.html`, `styles.css`, the `.js` files and each city's `city.json` and data
files are published.

**Weekly monitoring.** After every scheduled or manual run, `scripts/health_check.py` confirms the data
is fresh, the GTFS timetable is not about to expire, and every outside service still answers properly:
the data sources, the CDN libraries, each city's zone service, the ntfy.sh relay and each basemap. A basemap must serve real, varying
tiles, so a provider that starts demanding an API key (as CARTO did) is caught. If anything fails, or the
refresh, deploy or zone snapshot fails, the run turns red and an issue labelled `map-data-health` is
opened (or updated) with the details. The next clean run closes it. The run also re-enables its own
schedule, because GitHub switches off scheduled workflows in repositories that are inactive for 60 days.

**One-time GitHub setup** (already done for this repo): Settings → Actions → General → Workflow
permissions → *Read and write*; Settings → Pages → Source → *GitHub Actions*.

---

## Development

Serve the folder and open http://localhost:8000:

```bash
python -m http.server 8000
```

Run the tests (Node 22 or newer; CI uses Node 24):

```bash
npm install
npm test
```

`npm test` runs every JavaScript suite and ends with a pass/fail summary per suite:

| Suite | What breaks it |
|---|---|
| `tests/geometry.test.mjs` | Constraint maths (radar, thermometer bisector, nearest-place cells) drifting from known answers. |
| `tests/data.test.mjs` | A `city.json` with missing or inconsistent settings, a generated bundle that is malformed, empty, outside the play area or missing a category, and `index.html` referencing a missing or unversioned file. |
| `tests/ui.test.mjs` | Detailed app behaviour: parsing, labels, POI rules, previews, URL state. |
| `tests/features.test.mjs` | Any layer toggle, Game-tab control (including the city picker) or question card that stops working. It opens **every** card in the deck, answers it and logs it, and fails if a new card is added without a test. |
| `tests/share.test.mjs` | The shared map: two simulated phones on a fake relay post, get the latest, get warned before overwriting, and end up with identical maps. |

The UI suites boot the real `index.html` in jsdom via `tests/harness.mjs`, which loads the same
city settings and data files `boot.js` would.

The Python generators have their own tests (shared helpers, validation rules, and the committed
bundles passing them). They need the generators' dependencies:

```bash
pip install shapely==2.1.2 pyproj==3.7.2
npm run test:python
```

CI runs both before every deploy.

Things to know when changing code:

- **Bump the versions** so phones fetch new files instead of cached ones: after changing `app.js`,
  `boot.js` or a `city.json`, change `BUILD` in `boot.js` and `boot.js?v=` in `index.html` to the
  same new value (the data test fails if they differ); after changing `styles.css`, its `?v=` in
  `index.html`; after editing a city's data files by hand, that city's `data` version in `boot.js`.
- **Console access:** a live game is on `window.HS`, e.g. `HS.S.constraints`, `HS.CITY`,
  `HS.setCircularPlayArea(HS.map.getCenter(), 4)`.
- **Config:** city-specific settings are in `cities/<id>/city.json`; game-wide ones at the top of
  `app.js` (`RADAR_PRESETS`, colours); styling colours are CSS custom properties at the top of
  `styles.css`.
- **Sources:** every zone source in the Layers tab is editable (⚙), including **Browse layers** to list
  a WFS server's layers. Edits travel in the game link.

### Adding a city

1. Copy `cities/aalborg/city.json` to `cities/<id>/city.json` and change everything in it: `id` and
   `name`, the map centre and bounds, the zone service and its four layers, the Zone 2 play areas,
   the Landmass split (or remove `landmass`), the coastline, the bus operator, its categories and
   inference rules, excluded rail halts, and the curated places.
2. Add the city to `CITIES` in `boot.js`.
3. Run `python scripts/update_zones.py --city <id>` (writes `zone-data.js` and `play_area.geojson`),
   then `python scripts/make_kommune_outline.py --city <id>`, and write a `zone2-fallback.js`.
4. Push. The workflow regenerates the city's bus, transit, POI and water files, tests and deploys.
   A coastline method other than `two-bank-fjord` needs support in `scripts/update_hydro.py` first.

## Credits and licences

- Map data and OSM-derived POI/water data © OpenStreetMap contributors, ODbL 1.0.
- Timetable and transit geometry: Rejseplanen GTFS.
- Zones: Aalborg Kommune (KortInfo WFS). Satellite imagery: Esri.
