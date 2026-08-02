#!/usr/bin/env python3
"""Snapshot Aalborg's four official KortInfo game-zone WFS layers.

The browser prefers the generated local bundle for instant play. The live WFS
remains an emergency fallback. Zone 2 defines the exact game area; the other
layers keep complete official polygons that intersect a small buffer around it, so
no artificial clipping edge can ever be mistaken for a real zone border.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'zone-data.js'
AUDIT = ROOT / 'ZONE_AUDIT.md'
PLAY_OUTPUT = ROOT / 'scripts' / 'play_area.geojson'
ENDPOINT = 'https://drift.kortinfo.net/Wfs.aspx?Site=Aalborg&Page=kortHjemmeside'
LAYERS = {
    'zone1': 'ugis:TL1433667',
    'zone2': 'ugis:TL445984',
    'zone3': 'ugis:TL445987',
    'zone4': 'ugis:TL445981',
}
MIN_COUNTS = {'zone1': 1, 'zone2': 4, 'zone3': 5, 'zone4': 5}

ZONE2_ALIASES = [
    (1, 'Midtbyen', ('midtbyen',)),
    (2, 'Nørresundby', ('norresundby',)),
    (3, 'Vest Aalborg', ('vest aalborg', 'aalborg vest')),
    (4, 'Øst Aalborg', ('ost aalborg', 'aalborg ost')),
]


def norm_text(value):
    import unicodedata, re
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = s.lower().replace('æ', 'ae').replace('ø', 'o').replace('å', 'a')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def zone2_def(props):
    hay = norm_text(' | '.join(str(v) for v in (props or {}).values() if isinstance(v, (str, int, float))))
    for number, name, aliases in ZONE2_ALIASES:
        if any(alias in hay for alias in aliases):
            return number, name
    return None


def annotate_zone2(features):
    recognised = set()
    out = []
    for ft in features:
        cp = dict(ft)
        props = dict(cp.get('properties') or {})
        definition = zone2_def(props)
        if definition:
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
        raise RuntimeError(f'KortInfo reply was neither GeoJSON nor parseable GML: {preview!r}') from exc

    for el in root.iter():
        if local_name(el.tag) == 'ServiceException':
            raise RuntimeError((''.join(el.itertext()).strip() or 'KortInfo service exception')[:240])

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
        raise RuntimeError('KortInfo returned GML but no usable feature geometry was found')
    return {'type': 'FeatureCollection', 'features': features}


def fetch_json(type_name: str):
    params = urllib.parse.urlencode({
        'service': 'WFS', 'version': '1.0.0', 'request': 'GetFeature',
        'typeName': type_name, 'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
    })
    url = ENDPOINT + '&' + params
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; jetlag-aalborg-map-updater/1.1)',
                'Accept': 'application/json, application/gml+xml, application/xml, text/xml, */*',
            })
            with urllib.request.urlopen(req, timeout=120) as response:
                raw = response.read()
                content_type = response.headers.get('Content-Type', '')

            try:
                data = json.loads(raw.decode('utf-8-sig'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                data = parse_gml(raw)

            if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
                raise RuntimeError(f'KortInfo did not return a feature collection (Content-Type: {content_type})')
            if not data['features']:
                raise RuntimeError('KortInfo answered with zero features')
            return data
        except Exception as exc:
            last = exc
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'Could not download {type_name}: {last}')


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


def normalise_axis_order(gj):
    """Return all cached zone geometry as GeoJSON longitude/latitude.

    KortInfo can ignore srsName and send EPSG:25832 metres, or send EPSG:4326
    with latitude/longitude axis order. The browser already copes with both;
    the build-time snapshot must too because downstream generators consume
    scripts/play_area.geojson directly.
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


def nearby_features(features, clip_geom):
    """Keep complete official polygons that can matter near the game area.

    Do not geometrically clip them: a clip boundary would become a fake zone
    border and could corrupt Measuring-to-border questions.
    """
    out = []
    for ft in features:
        try:
            g = shape(ft['geometry'])
            if g.intersects(clip_geom):
                out.append(ft)
        except Exception:
            continue
    return out


def previous_counts():
    if not OUTPUT.exists():
        return {}
    text = OUTPUT.read_text(encoding='utf-8')
    marker = 'window.AALBORG_ZONE_DATA = '
    if marker not in text:
        return {}
    try:
        data = json.loads(text.split(marker, 1)[1].rstrip().rstrip(';'))
        if not data.get('ready'):
            return {}
        return {k: len((v or {}).get('features', [])) for k, v in (data.get('zones') or {}).items()}
    except Exception:
        return {}


