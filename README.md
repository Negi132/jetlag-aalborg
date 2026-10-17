# Hide + Seek — Aalborg seeker map

A seeker's map for the small-game version of *Jet Lag: The Game*'s Hide + Seek, played in Aalborg.
Log each answer the hider gives and the map shades away everywhere they can't be.

**Live site:** https://negi132.github.io/jetlag-aalborg/ — add it to your phone's home screen before
game day; it is built for one-handed use on a bus.

Everything runs in the browser: no backend, no build step, no API keys. The whole game state lives
in the URL, so a reload never loses it and **Copy game link** hands a co-seeker the identical map.

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

### Game-specific rules built into the map

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
| `index.html`, `styles.css`, `app.js` | The whole app. Leaflet draws the map, Turf.js does the geometry, proj4 reprojects KortInfo's UTM32 data. |
| `bus-routes.js` | NT bus routes from Rejseplanen GTFS, tagged Bybus / Regionalbus / Expresbus / Lokalbus. |
| `transit-data.js` | Scheduled passenger train lines plus named bus and rail stops, from GTFS. |
| `poi-data.js` | Points of interest for Matching and Measuring, from OpenStreetMap plus curated lists. |
| `hydro-data.js` | Generalized Limfjord banks and bodies of water, from OpenStreetMap. |
| `zone-data.js` | Snapshot of Aalborg Kommune's four KortInfo zone layers, clipped to the play area (about 1.3 MB gzipped). |
| `zone2-fallback.js` | Simplified official outlines of the four Zone 2 areas, used only if `zone-data.js` and KortInfo are both unavailable. |
| `kommune-outline.js` | Aalborg Kommune's boundary (OpenStreetMap) for the "whole municipality" play area. Built by hand with `scripts/make_kommune_outline.py`; borders rarely change. |
| `scripts/` | Python generators for the data files above (shared helpers in `common.py`), plus `play_area.geojson` (official Zone 2, written by `update_zones.py`) and filter lists. |
| `tests/` | Headless test suite (jsdom). |
| `*_AUDIT.md` | What the latest data refresh produced. |

Generated data files are committed and shipped with the site, so phones never wait on slow public
map services during play. `app.js` still has live fallbacks for zones (KortInfo WFS, cached on
the device for 45 days), POIs, stops and train lines (Overpass) if a bundle is missing.

### Data refresh and deploy

[`.github/workflows/update-map-data.yml`](.github/workflows/update-map-data.yml) does everything:

| Trigger | What happens |
|---|---|
| Push to `main` | Run tests, then deploy to GitHub Pages. If the push changes `scripts/`, the data is regenerated first, as on a scheduled run. |
| Sunday 04:17 Copenhagen time, or **Run workflow** | Download Rejseplanen GTFS and Geofabrik's Denmark OSM extract, regenerate every data file, run tests, commit changed data as `github-actions[bot]`, deploy. |

The generators refuse to overwrite good data when a source looks incomplete (route or stop counts
collapsing, implausible zone bounds), and the test suite must pass before anything is committed or
deployed. Only `index.html`, `styles.css` and the `.js` files are published.

**Weekly monitoring.** After every scheduled or manual run, `scripts/health_check.py` confirms the data
is fresh, the GTFS timetable is not about to expire, and every outside service still answers properly:
the data sources, the CDN libraries, KortInfo, and each basemap. A basemap must serve real, varying
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

Run the tests (Node 16 or newer):

```bash
npm install
npm test
```

`npm test` runs every JavaScript suite and ends with a pass/fail summary per suite:

| Suite | What breaks it |
|---|---|
| `tests/geometry.test.mjs` | Constraint maths (radar, thermometer bisector, nearest-place cells) drifting from known answers. |
| `tests/data.test.mjs` | A generated bundle that is malformed, empty, outside the play area or missing a category, and `index.html` referencing a missing or unversioned file. |
| `tests/ui.test.mjs` | Detailed app behaviour: parsing, labels, POI rules, previews, URL state. |
| `tests/features.test.mjs` | Any layer toggle, Game-tab control or question card that stops working. It opens **every** card in the deck, answers it and logs it, and fails if a new card is added without a test. |

The UI suites boot the real `index.html` and scripts in jsdom via `tests/harness.mjs`.

The Python generators have their own tests (shared helpers, validation rules, and the committed
bundles passing them). They need the generators' dependencies:

```bash
pip install shapely==2.1.2 pyproj==3.7.2
npm run test:python
```

CI runs both before every deploy.

Things to know when changing code:

- **Bump the `?v=` strings** in `index.html` when you change `app.js`, `styles.css` or
  `zone2-fallback.js`, so phones fetch the new files instead of cached ones.
- **Console access:** a live game is on `window.HS`, e.g. `HS.S.constraints`,
  `HS.setCircularPlayArea(HS.map.getCenter(), 4)`.
- **Config** lives at the top of `app.js` (`CONFIG`, `RADAR_PRESETS`, `DEFAULT_SOURCES`); colours
  are CSS custom properties at the top of `styles.css`.
- **Sources:** every zone source in the Layers tab is editable (⚙), including **Browse layers** to list
  a WFS server's layers. Edits travel in the game link.

## Credits and licences

- Map data and OSM-derived POI/water data © OpenStreetMap contributors, ODbL 1.0.
- Timetable and transit geometry: Rejseplanen GTFS.
- Zones: Aalborg Kommune (KortInfo WFS). Satellite imagery: Esri.
