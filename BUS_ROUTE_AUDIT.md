# Aalborg bus route audit — Rejseplanen GTFS 2026-07-27

Generated from the uploaded Rejseplanen GTFS feed (agency 206 = NT).
All distinct scheduled GTFS shapes were checked against the Aalborg game-area geometry used by the project. The shipped geometry is cropped only to a padded Aalborg envelope; `app.js` performs the final clip against the exact official Zone 2 union at runtime.

## Bybus — 14
1, 2, 3, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 19

## Regionalbus — 15
36, 42, 46, 50, 52, 54, 55, 56, 72, 73, 100, 102, 176, 200, 213

## Expresbus — 8
60X, 950X, 951X, 954X, 970X, 971X, 973X, 974X

958X exists in the NT GTFS feed but its geometry does not reach the Aalborg play area, so it is not drawn.

## Lokalbus — 2
38, 271

Route 38 has been moved out of the Regionalbus catalogue and into Lokalbus.

## Implementation
- `bus-routes.js` is about 522 KB uncompressed and is served locally by GitHub Pages.
- Normal bus-layer loading makes no Overpass request.
- All GTFS shape variants that enter the game area are retained.
- The browser clips the bundled geometry against the exact current play-area polygon before rendering.
- Existing Overpass code remains only as an emergency fallback if `bus-routes.js` is missing.
