# GitHub automatic map-data updates

This version automatically refreshes both:

- `bus-routes.js` from Rejseplanen's GTFS feed; and
- `poi-data.js` from the current Geofabrik Denmark OpenStreetMap extract plus the project's authoritative Aalborg fallbacks.

The large source downloads happen only on GitHub's runner. Phones loading the game receive the small generated JavaScript bundles.

## One-time setup

1. Upload/push **all files and folders** from this project to the repository. Make sure the hidden `.github` folder and the `scripts` folder are included.
2. Open **Settings → Actions → General → Workflow permissions**.
3. Select **Read and write permissions**, then save.
4. Open **Settings → Pages → Build and deployment → Source**.
5. Select **GitHub Actions**.
6. Commit/push the project to `main`.
7. Open **Actions → Update Aalborg map data and deploy Pages**.
8. Click **Run workflow → Run workflow** once.

The manual run is important for this release because the repository initially contains a safe
`poi-data.js` placeholder. The first successful Action replaces it with the real bundled POI
snapshot and deploys it.

## What a scheduled/manual run does

1. Downloads current `GTFS.zip` from Rejseplanen.
2. Generates and validates the Aalborg bus-route bundle.
3. Downloads `denmark-latest.osm.pbf` from Geofabrik.
4. Uses `osmium tags-filter` to keep only POI-relevant OSM objects.
5. Generates the Aalborg Matching-POI snapshot.
6. Applies the game's existing curated/authoritative rules and filters representative points to the play area.
7. Runs sanity checks. Suspiciously incomplete results make the workflow fail instead of replacing known-good data.
8. Commits changed generated bundles/audits.
9. Deploys the validated static site to GitHub Pages.

## Normal expected bus result

The August 2026 baseline is:

- Bybus: 14
- Regionalbus: 15
- Expresbus: 8
- Lokalbus: 2
- Total: 39

Future legitimate timetable changes may change those numbers.

## POI validation

The POI builder deliberately allows genuinely empty categories, but requires stable categories such
as airport, parks, zoo, cinema, hospitals, libraries and museums to remain above conservative sanity
floors. It also compares against the last known-good bundle and rejects unusually large drops.

After a successful run, open `POI_AUDIT.md` in the repository to see the exact current counts and
names in every category.

## Schedule

The workflow runs every Sunday at 04:17 in `Europe/Copenhagen`, and it can always be run manually
from the Actions tab.

## Source/licensing note

The OSM source is Geofabrik's Denmark extract. Generated OSM-derived POI data is © OpenStreetMap
contributors and used under ODbL 1.0. The deployed site retains OpenStreetMap attribution.

## Hospital fallback reliability

The POI generator stores coordinates for the five curated Aalborg University Hospital sites directly in `scripts/update_pois.py`. The weekly build does not depend on address geocoding for these known sites; geocoding is only a best-effort compatibility fallback for a future hospital entry that has no stored coordinates.