def main():
    parser = argparse.ArgumentParser()
    parser.parse_args()

    try:
        downloaded = {k: normalise_axis_order(fetch_json(t)) for k, t in LAYERS.items()}
    except Exception as exc:
        # A municipal WFS can be temporarily unavailable. Once we have a valid
        # snapshot, stale official geometry is much safer than breaking every
        # unrelated GTFS/OSM refresh. On the first-ever snapshot, still fail so
        # a placeholder can never masquerade as a successful zone cache.
        old_counts = previous_counts()
        if old_counts and PLAY_OUTPUT.exists():
            print(f'WARNING: KortInfo refresh failed; retaining previous valid zone snapshot: {exc}')
            return
        raise

    cleaned = {k: valid_polygon_features(v) for k, v in downloaded.items()}
    cleaned['zone2'] = annotate_zone2(cleaned['zone2'])
    if len(cleaned['zone2']) < 4:
        raise RuntimeError(f'Zone 2 returned only {len(cleaned["zone2"])} polygon features')

    play = unary_union([shape(ft['geometry']) for ft in cleaned['zone2']])
    if play.is_empty:
        raise RuntimeError('Could not construct the Zone 2 play-area union')
    # Roughly 2–3 km around the game area. KortInfo normally honours the
    # EPSG:4326 request, but if it ever sends UTM32 metres anyway, use a metre
    # buffer here and let the browser's existing proj4 normaliser reproject the
    # cached coordinates when loading them.
    sample = None
    for ft in downloaded['zone2'].get('features', []):
        sample = first_coord((ft.get('geometry') or {}).get('coordinates'))
        if sample:
            break
    projected = bool(sample and (abs(sample[0]) > 180 or abs(sample[1]) > 90))
    clip = play.buffer(3000 if projected else 0.035)

    zones = {
        'zone2': {'type': 'FeatureCollection', 'features': cleaned['zone2']},
    }
    for key in ('zone1', 'zone3', 'zone4'):
        zones[key] = {'type': 'FeatureCollection', 'features': nearby_features(cleaned[key], clip)}

    counts = {k: len(v['features']) for k, v in zones.items()}
    for key, minimum in MIN_COUNTS.items():
        if counts.get(key, 0) < minimum:
            raise RuntimeError(f'{key} suspiciously small: {counts.get(key, 0)} features')

    old = previous_counts()
    for key, old_count in old.items():
        if old_count >= 10 and counts.get(key, 0) < max(MIN_COUNTS.get(key, 1), int(old_count * 0.45)):
            raise RuntimeError(f'{key} collapsed from {old_count} to {counts.get(key, 0)} features; keeping prior bundle')

    play_fc = {'type': 'FeatureCollection', 'features': cleaned['zone2']}
    play_tmp = PLAY_OUTPUT.with_suffix('.geojson.tmp')
    play_tmp.write_text(json.dumps(play_fc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    play_tmp.replace(PLAY_OUTPUT)

    now = datetime.now(timezone.utc).isoformat()
    bundle = {
        'version': 1, 'ready': True, 'generatedAt': now,
        'source': ENDPOINT,
        'layers': LAYERS,
        'zones': zones,
    }
    payload = '/* Generated from Aalborg Kommune KortInfo WFS. Do not edit by hand. */\n' \
              + 'window.AALBORG_ZONE_DATA = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n'
    tmp = OUTPUT.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(OUTPUT)

    lines = [
        '# Aalborg zone snapshot audit', '',
        f'- Generated: `{now}`',
        f'- Source: `{ENDPOINT}`',
        '- Zone 2 is also written to `scripts/play_area.geojson`, so every other generator uses the same exact official game boundary; Zone 1/3/4 retain complete polygons that intersect the game vicinity.', '',
        '| Layer | WFS type | Cached polygon features |',
        '|---|---|---:|',
    ]
    for key in ('zone1', 'zone2', 'zone3', 'zone4'):
        lines.append(f'| {key.title()} | `{LAYERS[key]}` | {counts[key]} |')
    AUDIT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('Zone cache:', ', '.join(f'{k}={counts[k]}' for k in counts))


if __name__ == '__main__':
    main()
