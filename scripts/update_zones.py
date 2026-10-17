#!/usr/bin/env python3
"""Snapshot a city's four official game-zone WFS layers (Aalborg: KortInfo).

The browser prefers the generated local bundle for instant play. The live WFS
remains an emergency fallback. Zone 2 defines the exact game area. For display,
all four cached layers are clipped to that game area to avoid shipping/drawing
irrelevant municipal geometry. Real administrative border lines are cached
separately from the unclipped official polygons, so artificial clip edges can
never be mistaken for genuine Measuring borders.
"""
from __future__ import annotations

import argparse
import sys
import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for `common`, even under python -I
from common import DEFAULT_CITY, add_city_argument, load_city, load_play_area, normalise_name

GLOBAL_NAME = 'HS_ZONE_DATA'


def use_city(city_id: str = DEFAULT_CITY):
    """Point the generator at a city: its zone service, layers, play areas and files."""
    global CITY, OUTPUT, AUDIT, PLAY_OUTPUT, SERVICE, ENDPOINT, LAYERS, MIN_COUNTS, ZONE2_ALIASES, PLAY_AREA_KM2
    CITY = load_city(city_id)
    zones = CITY.config['zones']
    OUTPUT = CITY.path('zone-data.js')
    AUDIT = CITY.path('ZONE_AUDIT.md')
    PLAY_OUTPUT = CITY.play_area
    SERVICE = zones['service']
    ENDPOINT = zones['serviceUrl']
    LAYERS = {key: src['typeName'] for key, src in zones['sources'].items()}
    MIN_COUNTS = dict(zones['minCounts'])
    ZONE2_ALIASES = [(a['area'], a['name'], tuple(a['aliases'])) for a in zones['areas']]
    PLAY_AREA_KM2 = tuple(zones['playAreaKm2'])
    return CITY


use_city()


def norm_text(value):
    return normalise_name(value)


def zone2_def(props):
    hay = norm_text(' | '.join(str(v) for v in (props or {}).values() if isinstance(v, (str, int, float))))
    for number, name, aliases in ZONE2_ALIASES:
        if any(alias in hay for alias in aliases):
            return number, name
    return None


def annotate_zone2(features):
    """Return only polygon parts belonging to the four game Zone-2 areas.

    KortInfo can ignore BBOX filters and return additional polygons. The browser
    already filters the official layer down to the four recognised play areas
    before building the play-area union; the scheduled snapshot must do the same.
    Keeping unrelated Zone-2 polygons here can silently expand the game area by
    tens of kilometres and then poison every downstream GTFS/OSM extraction.
    """
    recognised = set()
    out = []
    for ft in features:
        cp = dict(ft)
        props = dict(cp.get('properties') or {})
        definition = zone2_def(props)
        if not definition:
            continue
        number, name = definition
        props.update({'n': number, 'area': number, 'name': name, 'navn': name, 'playZone': True})
        recognised.add(number)
        cp['properties'] = props
        out.append(cp)
    if recognised != {1, 2, 3, 4}:
        raise RuntimeError(f'Could not identify all four named Zone 2 areas; found {sorted(recognised)}')
    return out


def local_name(tag):
    return str(tag or '').split('}', 1)[-1].split(':')[-1]


def _numbers(text):
    import re
    out = []
    for token in re.split(r'[\s,]+', (text or '').strip()):
        if not token:
            continue
        try:
            out.append(float(token))
        except ValueError:
            pass
    return out


def _rings_of(node):
    """Read Polygon/LinearRing coordinates from either GML2 or GML3."""
    for wanted in ('posList', 'coordinates'):
        rings = []
        for el in node.iter():
            if local_name(el.tag) != wanted:
                continue
            vals = _numbers(el.text)
            ring = [[vals[i], vals[i + 1]] for i in range(0, len(vals) - 1, 2)]
            if len(ring) >= 4:
                if ring[0][:2] != ring[-1][:2]:
                    ring.append(ring[0][:2])
                rings.append(ring)
        if rings:
            return rings
    return []


