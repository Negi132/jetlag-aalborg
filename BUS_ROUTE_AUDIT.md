# Aalborg bus route audit — Rejseplanen GTFS 2026-07-27

Generated automatically from agency 206 = NT.
Only scheduled GTFS bus shapes that intersect the Aalborg game area are bundled; the browser performs the final exact Zone 2 clip.

## Bybus — 14
1, 2, 3, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 19

## Regionalbus — 15
36, 42, 46, 50, 52, 54, 55, 56, 72, 73, 100, 102, 176, 200, 213

## Expresbus — 8
60X, 950X, 951X, 954X, 970X, 971X, 973X, 974X

## Lokalbus — 2
38, 271

## Changes from previous bundle
- Added: none
- Removed: none

## GTFS special/night lines not in the game categories
18E, 21N, 22N, 23N, 24N, 25N, 26N, 27N, 52N, 53N, 72N, 73N

These are present in GTFS but are not part of the four NT transport-form categories selected for this game.

## Automation safeguards
- A partial/broken GTFS download cannot replace the working map if route counts collapse below sanity thresholds.
- All distinct scheduled shape variants are retained; exact duplicate line fragments are removed.
- `app.js` trusts the generated category tags, so a newly discovered route is not blocked by the legacy Overpass whitelist.
