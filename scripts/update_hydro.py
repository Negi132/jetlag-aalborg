#!/usr/bin/env python3
"""Build static Limfjord shoreline + body-of-water geometry for Measuring.

The formal OSM ``natural=coastline`` is a good backbone, but urban harbours are
sometimes represented by marina/dock/quay geometry instead of a coastline way.
This generator supplements the fjord shore with those features when they are
both close to the formal Limfjord coastline and adjacent to the playable land.

Water targets preserve every distinct unnamed water feature instead of merging
all generic ``water=lake``/``water=pond`` objects together. Named chalk/limestone
quarries are accepted as a last-resort water-boundary approximation only when
there is no mapped water polygon inside the quarry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import GeometryCollection, LineString, MultiLineString, shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
PLAY = ROOT / 'scripts' / 'play_area.geojson'
OUTPUT = ROOT / 'hydro-data.js'
AUDIT = ROOT / 'HYDRO_AUDIT.md'

# Local degree-scale tolerances are intentional here: everything is constrained
# to Aalborg (~57 N). 0.00045 deg is roughly 30-50 m; 0.010 deg is roughly
# 0.6-1.1 km depending on axis.
LAND_EDGE_TOL_DEG = 0.0010
FORMAL_COAST_NEAR_DEG = 0.010
MOUTH_MATCH_TOL_DEG = 0.00020


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


def iter_lines(g):
    if g is None or g.is_empty:
        return
    if g.geom_type == 'LineString':
        yield g
    elif g.geom_type == 'MultiLineString':
        yield from g.geoms
    elif g.geom_type == 'GeometryCollection':
        for part in g.geoms:
            yield from iter_lines(part)


def fc(features):
    return {'type': 'FeatureCollection', 'features': features}


def clip_feature_geometry(g, play):
    """Return only the part of a hydro geometry that lies in the play area.

    Hydro source collection intentionally uses a padded area so shoreline
    calculations near the edge remain correct. The user-visible bundle must not
    expose that padding, though, so display/target geometries are clipped here.
    """
    try:
        clipped = g.intersection(play)
        if clipped.is_empty:
            return None
        return clipped
    except Exception:
        return None


def feature(g, props):
    return {'type': 'Feature', 'properties': props, 'geometry': mapping(g)}


def osm_identity(props, geom):
    for key in ('@id', 'id', 'osm_id'):
        if props.get(key) not in (None, ''):
            typ = props.get('@type') or props.get('type') or props.get('osm_type') or ''
            return f'{typ}:{props[key]}'
    raw = json.dumps(mapping(geom), sort_keys=True, separators=(',', ':')).encode('utf-8')
    return 'geom:' + hashlib.sha1(raw).hexdigest()[:16]


def generic_water_label(props):
    water = str(props.get('water') or '').strip().replace('_', ' ')
    waterway = str(props.get('waterway') or '').strip().replace('_', ' ')
    landuse = str(props.get('landuse') or '').strip().replace('_', ' ')
    if water:
        return f'Unnamed {water}'
    if waterway:
        return f'Unnamed {waterway}'
    if landuse in ('reservoir', 'basin'):
        return f'Unnamed {landuse}'
    return 'Unnamed body of water'


def classify_shore(line, north_land, south_land):
    dn = line.distance(north_land)
    ds = line.distance(south_land)
    return 'north' if dn <= ds else 'south'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source_geojson', type=Path)
    args = ap.parse_args()

    source = json.loads(args.source_geojson.read_text(encoding='utf-8'))
    play, north_land, south_land = load_play()
    game_land = unary_union([north_land, south_land])
    scope = play.buffer(0.04)

    formal_coast = []
    shoreline_supplements = []
    harbour_areas = []
    raw_water = []
    quarry_fallbacks = []

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

        natural = str(props.get('natural') or '')
        landuse = str(props.get('landuse') or '')
        waterway = str(props.get('waterway') or '')
        leisure = str(props.get('leisure') or '')
        man_made = str(props.get('man_made') or '')
        water = str(props.get('water') or '')
        harbour = str(props.get('harbour') or '')
        name = str(props.get('name') or '').strip()

        if natural == 'coastline':
            ln = lineish(g)
            if ln and not ln.is_empty:
                formal_coast.extend(iter_lines(ln))
            continue

        # Urban harbour shoreline evidence. Marina/dock polygons are useful by
        # their boundary; quays are already line-like. We prune these later so
        # the line across a marina mouth is not mistaken for shoreline.
        is_harbour_support = (
            leisure == 'marina' or waterway == 'dock' or man_made == 'quay' or
            water == 'harbour' or bool(harbour)
        )
        if is_harbour_support:
            ln = lineish(g)
            if ln and not ln.is_empty:
                shoreline_supplements.extend(iter_lines(ln))
            if g.geom_type in ('Polygon', 'MultiPolygon'):
                harbour_areas.append(g)

        is_water = (
            natural == 'water' or landuse in ('reservoir', 'basin') or
            waterway in ('riverbank', 'river', 'canal')
        )
        if is_water and g.geom_type in ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'):
            raw_water.append((props, g))

        # Rørdal/Portland and similar chalk pits can be mapped as the quarry
        # perimeter with no separate water polygon. Only use that perimeter as
        # an approximation when the name clearly denotes a chalk/limestone pit.
        nq = norm(name)
        if landuse == 'quarry' and g.geom_type in ('Polygon', 'MultiPolygon') and any(
            token in nq for token in ('kridtgrav', 'kalkgrav', 'chalk pit', 'limestone quarry')
        ):
            quarry_fallbacks.append((props, g))

    if not formal_coast:
        raise RuntimeError('Could not identify the formal Limfjord coastline')

    formal_union = unary_union(formal_coast)
    # If OSM's formal coastline closes a marina/dock across its entrance, remove
    # the formal line through that mapped harbour area. We then replace it with
    # the harbour/quay boundary below. This is what makes the distance follow
    # into basins such as Vestre Bådehavn rather than cutting across the mouth.
    cleaned_formal = formal_union
    for area in harbour_areas:
        try:
            cleaned_formal = cleaned_formal.difference(area.buffer(MOUTH_MATCH_TOL_DEG))
        except Exception:
            pass

    # Supplements must be close to the formal fjord and adjacent to playable
    # land. Also remove the parts that overlap the old formal coastline: on a
    # marina polygon that overlap is normally the artificial entrance-closing
    # edge, not the inner basin shoreline we want.
    formal_near = formal_union.buffer(FORMAL_COAST_NEAR_DEG)
    formal_mouth_near = formal_union.buffer(MOUTH_MATCH_TOL_DEG)
    land_near = game_land.buffer(LAND_EDGE_TOL_DEG)
    accepted_supplements = []
    for ln in shoreline_supplements:
        try:
            clipped = ln.difference(formal_mouth_near).intersection(formal_near).intersection(land_near)
        except Exception:
            continue
        for part in iter_lines(clipped):
            if part.length > 1e-6:
                accepted_supplements.append(part)

    shore_lines = list(iter_lines(cleaned_formal)) + accepted_supplements
    # unary_union removes duplicated coincident stretches where a quay and a
    # marina/dock boundary describe the same physical water edge.
    shore_union = unary_union(shore_lines)

    # Keep a slightly broader, HIDDEN distance cache so a player close to the
    # outer play boundary still gets the true nearest shoreline. The visible
    # coastline is clipped strictly to the playable polygon.
    distance_north_parts, distance_south_parts = [], []
    visible_north_parts, visible_south_parts = [], []
    for ln in iter_lines(shore_union):
        side = classify_shore(ln, north_land, south_land)
        props = {'name': 'Limfjorden', '__hydroKind': 'coastline', '__shoreSide': side}
        (distance_north_parts if side == 'north' else distance_south_parts).append(feature(ln, props))
        clipped = clip_feature_geometry(ln, play)
        if clipped and not clipped.is_empty:
            for part in iter_lines(clipped):
                (visible_north_parts if side == 'north' else visible_south_parts).append(feature(part, props))

    if not visible_north_parts or not visible_south_parts:
        raise RuntimeError(f'Could not identify both Limfjord shores inside play area (north={len(visible_north_parts)}, south={len(visible_south_parts)})')

    # Keep each unnamed water independently. Only explicitly named features are
    # merged by name (multiple polygons/segments of the same named lake/river).
    named = defaultdict(list)
    unnamed = []
    all_water_geoms = []
    for props, g in raw_water:
        explicit_name = str(props.get('name') or '').strip()
        if explicit_name:
            named[norm(explicit_name)].append((explicit_name, g, props))
        else:
            unnamed.append((generic_water_label(props), g, props))
        all_water_geoms.append(g)

    # Quarry perimeter fallback only if there is no mapped water geometry in it.
    quarry_added = []
    for props, q in quarry_fallbacks:
        has_inner_water = False
        for wg in all_water_geoms:
            try:
                inter = q.intersection(wg)
                if not inter.is_empty and (inter.area > 1e-10 or inter.length > 1e-5):
                    has_inner_water = True
                    break
            except Exception:
                pass
        if not has_inner_water:
            quarry_added.append((str(props.get('name') or 'Kridtgrav'), q, props))

    water_features = []
    for _, parts in sorted(named.items()):
        label = parts[0][0]
        polygons = [g for _, g, _ in parts if g.geom_type in ('Polygon', 'MultiPolygon')]
        lines = [g for _, g, _ in parts if g.geom_type in ('LineString', 'MultiLineString')]
        chosen = polygons or lines
        if not chosen:
            continue
        try:
            merged = unary_union(chosen)
        except Exception:
            merged = chosen[0]
        if not merged.is_empty:
            clipped = clip_feature_geometry(merged, play)
            if clipped and not clipped.is_empty:
                water_features.append(feature(clipped, {
                    'name': label, '__hydroKind': 'water', '__waterSource': 'osm-named',
                    '__waterId': 'name:' + norm(label)
                }))

    for label, g, props in unnamed:
        if g.is_empty:
            continue
        clipped = clip_feature_geometry(g, play)
        if not clipped or clipped.is_empty:
            continue
        water_features.append(feature(clipped, {
            'name': label, '__hydroKind': 'water', '__waterSource': 'osm-unnamed',
            '__waterId': osm_identity(props, g), '__unnamed': True
        }))

    for label, g, props in quarry_added:
        clipped = clip_feature_geometry(g, play)
        if not clipped or clipped.is_empty:
            continue
        water_features.append(feature(clipped, {
            'name': label, '__hydroKind': 'water', '__waterSource': 'quarry-fallback',
            '__waterId': osm_identity(props, g), '__approximateBoundary': True
        }))

    # The fjord itself is represented by its IN-PLAY shoreline. This keeps its
    # reference marker and water-distance target inside the game boundary.
    fjord_visible = unary_union([shape(ft['geometry']) for ft in visible_north_parts + visible_south_parts])
    water_features.append(feature(fjord_visible, {
        'name': 'Limfjorden', '__hydroKind': 'fjord', '__waterSource': 'shoreline',
        '__waterId': 'fjord:limfjorden'
    }))

    now = datetime.now(timezone.utc).isoformat()
    bundle = {
        'version': 3, 'ready': True, 'generatedAt': now,
        'coastlines': {'north': fc(visible_north_parts), 'south': fc(visible_south_parts)},
        'coastlineDistance': {'north': fc(distance_north_parts), 'south': fc(distance_south_parts)},
        'waterBodies': fc(water_features),
    }
    payload = '/* Generated from Geofabrik/OpenStreetMap water geometry. Do not edit by hand. */\n' \
              + 'window.AALBORG_HYDRO_DATA = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n'
    tmp = OUTPUT.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(OUTPUT)

    named_labels = sorted({(f.get('properties') or {}).get('name', '') for f in water_features
                           if (f.get('properties') or {}).get('name') and not (f.get('properties') or {}).get('__unnamed')})
    unnamed_count = sum(1 for f in water_features if (f.get('properties') or {}).get('__unnamed'))
    quarry_count = sum(1 for f in water_features if (f.get('properties') or {}).get('__waterSource') == 'quarry-fallback')
    AUDIT.write_text('\n'.join([
        '# Aalborg hydro snapshot audit', '',
        f'- Generated: `{now}`',
        f'- Formal OSM coastline pieces before harbour supplementation: **{len(formal_coast)}**',
        f'- Accepted marina/dock/quay shoreline supplements: **{len(accepted_supplements)}**',
        f'- Visible northern Limfjord coastline pieces inside play area: **{len(visible_north_parts)}**',
        f'- Visible southern Limfjord coastline pieces inside play area: **{len(visible_south_parts)}**',
        f'- Hidden northern distance-cache pieces: **{len(distance_north_parts)}**',
        f'- Hidden southern distance-cache pieces: **{len(distance_south_parts)}**',
        f'- Total body-of-water targets: **{len(water_features)}**',
        f'- Distinct unnamed mapped water targets: **{unnamed_count}**',
        f'- Chalk/limestone quarry fallback targets: **{quarry_count}**', '',
        '## Named body-of-water targets', '', ', '.join(named_labels) or '_None_', ''
    ]), encoding='utf-8')
    print(
        f'Hydro cache: formal coast={len(formal_coast)}, harbour supplements={len(accepted_supplements)}, '
        f'visible north coast={len(visible_north_parts)}, visible south coast={len(visible_south_parts)}, '
        f'water bodies={len(water_features)} (unnamed={unnamed_count}, quarry fallback={quarry_count})'
    )


if __name__ == '__main__':
    main()
