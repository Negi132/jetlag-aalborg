# Aalborg zone snapshot audit

- Generated: `2026-10-25T08:42:51.021282+00:00`
- Source: `https://drift.kortinfo.net/Wfs.aspx?Site=Aalborg&Page=kortHjemmeside`
- Zone 2 is also written to `cities/aalborg/play_area.geojson`, so every other generator uses the same exact official game boundary. Display polygons are clipped to the play area and Zone 1/4 catch-all areas are precomputed on GitHub, so the browser does no clipping/union work when toggling them. Genuine border lines are cached separately from the unclipped official geometry for Measuring.

| Layer | WFS type | Cached display polygons | Cached real-border features | Status |
|---|---|---:|---:|---|
| Zone1 | `ugis:TL1433667` | 76 | 107 | fresh/retained cache |
| Zone2 | `ugis:TL445984` | 4 | 4 | fresh/retained cache |
| Zone3 | `ugis:TL445987` | 33 | 48 | fresh/retained cache |
| Zone4 | `ugis:TL445981` | 571 | 755 | fresh/retained cache |
