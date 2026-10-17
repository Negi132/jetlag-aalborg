#!/usr/bin/env python3
"""Build kommune-outline.js: a city's municipal boundary for the "whole municipality" play area.

Municipal borders almost never change, so this is run by hand rather than weekly:

    python scripts/make_kommune_outline.py --city aalborg

It replaced Dataforsyningen's DAWA API, which was retired (HTTP 410). The
boundary is the OpenStreetMap relation in the city's kommune.osmRelation
(Aalborg Kommune: 2099194), fetched through Nominatim.
Boundary © OpenStreetMap contributors, ODbL 1.0.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for `common`, even under python -I
from common import add_city_argument, load_city, round_coords_deep

SIMPLIFY_DEG = 0.0001   # ~7 m; plenty for a play-area outline


def main():
    ap = argparse.ArgumentParser()
    add_city_argument(ap)
    city = load_city(ap.parse_args().city)
    kommune = city.config['kommune']
    output = city.path('kommune-outline.js')
    url = ('https://nominatim.openstreetmap.org/lookup'
           f'?osm_ids=R{kommune["osmRelation"]}&format=geojson&polygon_geojson=1')
    req = urllib.request.Request(url, headers={
        'User-Agent': 'jetlag-aalborg kommune outline (https://github.com/Negi132/jetlag-aalborg)'})
    with urllib.request.urlopen(req, timeout=60) as res:
        data = json.load(res)
    features = data.get('features', [])
    if len(features) != 1 or features[0]['properties'].get('name') != kommune['name']:
        raise SystemExit(f'expected the {kommune["name"]} boundary, got {[f["properties"].get("name") for f in features]}')
    area = shape(features[0]['geometry'])
    if area.is_empty or not area.is_valid or area.geom_type not in ('Polygon', 'MultiPolygon'):
        raise SystemExit('Nominatim returned no valid municipality polygon')
    area = area.simplify(SIMPLIFY_DEG, preserve_topology=True)
    feature = {'type': 'Feature', 'properties': {'navn': kommune['name'], 'kommunekode': kommune['code'].zfill(4)},
               'geometry': round_coords_deep(mapping(area))}
    output.write_text(
        f'/* {kommune["name"]} boundary for the "whole municipality" play area.\n'
        '   Built by scripts/make_kommune_outline.py from OpenStreetMap (ODbL). */\n'
        'window.HS_KOMMUNE_OUTLINE = ' + json.dumps(feature, ensure_ascii=False, separators=(',', ':')) + ';\n',
        encoding='utf-8')
    print(f'wrote {output}: {area.geom_type}, {output.stat().st_size} bytes')


if __name__ == '__main__':
    main()
