# v4.11 → v4.12 update

This update targets the remaining Zone 1 / Zone 4 delay.

- `scripts/update_zones.py` now emits a v3 render-ready zone bundle. Clipping to
  the play area and the Zone 1 Landzone / Zone 4 X catch-all difference/union
  are computed on GitHub, not when the player taps the layer.
- `app.js` skips coordinate normalization, Turf clipping and catch-all unions for
  validated v3 bundles and uses Leaflet Canvas for vector paths.
- If GitHub cannot reach KortInfo, a successful live zone load is persisted in
  IndexedDB for 45 days, so later visits on that device can reuse it locally.
- Body-of-water calculation geometry is unchanged, but markers whose marker
  point lies outside the play area are no longer drawn.

After uploading these files, run **Update Aalborg map data and deploy Pages**
once. If KortInfo is reachable from GitHub, `zone-data.js` will be regenerated
as the v3 render-ready bundle. If not, the on-device persistent cache still
removes repeated waits after the first successful live load.
