# GitHub automatic Aalborg map-data updates

This version automatically refreshes five local data bundles:

- `bus-routes.js` — NT bus-route geometry from Rejseplanen GTFS;
- `transit-data.js` — scheduled passenger train services plus NT bus stops and rail stations from Rejseplanen GTFS; and
- `poi-data.js` — question POIs from the current Geofabrik Denmark OpenStreetMap extract plus the project's authoritative Aalborg fallbacks;
- `hydro-data.js` — Limfjord shorelines and body-of-water geometry for Measuring; and
- `zone-data.js` — cached official Aalborg KortInfo Zone 1–4 polygons.

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
7. Adds Aalborg Airport using the passenger-terminal point at Ny Lufthavnsvej 100, which lies inside the game area.
8. Generates coastline/body-of-water geometry and snapshots official Zone 1–4 polygons.
9. Runs sanity checks. Suspiciously incomplete results make the workflow fail instead of replacing known-good data.
10. Commits changed generated bundles/audits.
11. Deploys the validated static site to GitHub Pages.

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

The same generated POI catalogue is used by both **Matching** and POI-based **Measuring** cards. Measuring automatically chooses the candidate nearest the movable seeker position to establish the reference distance, then applies that same radius around every candidate in the category. This matches questions such as "are you closer to a rail station than me?" rather than treating one selected station as special. The Measuring **Rail station** card uses the scheduled passenger-station points already bundled in `transit-data.js`, not a separate live OSM query.

Commercial airport uses the passenger-terminal point inside Zone 2. Normal POI categories are filtered to the game area.

## Audits

After a successful run the repository contains:

- `BUS_ROUTE_AUDIT.md`
- `TRANSIT_AUDIT.md`
- `POI_AUDIT.md`
- `HYDRO_AUDIT.md`
- `ZONE_AUDIT.md`

These show exactly what the current generated bundles contain.

## Schedule

The workflow runs every Sunday at 04:17 in `Europe/Copenhagen`, and it can always be run manually from the Actions tab.

## Fallback behavior

Normal play uses the generated local files. The older OSM/Overpass train and stop loaders remain only as emergency fallbacks if `transit-data.js` is missing. Similarly, the older live/curated POI logic remains available if `poi-data.js` is not ready.

## Source/licensing note

The OSM source is Geofabrik's Denmark extract. Generated OSM-derived POI data is © OpenStreetMap contributors and used under ODbL 1.0. Rejseplanen GTFS supplies the timetable/transit geometry.

## Additional generated geometry

The same workflow also refreshes `hydro-data.js` and `zone-data.js`. `hydro-data.js` comes from the temporary Geofabrik Aalborg extract and powers automatic Coastline / Body of water Measuring. `zone-data.js` snapshots the four built-in Aalborg KortInfo WFS layers. To keep Zone 1/4 especially small and fast, display polygons are clipped to the actual play area. Genuine administrative border lines are generated separately from the unclipped official polygons and kept only near the game area, so the clip edge can never become a fake Measuring border.

After a successful manual/scheduled run you should also see `HYDRO_AUDIT.md` and `ZONE_AUDIT.md`. If either source looks suspiciously incomplete, the workflow exits non-zero before committing/deploying the new generated bundle.

> **Zone updater compatibility:** Aalborg KortInfo may answer its WFS in GML even when GeoJSON is requested. The updater accepts both GeoJSON and GML, reprojects UTM32 when necessary, and retains the last valid zone snapshot if KortInfo is temporarily unavailable.

## Zone refresh resilience (v4.2)

The Aalborg KortInfo service can be slow from GitHub-hosted runners. The zone snapshot step therefore:

- requests only features intersecting a padded Aalborg game-area BBOX;
- prefers native/projected GML to avoid expensive server-side conversion;
- has short bounded network timeouts and a two-minute workflow ceiling;
- refreshes Zone 2 first, then Zone 1/3/4 independently;
- retains any previous valid per-layer snapshots when a refresh fails; and
- never blocks GTFS/OSM/Pages deployment merely because KortInfo is temporarily unavailable.

On the very first run, if KortInfo is completely unreachable, `zone-data.js` remains the safe placeholder and `scripts/play_area.geojson` remains the committed fallback. The browser still uses its live KortInfo/traced fallback. A later successful scheduled/manual run will populate the zone cache automatically.

### Zone snapshot corruption guard (v4.3)

The scheduled zone refresh now filters Zone 2 to the four recognised game areas before rebuilding `scripts/play_area.geojson`, and rejects implausible bounds/area changes. A bad KortInfo response can therefore no longer expand the play area and cause GTFS stop counts to explode; the last committed play area remains in use instead.
