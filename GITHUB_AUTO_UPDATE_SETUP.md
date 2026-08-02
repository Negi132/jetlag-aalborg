# One-time GitHub setup for automatic Aalborg bus updates

The project already contains the updater and workflow. You only need to enable the permissions/deployment mode once.

## 1. Upload/push this project

Put the contents of this ZIP in the root of your existing GitHub repository and commit/push them to `main`.

Important new files:

- `bus-routes.js`
- `scripts/update_bus_routes.py`
- `scripts/play_area.geojson`
- `scripts/bus_route_categories.json`
- `.github/workflows/update-bus-routes.yml`

Do **not** upload `GTFS.zip`. GitHub downloads a fresh copy itself.

## 2. Allow the workflow to save route updates

In the repository:

1. **Settings**
2. **Actions** → **General**
3. Scroll to **Workflow permissions**
4. Select **Read and write permissions**
5. Click **Save**

## 3. Switch GitHub Pages to Actions

1. **Settings**
2. **Pages**
3. Under **Build and deployment** → **Source**
4. Select **GitHub Actions**

Do not create another Pages workflow from GitHub's suggested templates; this project already contains one.

## 4. Run the updater manually once

1. Open the repository's **Actions** tab.
2. Select **Update Aalborg bus routes and deploy Pages**.
3. Click **Run workflow** → **Run workflow**.
4. Open the running job.
5. Expand **Regenerate Aalborg bus routes**.

With the GTFS feed used to build this package, a healthy result is:

- Bybus: 14
- Regionalbus: 15
- Expresbus: 8
- Lokalbus: 2
- Total: 39

Future legitimate NT changes may change these counts.

## 5. Verify the deployment

The same workflow deploys the validated site to GitHub Pages. When the job is green, open your normal Pages URL and test the four bus overlays.

## What happens automatically afterwards?

Every Sunday at 04:17 Copenhagen time GitHub will:

1. download the newest Rejseplanen `GTFS.zip`;
2. verify that the ZIP is valid;
3. extract NT bus routes and scheduled shapes;
4. select routes intersecting the Aalborg game area;
5. preserve distinct route variants;
6. regenerate `bus-routes.js`;
7. run sanity checks so a broken/partial GTFS cannot wipe the map;
8. commit changed route data to the repository; and
9. deploy that validated version to GitHub Pages.

Ordinary pushes to `main` do not redownload GTFS; they simply deploy your current site.

## If an update fails

Do not replace anything manually just because one scheduled run fails. The previous `bus-routes.js` remains in the repository and therefore remains the live route dataset. Open the failed Action and inspect the `Download current Rejseplanen GTFS` or `Regenerate Aalborg bus routes` step.

The human-readable `BUS_ROUTE_AUDIT.md` file records the latest successful route set and any additions/removals.
