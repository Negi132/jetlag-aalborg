#!/usr/bin/env python3
"""Build static, generalized Limfjord shoreline + water geometry.

Coastline Measuring uses a MEDIUM-DETAIL generalized shoreline generated only from OSM
``natural=coastline``.  We intentionally do not infer shoreline from roads,
railways, promenades, quays, embankments, or other urban features: that proved
too easy to contaminate in dense Aalborg mapping.  For each bank we sample the formal coast, keep the fjord-facing envelope, apply only modest
smoothing to suppress harbour micro-detail, and simplify it. The result follows the
general bends of both banks while avoiding every tiny quay/basin vertex.

Water targets preserve every distinct mapped water feature (plus cautious
chalk/limestone-quarry fallbacks).  A separate pre-unioned/simplified distance
geometry is emitted so the browser can buffer one or two geometries instead of
buffering every water body independently on every drag.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from statistics import median
import math
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import GeometryCollection, LineString, MultiLineString, shape, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
PLAY = ROOT / 'scripts' / 'play_area.geojson'
OUTPUT = ROOT / 'hydro-data.js'
AUDIT = ROOT / 'HYDRO_AUDIT.md'

# Local degree-scale tolerances are intentional here: everything is constrained
# to Aalborg (~57 N). The shoreline is intentionally an approximation: roughly
# one envelope sample every 80-100 m, then a small smoothing window and a
# topology-safe simplification. This is plenty for a city-scale question while
# making the runtime buffer dramatically cheaper.
# Medium-detail bank: roughly 30-35 m longitude bins at Aalborg, with a
# rolling window of only ~150-200 m. This follows the general shoreline much
# more closely than v5's ~1-2 km smoothing while still bridging small marina
# indentations and OSM vertex noise.
ABSTRACT_BIN_DEG = 0.00055
ABSTRACT_SAMPLE_STEP_DEG = 0.00025
ABSTRACT_MAX_GAP_DEG = 0.007
ABSTRACT_SMOOTH_BINS = 2
ABSTRACT_OUTLIER_BINS = 5
ABSTRACT_OUTLIER_DEG = 0.00036
ABSTRACT_SIMPLIFY_DEG = 0.00008
ABSTRACT_OPPOSITE_BANK_MAX_DEG = 0.035
ABSTRACT_DISTANCE_PAD_DEG = 0.012

# Water polygons retain substantially more detail than the generalized coast, but
# do not need centimetre-level OSM vertex density for this game.
WATER_VISIBLE_SIMPLIFY_DEG = 0.000035
WATER_DISTANCE_SIMPLIFY_DEG = 0.000180


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


def water_feature(g, props):
    """Emit browser-ready water metadata so opening the card does no Turf work."""
    p = dict(props)
    try:
        rp = g.representative_point()
        p['__markerCoord'] = [round(float(rp.x), 7), round(float(rp.y), 7)]
    except Exception:
        pass
    try:
        xmin, ymin, xmax, ymax = g.bounds
        p['__bbox'] = [round(float(xmin), 7), round(float(ymin), 7),
                       round(float(xmax), 7), round(float(ymax), 7)]
    except Exception:
        pass
    return feature(g, p)


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


def densified_points(line, step=ABSTRACT_SAMPLE_STEP_DEG):
    if line is None or line.is_empty or line.length <= 0:
        return []
    n = max(2, int(math.ceil(line.length / step)) + 1)
    return [line.interpolate(i / (n - 1), normalized=True).coords[0] for i in range(n)]


def generalized_bank(formal_lines, side, north_land, south_land, play):
    """Return a stable medium-detail approximation of one Limfjord bank.

    Only formal ``natural=coastline`` contributes. Within each short longitude
    bin we keep the point facing the open fjord, then apply modest local median
    smoothing. This follows the broad curves of each bank while bridging only
    small harbour/marina indentations.
    """
    opposite = south_land if side == 'north' else north_land
    xmin, ymin, xmax, ymax = play.bounds
    points = []
    for ln in formal_lines:
        if classify_shore(ln, north_land, south_land) != side:
            continue
        # Exclude unrelated outer coastlines: a Limfjord bank must remain close
        # enough to playable land on the opposite side of the fjord.
        if ln.distance(opposite) > ABSTRACT_OPPOSITE_BANK_MAX_DEG:
            continue
        for x, y in densified_points(ln):
            if xmin - ABSTRACT_DISTANCE_PAD_DEG <= x <= xmax + ABSTRACT_DISTANCE_PAD_DEG:
                points.append((x, y))
    if len(points) < 4:
        return []

    buckets = defaultdict(list)
    x0 = xmin - ABSTRACT_DISTANCE_PAD_DEG
    for x, y in points:
        buckets[int(math.floor((x - x0) / ABSTRACT_BIN_DEG))].append((x, y))

    raw = []
    for idx in sorted(buckets):
        vals = buckets[idx]
        # Median x avoids one dense OSM way dominating a bin.
        x = median([v[0] for v in vals])
        # Fjord-facing envelope: lower latitude on the north bank, higher on
        # the south bank. This intentionally bridges harbour/marina inlets.
        y = min(v[1] for v in vals) if side == 'north' else max(v[1] for v in vals)
        raw.append((x, y))
    if len(raw) < 2:
        return []

    # Suppress only obvious harbour/marina excursions. The shorter v6 window
    # deliberately preserves ordinary bends in the general fjord boundary.
    cleaned = []
    for i, (x, y) in enumerate(raw):
        lo = max(0, i - ABSTRACT_OUTLIER_BINS)
        hi = min(len(raw), i + ABSTRACT_OUTLIER_BINS + 1)
        local = median([raw[j][1] for j in range(lo, hi)])
        cleaned.append((x, local if abs(y - local) > ABSTRACT_OUTLIER_DEG else y))

    # A short rolling median removes minor OSM vertex noise without flattening
    # the overall bank shape.
    smooth = []
    for i, (x, y) in enumerate(cleaned):
        lo = max(0, i - ABSTRACT_SMOOTH_BINS)
        hi = min(len(cleaned), i + ABSTRACT_SMOOTH_BINS + 1)
        smooth.append((x, median([cleaned[j][1] for j in range(lo, hi)])))

    segments, current = [], [smooth[0]]
    for pt in smooth[1:]:
        if pt[0] - current[-1][0] > ABSTRACT_MAX_GAP_DEG:
            if len(current) >= 2:
                segments.append(current)
            current = [pt]
        else:
            current.append(pt)
    if len(current) >= 2:
        segments.append(current)

    out = []
    for coords in segments:
        ln = LineString(coords).simplify(ABSTRACT_SIMPLIFY_DEG, preserve_topology=False)
        if not ln.is_empty and ln.length > 1e-5:
            out.append(ln)
    return out


def simplify_water(g, tolerance=WATER_VISIBLE_SIMPLIFY_DEG):
    try:
        simplified = g.simplify(tolerance, preserve_topology=True)
        return simplified if not simplified.is_empty else g
    except Exception:
        return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source_geojson', type=Path)
    args = ap.parse_args()

    source = json.loads(args.source_geojson.read_text(encoding='utf-8'))
    play, north_land, south_land = load_play()
    scope = play.buffer(0.04)

    formal_coast = []
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

    # Build a medium-detail two-bank shoreline from ONLY the formal OSM
    # coastline. Urban roads/railways/quays can therefore never leak into the
    # Measuring geometry.
    generalized_north = generalized_bank(formal_coast, 'north', north_land, south_land, play)
    generalized_south = generalized_bank(formal_coast, 'south', north_land, south_land, play)
    if not generalized_north or not generalized_south:
        raise RuntimeError(
            f'Could not construct both generalized Limfjord banks (north={len(generalized_north)}, south={len(generalized_south)})'
        )

    visible_north_parts, visible_south_parts = [], []
    distance_north_parts, distance_south_parts = [], []
    distance_scope = play.buffer(ABSTRACT_DISTANCE_PAD_DEG)
    for side, lines, visible_out, distance_out in (
        ('north', generalized_north, visible_north_parts, distance_north_parts),
        ('south', generalized_south, visible_south_parts, distance_south_parts),
    ):
        props = {'name': 'Limfjorden', '__hydroKind': 'coastline', '__shoreSide': side, '__generalized': True}
        for ln in lines:
            dclip = ln.intersection(distance_scope)
            for part in iter_lines(dclip):
                if part.length > 1e-6:
                    distance_out.append(feature(part, props))
            clipped = clip_feature_geometry(ln, play)
            if clipped and not clipped.is_empty:
                for part in iter_lines(clipped):
                    if part.length > 1e-6:
                        visible_out.append(feature(part, props))

    if not visible_north_parts or not visible_south_parts:
        raise RuntimeError(
            f'Abstract shoreline did not intersect both banks inside play area (north={len(visible_north_parts)}, south={len(visible_south_parts)})'
        )

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
                clipped = simplify_water(clipped)
                water_features.append(water_feature(clipped, {
                    'name': label, '__hydroKind': 'water', '__waterSource': 'osm-named',
                    '__waterId': 'name:' + norm(label)
                }))

    for label, g, props in unnamed:
        if g.is_empty:
            continue
        clipped = clip_feature_geometry(g, play)
        if not clipped or clipped.is_empty:
            continue
        clipped = simplify_water(clipped)
        water_features.append(water_feature(clipped, {
            'name': label, '__hydroKind': 'water', '__waterSource': 'osm-unnamed',
            '__waterId': osm_identity(props, g), '__unnamed': True
        }))

    for label, g, props in quarry_added:
        clipped = clip_feature_geometry(g, play)
        if not clipped or clipped.is_empty:
            continue
        clipped = simplify_water(clipped)
        water_features.append(water_feature(clipped, {
            'name': label, '__hydroKind': 'water', '__waterSource': 'quarry-fallback',
            '__waterId': osm_identity(props, g), '__approximateBoundary': True
        }))

    # The fjord itself is represented by the two generalized in-play shorelines.
    fjord_visible = unary_union([shape(ft['geometry']) for ft in visible_north_parts + visible_south_parts])
    water_features.append(water_feature(fjord_visible, {
        'name': 'Limfjorden', '__hydroKind': 'fjord', '__waterSource': 'generalized-shoreline',
        '__waterId': 'fjord:limfjorden', '__generalized': True
    }))

    # PRE-UNION the expensive Measuring target geometry. The browser still gets
    # each individual body for marker/name selection, but Closer/Further only
    # has to buffer at most one MultiPolygon and one MultiLineString.
    distance_polys, distance_lines = [], []
    for ft in water_features:
        try:
            g = shape(ft['geometry'])
        except Exception:
            continue
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            distance_polys.append(g)
        elif g.geom_type in ('LineString', 'MultiLineString'):
            distance_lines.append(g)
    water_distance_features = []
    if distance_polys:
        g = unary_union(distance_polys).simplify(WATER_DISTANCE_SIMPLIFY_DEG, preserve_topology=True)
        if not g.is_empty:
            water_distance_features.append(feature(g, {'__hydroKind': 'water-distance', '__geometryKind': 'area'}))
    if distance_lines:
        g = unary_union(distance_lines).simplify(WATER_DISTANCE_SIMPLIFY_DEG, preserve_topology=False)
        if not g.is_empty:
            water_distance_features.append(feature(g, {'__hydroKind': 'water-distance', '__geometryKind': 'line'}))

    now = datetime.now(timezone.utc).isoformat()
    bundle = {
        'version': 6, 'ready': True, 'generatedAt': now,
        'coastlines': {'north': fc(visible_north_parts), 'south': fc(visible_south_parts)},
        'coastlineDistance': {'north': fc(distance_north_parts), 'south': fc(distance_south_parts)},
        'waterBodies': fc(water_features),
        'waterDistance': fc(water_distance_features),
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
        f'- Formal OSM coastline pieces used as source: **{len(formal_coast)}**',
        f'- Generalized northern shoreline pieces: **{len(visible_north_parts)}**',
        f'- Generalized southern shoreline pieces: **{len(visible_south_parts)}**',
        f'- Shoreline inference from roads/railways/quays/paths: **disabled**',
        f'- Hidden northern distance-cache pieces: **{len(distance_north_parts)}**',
        f'- Hidden southern distance-cache pieces: **{len(distance_south_parts)}**',
        f'- Total body-of-water targets: **{len(water_features)}**',
        f'- Pre-unioned water-distance geometries: **{len(water_distance_features)}**',
        f'- Distinct unnamed mapped water targets: **{unnamed_count}**',
        f'- Chalk/limestone quarry fallback targets: **{quarry_count}**', '',
        '## Named body-of-water targets', '', ', '.join(named_labels) or '_None_', ''
    ]), encoding='utf-8')
    print(
        f'Hydro cache: formal coast source={len(formal_coast)}, generalized north={len(visible_north_parts)}, generalized south={len(visible_south_parts)}, '
        f'water bodies={len(water_features)} (unnamed={unnamed_count}, quarry fallback={quarry_count}), '
        f'pre-unioned water distance geometries={len(water_distance_features)}'
    )


if __name__ == '__main__':
    main()
