#!/usr/bin/env python3
"""Build static Limfjord-coastline and named-water geometry for Measuring."""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
PLAY = ROOT / 'scripts' / 'play_area.geojson'
OUTPUT = ROOT / 'hydro-data.js'
AUDIT = ROOT / 'HYDRO_AUDIT.md'


def norm(value):
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = s.lower().replace('æ', 'ae').replace('ø', 'o').replace('å', 'a')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip().replace('aa', 'a')


def load_play():
    data = json.loads(PLAY.read_text(encoding='utf-8'))
    features = data.get('features', [])
    all_geoms = []
    north_geoms = []
    for ft in features:
        if not ft.get('geometry'):
            continue
        g = shape(ft['geometry'])
        all_geoms.append(g)
        p = ft.get('properties') or {}
        n = p.get('n') or p.get('area')
        name = norm(p.get('name') or p.get('navn'))
        if str(n) == '2' or 'norresundby' in name:
            north_geoms.append(g)
    play = unary_union(all_geoms)
    north = unary_union(north_geoms)
    south = play.difference(north)
    return play, north, south


def lineish(g):
    if g.geom_type in ('LineString', 'MultiLineString'):
        return g
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        return g.boundary
    return None


def fc(features):
    return {'type': 'FeatureCollection', 'features': features}


def feature(g, props):
    return {'type': 'Feature', 'properties': props, 'geometry': mapping(g)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source_geojson', type=Path)
    args = ap.parse_args()

    source = json.loads(args.source_geojson.read_text(encoding='utf-8'))
    play, north_land, south_land = load_play()
    scope = play.buffer(0.04)

    north_coast, south_coast = [], []
    water_by_name = defaultdict(list)

    for ft in source.get('features', []):
        props = ft.get('properties') or {}
        geom_raw = ft.get('geometry')
        if not geom_raw:
            continue
        try:
            g = shape(geom_raw)
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty or not g.intersects(scope):
                continue
            g = g.intersection(scope)
            if g.is_empty:
                continue
        except Exception:
            continue

        if props.get('natural') == 'coastline':
            ln = lineish(g)
            if not ln or ln.is_empty:
                continue
            # A fjord shore lies on one landmass boundary. Whichever game
            # landmass is spatially closer identifies north vs south shore.
            dn = ln.distance(north_land)
            ds = ln.distance(south_land)
            target = north_coast if dn <= ds else south_coast
            target.append(feature(ln, {'name': 'Limfjorden', '__hydroKind': 'coastline'}))
            continue

        natural = str(props.get('natural') or '')
        landuse = str(props.get('landuse') or '')
        waterway = str(props.get('waterway') or '')
        is_water = natural == 'water' or landuse in ('reservoir', 'basin') or waterway in ('riverbank', 'river', 'canal')
        if not is_water:
            continue
        name = str(props.get('name') or props.get('water') or '').strip()
        if not name:
            continue
        if g.geom_type not in ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'):
            continue
        water_by_name[norm(name)].append((name, g))

    if not north_coast or not south_coast:
        raise RuntimeError(f'Could not identify both Limfjord shores (north={len(north_coast)}, south={len(south_coast)})')

    # Merge same-named water features so, for example, multiple pieces of one
    # lake/river behave as one Measuring target.
    water_features = []
    for _, parts in sorted(water_by_name.items()):
        label = parts[0][0]
        polygons = [g for _, g in parts if g.geom_type in ('Polygon', 'MultiPolygon')]
        lines = [g for _, g in parts if g.geom_type in ('LineString', 'MultiLineString')]
        chosen_parts = polygons or lines
        if not chosen_parts:
            continue
        try:
            merged = unary_union(chosen_parts)
        except Exception:
            merged = chosen_parts[0]
        if not merged.is_empty and merged.geom_type in ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'):
            water_features.append(feature(merged, {'name': label, '__hydroKind': 'water'}))

    # The fjord itself is represented by its shores in OSM. Add it explicitly
    # as a body-of-water distance target so it competes naturally with lakes.
    all_coast_geoms = [shape(f['geometry']) for f in north_coast + south_coast]
    limfjord = unary_union(all_coast_geoms)
    water_features.append(feature(limfjord, {'name': 'Limfjorden', '__hydroKind': 'fjord'}))

    now = datetime.now(timezone.utc).isoformat()
    bundle = {
        'version': 1, 'ready': True, 'generatedAt': now,
        'coastlines': {'north': fc(north_coast), 'south': fc(south_coast)},
        'waterBodies': fc(water_features),
    }
    payload = '/* Generated from Geofabrik/OpenStreetMap water geometry. Do not edit by hand. */\n' \
              + 'window.AALBORG_HYDRO_DATA = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n'
    tmp = OUTPUT.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(OUTPUT)

    names = sorted({(f.get('properties') or {}).get('name', '') for f in water_features if (f.get('properties') or {}).get('name')})
    AUDIT.write_text('\n'.join([
        '# Aalborg hydro snapshot audit', '',
        f'- Generated: `{now}`',
        f'- Northern Limfjord coastline pieces: **{len(north_coast)}**',
        f'- Southern Limfjord coastline pieces: **{len(south_coast)}**',
        f'- Named body-of-water targets: **{len(water_features)}**', '',
        '## Body-of-water targets', '', ', '.join(names) or '_None_', ''
    ]), encoding='utf-8')
    print(f'Hydro cache: north coast={len(north_coast)}, south coast={len(south_coast)}, water bodies={len(water_features)}')


if __name__ == '__main__':
    main()
