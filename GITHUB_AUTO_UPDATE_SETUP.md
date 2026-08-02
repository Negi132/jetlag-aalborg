# GitHub automatic Aalborg map-data updates

This version automatically refreshes three local data bundles:

- `bus-routes.js` — NT bus-route geometry from Rejseplanen GTFS;
- `transit-data.js` — scheduled passenger train services plus NT bus stops and rail stations from Rejseplanen GTFS; and
- `poi-data.js` — question POIs from the current Geofabrik Denmark OpenStreetMap extract plus the project's authoritative Aalborg fallbacks.

The large source downloads happen only on GitHub's runner. Phones loading the game receive only the small generated JavaScript bundles.

## One-time setup

1. Upload/push **all files and folders** from this project to the repository. Make sure the hidden `.github` folder and the `scripts` folder are included.
2. Open **Settings → Actions → General → Workflow permissions**.
3. Select **Read and write permissions**, then save.
4. Open **Settings → Pages → Build and deployment → Source**.
5. Select **GitHub Actions**.
6. Commit/push the project to `main`.
7. Open **Actions → Update Aalborg map data and deploy Pages**.
8. Click **Run workflow → Run workflow** once.

The manual run is important because `poi-data.js` is shipped as a safe placeholder. The first successful Action replaces it with the real generated POI snapshot and deploys it. The GTFS bus/train/stop bundles are already included, but the Action refreshes them from the newest feed too.

## What a scheduled/manual run does

1. Downloads current `GTFS.zip` from Rejseplanen.
2. Generates and validates `bus-routes.js`.
3. Generates and validates `transit-data.js` containing scheduled passenger train geometry plus named bus/train stops.
4. Downloads `denmark-latest.osm.pbf` from Geofabrik.
5. Uses `osmium` to extract/filter the Aalborg POI source objects.
6. Generates `poi-data.js`, applying the project's curated/authoritative rules.
7. Keeps Aalborg Airport as an intentional exception even though its representative point sits just outside the four Zone-2 game polygons; the airport is still required by the Commercial airport Matching/Measuring card.
8. Runs sanity checks. Suspiciously incomplete results make the workflow fail instead of replacing known-good data.
9. Commits changed generated bundles/audits.
10. Deploys the validated static site to GitHub Pages.

## Current GTFS baseline

With the supplied July–October 2026 GTFS feed the generator finds:

### Buses
- Bybus: 14
- Regionalbus: 15
- Expresbus: 8
- Lokalbus: 2
- Total bus routes: 39

### Trains and stops
- Scheduled train services intersecting the play area: 5 (`IC`, `ICL`, `RE`, `75`, `76`)
- Scheduled rail stations/stops in the padded Aalborg bundle: 6
- Deduplicated NT bus-stop markers in the padded Aalborg bundle: about 480

The browser applies the current live Zone-2 union again before displaying stops/train geometry, so edge data in the padded bundle cannot leak into the game area.

## POI behavior

The same generated POI catalogue is used by both **Matching** and POI-based **Measuring** cards. Measuring displays the candidates as tappable cyan markers; selecting one makes it the target of the normal closer/further geometry rule. A category with only one candidate, such as Commercial airport, is selected automatically. The Measuring **Rail station** card uses the scheduled passenger-station points already bundled in `transit-data.js`, not a separate live OSM query.

Commercial airport is deliberately allowed outside Zone 2. Other normal POI categories are still filtered to the game area.

## Audits

After a successful run the repository contains:

- `BUS_ROUTE_AUDIT.md`
- `TRANSIT_AUDIT.md`
- `POI_AUDIT.md`

These show exactly what the current generated bundles contain.

## Schedule

The workflow runs every Sunday at 04:17 in `Europe/Copenhagen`, and it can always be run manually from the Actions tab.

## Fallback behavior

Normal play uses the generated local files. The older OSM/Overpass train and stop loaders remain only as emergency fallbacks if `transit-data.js` is missing. Similarly, the older live/curated POI logic remains available if `poi-data.js` is not ready.

## Source/licensing note

The OSM source is Geofabrik's Denmark extract. Generated OSM-derived POI data is © OpenStreetMap contributors and used under ODbL 1.0. Rejseplanen GTFS supplies the timetable/transit geometry.