def parse_gml(raw: bytes):
    """Mirror the browser's proven KortInfo GML fallback parser."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        preview = raw[:160].decode('utf-8', errors='replace').replace('\n', ' ')
        raise RuntimeError(f'{SERVICE} reply was neither GeoJSON nor parseable GML: {preview!r}') from exc

    for el in root.iter():
        if local_name(el.tag) == 'ServiceException':
            raise RuntimeError((''.join(el.itertext()).strip() or f'{SERVICE} service exception')[:240])

    members = [el for el in root.iter() if local_name(el.tag) in ('featureMember', 'member')]
    hosts = members or [root]
    features = []
    ignored_leaf_names = {'posList', 'coordinates', 'pos', 'lowerCorner', 'upperCorner'}

    for host in hosts:
        props = {}
        for el in host.iter():
            if list(el):
                continue
            name = local_name(el.tag)
            if name in ignored_leaf_names:
                continue
            text = (el.text or '').strip()
            if text and len(text) < 240 and name not in props:
                props[name] = text

        polygons = [el for el in host.iter() if local_name(el.tag) == 'Polygon']
        if polygons:
            for polygon in polygons:
                rings = _rings_of(polygon)
                if rings:
                    features.append({
                        'type': 'Feature', 'properties': dict(props),
                        'geometry': {'type': 'Polygon', 'coordinates': rings},
                    })
            continue

        # Not expected for the four zone layers, but retain line support so the
        # parser behaves like the browser fallback if KortInfo changes wrapping.
        for line in (el for el in host.iter() if local_name(el.tag) == 'LineString'):
            rings = _rings_of(line)
            if rings:
                features.append({
                    'type': 'Feature', 'properties': dict(props),
                    'geometry': {'type': 'LineString', 'coordinates': rings[0]},
                })

    if not features:
        raise RuntimeError(f'{SERVICE} returned GML but no usable feature geometry was found')
    return {'type': 'FeatureCollection', 'features': features}


def _request_feature_collection(type_name: str, params: dict, timeout: int):
    query = {
        'service': 'WFS', 'version': '1.0.0', 'request': 'GetFeature',
        'typeName': type_name, **params,
    }
    url = ENDPOINT + '&' + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; jetlag-aalborg-map-updater/1.2)',
        'Accept': 'application/gml+xml, application/xml, text/xml, application/json, */*',
    })
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read()
        content_type = response.headers.get('Content-Type', '')

    try:
        data = json.loads(raw.decode('utf-8-sig'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = parse_gml(raw)

    if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
        raise RuntimeError(f'{SERVICE} did not return a feature collection (Content-Type: {content_type})')
    if not data['features']:
        raise RuntimeError(f'{SERVICE} answered with zero features')
    return data


def _query_bounds():
    # Use the committed play-area fallback/cache to ask the service only for
    # features that intersect the game vicinity. WFS BBOX filtering returns
    # the complete matching features; it does not geometrically clip them, so
    # this cannot create fake administrative borders.
    west, south, east, north = CITY.bounds('search')
    try:
        if PLAY_OUTPUT.exists():
            fc = json.loads(PLAY_OUTPUT.read_text(encoding='utf-8'))
            geoms = [shape(ft['geometry']) for ft in fc.get('features', []) if ft.get('geometry')]
            if geoms:
                minx, miny, maxx, maxy = unary_union(geoms).bounds
                west, south, east, north = minx - .06, miny - .05, maxx + .06, maxy + .05
    except Exception:
        pass
    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:25832', always_xy=True)
    x1, y1 = to_utm.transform(west, south)
    x2, y2 = to_utm.transform(east, north)
    return (west, south, east, north), (min(x1,x2), min(y1,y2), max(x1,x2), max(y1,y2))


def fetch_json(type_name: str):
    bbox_wgs, bbox_utm = _query_bounds()
    # First ask for native/projected GML. KortInfo commonly serves GML/UTM32
    # anyway, and avoiding server-side GeoJSON conversion/reprojection makes
    # the large Zone 1/4 layers substantially cheaper. Then try the browser-
    # style WGS84/GeoJSON request once as a compatibility fallback.
    strategies = [
        ({
            'srsName': 'EPSG:25832',
            'bbox': ','.join(f'{v:.3f}' for v in bbox_utm) + ',EPSG:25832',
        }, 18),
        ({
            'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
            'bbox': ','.join(f'{v:.7f}' for v in bbox_wgs) + ',EPSG:4326',
        }, 12),
    ]
    errors = []
    for params, timeout in strategies:
        try:
            return _request_feature_collection(type_name, params, timeout)
        except Exception as exc:
            errors.append(str(exc))
    raise RuntimeError(f'Could not download {type_name}: ' + ' | '.join(errors[-2:]))


def first_coord(obj):
    if isinstance(obj, (list, tuple)):
        if len(obj) >= 2 and all(isinstance(v, (int, float)) for v in obj[:2]):
            return obj[:2]
        for item in obj:
            got = first_coord(item)
            if got:
                return got
    return None


def swap_coords(obj):
    if isinstance(obj, list):
        if len(obj) >= 2 and all(isinstance(v, (int, float)) for v in obj[:2]):
            return [obj[1], obj[0], *obj[2:]]
        return [swap_coords(x) for x in obj]
    return obj


def _map_coords(obj, fn):
    if isinstance(obj, (list, tuple)):
        if len(obj) >= 2 and all(isinstance(v, (int, float)) for v in obj[:2]):
            x, y = fn(float(obj[0]), float(obj[1]))
            return [x, y, *obj[2:]]
        return [_map_coords(x, fn) for x in obj]
    return obj


def _is_position(value):
    return isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2])


def _drop_repeated_positions(coords):
    """Remove consecutive duplicate positions from every line/ring in a coordinates array.

    Rounding can merge neighbouring vertices, and a zero-length segment makes
    Turf's point-to-line distance fail in the browser.
    """
    if not isinstance(coords, list) or not coords:
        return coords
    if _is_position(coords[0]):
        clean = [p for i, p in enumerate(coords) if i == 0 or p[:2] != coords[i - 1][:2]]
        closed = len(coords) >= 4 and coords[0][:2] == coords[-1][:2]
        return clean if len(clean) >= (4 if closed else 2) else coords
    if _is_position(coords):
        return coords
    return [_drop_repeated_positions(c) for c in coords]


def drop_degenerate_lines(fc):
    """Strip repeated vertices from border lines; drop lines that collapse to a point."""
    def clean(line):
        out = [p for i, p in enumerate(line) if i == 0 or p[:2] != line[i - 1][:2]]
        return out if len(out) >= 2 else None

    features = []
    for ft in fc.get('features', []):
        g = ft.get('geometry') or {}
        if g.get('type') == 'LineString':
            line = clean(g['coordinates'])
            if line:
                features.append(dict(ft, geometry={'type': 'LineString', 'coordinates': line}))
        elif g.get('type') == 'MultiLineString':
            parts = [line for line in map(clean, g['coordinates']) if line]
            if parts:
                features.append(dict(ft, geometry={'type': 'MultiLineString', 'coordinates': parts}))
        else:
            features.append(ft)
    return dict(fc, features=features)


def round_coords(obj, ndigits=6):
    """Round every coordinate in a GeoJSON object (6 decimals is about 0.1 m)."""
    if isinstance(obj, dict):
        return {k: (_drop_repeated_positions(_map_coords(v, lambda x, y: (round(x, ndigits), round(y, ndigits))))
                    if k == 'coordinates' else round_coords(v, ndigits))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [round_coords(v, ndigits) for v in obj]
    return obj


def normalise_axis_order(gj):
    """Return all cached zone geometry as GeoJSON longitude/latitude.

    KortInfo can ignore srsName and send EPSG:25832 metres, or send EPSG:4326
    with latitude/longitude axis order. The browser already copes with both;
    the build-time snapshot must too because downstream generators consume
    the city's play_area.geojson directly.
    """
    sample = None
    for ft in gj.get('features', []):
        geom = ft.get('geometry') or {}
        sample = first_coord(geom.get('coordinates'))
        if sample:
            break
    if not sample:
        return gj

    if abs(sample[0]) > 180 or abs(sample[1]) > 90:
        transformer = Transformer.from_crs('EPSG:25832', 'EPSG:4326', always_xy=True)
        fn = lambda x, y: transformer.transform(x, y)
        for ft in gj.get('features', []):
            geom = ft.get('geometry') or {}
            if 'coordinates' in geom:
                geom['coordinates'] = _map_coords(geom['coordinates'], fn)
        return gj

    # In Denmark lon≈8–13 and lat≈54–58. A first ordinate around 57 means
    # KortInfo supplied lat,lon rather than GeoJSON's required lon,lat.
    if 50 <= sample[0] <= 60 and 5 <= sample[1] <= 15:
        for ft in gj.get('features', []):
            geom = ft.get('geometry') or {}
            if 'coordinates' in geom:
                geom['coordinates'] = swap_coords(geom['coordinates'])
    return gj


def valid_polygon_features(gj):
    out = []
    for ft in gj.get('features', []):
        geom = ft.get('geometry')
        if not geom or geom.get('type') not in ('Polygon', 'MultiPolygon'):
            continue
        try:
            g = shape(geom)
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty:
                continue
            cp = dict(ft)
            cp['geometry'] = mapping(g)
            out.append(cp)
        except Exception:
            continue
    return out


def _polygonal_part(g):
    if g is None or g.is_empty:
        return None
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        return g
    parts = [x for x in getattr(g, 'geoms', []) if x.geom_type in ('Polygon', 'MultiPolygon') and not x.is_empty]
    return unary_union(parts) if parts else None


def _linear_part(g):
    if g is None or g.is_empty:
        return None
    if g.geom_type in ('LineString', 'MultiLineString'):
        return g
    parts = [x for x in getattr(g, 'geoms', []) if x.geom_type in ('LineString', 'MultiLineString') and not x.is_empty]
    return unary_union(parts) if parts else None


def clip_zone_features(features, play_geom):
    """Clip display polygons to the playable area only."""
    out = []
    for ft in features:
        try:
            g = _polygonal_part(shape(ft['geometry']).intersection(play_geom))
            if not g or g.is_empty:
                continue
            cp = dict(ft)
            cp['properties'] = dict(ft.get('properties') or {})
            cp['geometry'] = mapping(g)
            out.append(cp)
        except Exception:
            continue
    return out


def add_precomputed_remainder(key, features, play_geom):
    """Add Zone 1/4 catch-all polygons during the scheduled build.

    Older browser builds computed these by Turf-unioning every displayed polygon
    when the user toggled the layer. That is particularly expensive for Zone 4.
    Doing the same operation once on GitHub makes the mobile layer render-ready.
    """
    if key not in ('zone1', 'zone4'):
        return features
    flag = '__zone1Other' if key == 'zone1' else '__zone4Other'
    # A retained v3 snapshot may already contain the generated remainder. Never
    # feed that synthetic polygon back into the coverage union or duplicate it.
    real = [ft for ft in features if not (ft.get('properties') or {}).get(flag)]
    geoms = []
    for ft in real:
        try:
            g = _polygonal_part(shape(ft['geometry']))
            if g and not g.is_empty:
                geoms.append(g)
        except Exception:
            pass
    covered = unary_union(geoms) if geoms else None
    rest = play_geom.difference(covered) if covered is not None and not covered.is_empty else play_geom
    rest = _polygonal_part(rest)
    if rest is None or rest.is_empty:
        return real
    if key == 'zone1':
        props = {
            'navn': 'Landzone', 'zonestatus': 'Landzone',
            '__displayName': 'Landzone', '__zone1Other': True,
            '__generatedRemainder': True,
        }
    else:
        props = {
            'navn': 'X · Uden kommuneplanramme',
            '__displayName': 'X · Uden kommuneplanramme',
            '__zone4Other': True, '__generatedRemainder': True,
        }
    return [
        {'type': 'Feature', 'properties': props, 'geometry': mapping(rest)},
        *real,
    ]


def zone_border_features(features, vicinity_geom):
    """Cache only REAL official boundary lines near the game area.

    Boundaries are derived before display clipping, then intersected with a
    modest vicinity polygon. This drastically reduces Zone 1/4 payload size
    without introducing the artificial edge of the game-area clip as a border.
    """
    out = []
    for ft in features:
        try:
            g = shape(ft['geometry'])
            border = _linear_part(g.boundary.intersection(vicinity_geom))
            if not border or border.is_empty:
                continue
            out.append({
                'type': 'Feature',
                # Border Measuring needs geometry only; dropping the often-large
                # municipal attribute payload keeps Zone 1/4 snapshots smaller.
                'properties': {},
                'geometry': mapping(border),
            })
        except Exception:
            continue
    return out


def previous_bundle():
    if not OUTPUT.exists():
        return None
    text = OUTPUT.read_text(encoding='utf-8')
    marker = f'window.{GLOBAL_NAME} = '
    if marker not in text:
        return None
    try:
        data = json.loads(text.split(marker, 1)[1].rstrip().rstrip(';'))
        return data if data.get('ready') and isinstance(data.get('zones'), dict) else None
    except Exception:
        return None


def previous_counts():
    data = previous_bundle()
    return {k: len((v or {}).get('features', [])) for k, v in (data.get('zones') or {}).items()} if data else {}


def current_play_geometry():
    """Read the last committed/known-good play-area snapshot, if available."""
    if not PLAY_OUTPUT.exists():
        return None
    try:
        return load_play_area(PLAY_OUTPUT, city=CITY)
    except Exception:
        return None


def validate_play_geometry(play, previous_play=None):
    """Reject obviously corrupted/over-broad Zone-2 snapshots.

    A city's small-game union is stable. Its limits (city.json: bounds.playArea
    and zones.playAreaKm2) are generous enough for real municipal edits, while
    rejecting cases where the service ignores BBOX or a parser accidentally
    unions unrelated municipal polygons.
    """
    if play is None or play.is_empty:
        raise RuntimeError('Zone 2 play-area union is empty')
    minx, miny, maxx, maxy = play.bounds
    hard = CITY.bounds('playArea')
    if minx < hard[0] or miny < hard[1] or maxx > hard[2] or maxy > hard[3]:
        raise RuntimeError(
            f'Zone 2 snapshot has implausible {CITY.name} bounds '
            f'({minx:.4f}, {miny:.4f}, {maxx:.4f}, {maxy:.4f})'
        )
    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:25832', always_xy=True)
    from shapely.ops import transform
    area_km2 = transform(to_utm.transform, play).area / 1_000_000
    if not (PLAY_AREA_KM2[0] <= area_km2 <= PLAY_AREA_KM2[1]):
        raise RuntimeError(f'Zone 2 snapshot has implausible area {area_km2:.1f} km²')
    if previous_play is not None and not previous_play.is_empty:
        prev_km2 = transform(to_utm.transform, previous_play).area / 1_000_000
        if prev_km2 > 0 and not (0.65 <= area_km2 / prev_km2 <= 1.55):
            raise RuntimeError(
                f'Zone 2 area changed suspiciously from {prev_km2:.1f} to {area_km2:.1f} km²'
            )
    return area_km2


def main():
    parser = argparse.ArgumentParser()
    add_city_argument(parser)
    args = parser.parse_args()
    use_city(args.city)

    previous = previous_bundle()
    previous_play = current_play_geometry()
    downloaded = {}
    errors = {}

    # Zone 2 is the only essential layer because it defines the play area.
    # Try it first; if KortInfo is unreachable, retain the last cache when one
    # exists. On the first run, leave the shipped fallback in place and return
    # successfully so unrelated GTFS/OSM refreshes are never blocked.
    try:
        downloaded['zone2'] = normalise_axis_order(fetch_json(LAYERS['zone2']))
    except Exception as exc:
        errors['zone2'] = str(exc)
        old_zone2 = previous and (previous.get('zones') or {}).get('zone2')
        if old_zone2 and PLAY_OUTPUT.exists():
            print(f'WARNING: {SERVICE} Zone 2 refresh failed; retaining previous snapshot: {exc}')
            downloaded['zone2'] = old_zone2
        else:
            print(f'WARNING: {SERVICE} Zone 2 is unavailable; keeping the committed fallback play area and continuing: {exc}')
            return

    # The other three layers are independent and can be fetched concurrently.
    # A failed layer can reuse its previous snapshot while successful siblings
    # still refresh.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetch_json, LAYERS[key]): key for key in ('zone1','zone3','zone4')}
        for future in as_completed(futures):
            key = futures[future]
            try:
                downloaded[key] = normalise_axis_order(future.result())
            except Exception as exc:
                errors[key] = str(exc)
                old = previous and (previous.get('zones') or {}).get(key)
                if old:
                    downloaded[key] = old
                    print(f'WARNING: {key} refresh failed; retaining previous snapshot: {exc}')
                else:
                    print(f'WARNING: {key} refresh failed; this layer will remain live-only for now: {exc}')

    cleaned = {k: valid_polygon_features(v) for k, v in downloaded.items()}
    try:
        cleaned['zone2'] = annotate_zone2(cleaned['zone2'])
        if len(cleaned['zone2']) < 4:
            raise RuntimeError(f'Zone 2 returned only {len(cleaned["zone2"])} polygon features')
        play = unary_union([shape(ft['geometry']) for ft in cleaned['zone2']])
        area_km2 = validate_play_geometry(play, previous_play)
        print(f'Validated Zone 2 play area: {area_km2:.1f} km², {len(cleaned["zone2"])} polygon part(s)')
    except Exception as exc:
        # Never let a malformed municipal response overwrite the last known-good
        # play area. Returning success allows GTFS/OSM jobs to continue using the
        # committed snapshot already present in the city's play_area.geojson.
        print(f'WARNING: rejected Zone 2 snapshot; retaining committed play area: {exc}')
        return
    # The layer shown on the phone never needs polygons outside the actual game
    # area. Measuring still needs real boundaries just outside it, so derive a
    # separate compact line cache from the UNCLIPPED official polygons.
    border_vicinity = play.buffer(0.035)  # roughly 2–4 km around the game area
    zones = {}
    borders = {}
    previous_borders = (previous or {}).get('borders') or {}

    for key in ('zone1', 'zone2', 'zone3', 'zone4'):
        source_features = cleaned.get(key, [])
        if not source_features:
            continue
        # A layer retained from the previous snapshot is already clipped and
        # has its remainder; preparing it again would merge that remainder away.
        if key in errors and key in previous_borders:
            zones[key] = previous['zones'][key]
            borders[key] = previous_borders[key]
            continue
        display_features = clip_zone_features(source_features, play)
        display_features = add_precomputed_remainder(key, display_features, play)
        if len(display_features) < MIN_COUNTS[key]:
            print(f'WARNING: {key} display snapshot suspiciously small ({len(display_features)}); retaining previous/live fallback where possible.')
            old = previous and (previous.get('zones') or {}).get(key)
            if old:
                zones[key] = old
            continue
        zones[key] = {'type': 'FeatureCollection', 'features': display_features}

        # If this layer itself was retained from a previous v2+ snapshot because
        # the live request failed, retain its already-correct real-border cache
        # as well. Otherwise derive borders from the current unclipped polygons.
        if key in errors and key in previous_borders:
            borders[key] = previous_borders[key]
        else:
            lines = zone_border_features(source_features, border_vicinity)
            if lines:
                borders[key] = {'type': 'FeatureCollection', 'features': lines}
            elif key in previous_borders:
                borders[key] = previous_borders[key]

    counts = {k: len(v['features']) for k, v in zones.items()}
    if counts.get('zone2', 0) < MIN_COUNTS['zone2']:
        raise RuntimeError(f'zone2 suspiciously small: {counts.get("zone2", 0)} features')

    old = previous_counts()
    for key, old_count in old.items():
        if key in counts and old_count >= 10 and counts[key] < max(MIN_COUNTS.get(key, 1), int(old_count * 0.45)):
            prior = previous and (previous.get('zones') or {}).get(key)
            if prior:
                zones[key] = prior
                if key in ((previous or {}).get('borders') or {}):
                    borders[key] = previous['borders'][key]
                counts[key] = len(prior.get('features', []))
                print(f'WARNING: {key} collapsed from {old_count}; retaining previous snapshot.')

    play_fc = round_coords({'type': 'FeatureCollection', 'features': cleaned['zone2']})
    play_tmp = PLAY_OUTPUT.with_suffix('.geojson.tmp')
    play_tmp.write_text(json.dumps(play_fc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    play_tmp.replace(PLAY_OUTPUT)

    now = datetime.now(timezone.utc).isoformat()
    bundle = {
        'version': 3, 'ready': True, 'generatedAt': now,
        'source': ENDPOINT,
        'displayPrepared': True,
        'layers': LAYERS,
        'zones': round_coords(zones),
        'borders': {k: drop_degenerate_lines(v) for k, v in round_coords(borders).items()},
    }
    payload = f'/* Generated from {CITY.config["kommune"]["name"]} {SERVICE} WFS. Do not edit by hand. */\n' \
              + f'window.{GLOBAL_NAME} = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n'
    tmp = OUTPUT.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(OUTPUT)

    lines = [
        f'# {CITY.name} zone snapshot audit', '',
        f'- Generated: `{now}`',
        f'- Source: `{ENDPOINT}`',
        f'- Zone 2 is also written to `{PLAY_OUTPUT.relative_to(CITY.dir.parents[1]).as_posix()}`, so every other generator uses the same exact official game boundary. Display polygons are clipped to the play area and Zone 1/4 catch-all areas are precomputed on GitHub, so the browser does no clipping/union work when toggling them. Genuine border lines are cached separately from the unclipped official geometry for Measuring.', '',
        '| Layer | WFS type | Cached display polygons | Cached real-border features | Status |',
        '|---|---|---:|---:|---|',
    ]
    for key in ('zone1', 'zone2', 'zone3', 'zone4'):
        status = 'fresh/retained cache' if key in zones else 'unavailable (live WFS fallback)'
        border_count = len((borders.get(key) or {}).get('features', []))
        lines.append(f'| {key.title()} | `{LAYERS[key]}` | {counts.get(key, 0)} | {border_count} | {status} |')
    AUDIT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('Zone cache:', ', '.join(f'{k}={counts[k]}' for k in counts))


if __name__ == '__main__':
    main()
