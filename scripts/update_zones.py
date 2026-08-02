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
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

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


def fetch_json(type_name: str):
    params = urllib.parse.urlencode({
        'service': 'WFS', 'version': '1.0.0', 'request': 'GetFeature',
        'typeName': type_name, 'outputFormat': 'application/json', 'srsName': 'EPSG:4326',
    })
    url = ENDPOINT + '&' + params
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'jetlag-aalborg-map-updater/1.0'})
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read()
            data = json.loads(raw.decode('utf-8-sig'))
            if data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
                raise RuntimeError('KortInfo did not return a GeoJSON FeatureCollection')
            return data
        except Exception as exc:
            last = exc
            if attempt < 2:
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


def normalise_axis_order(gj):
    sample = None
    for ft in gj.get('features', []):
        geom = ft.get('geometry') or {}
        sample = first_coord(geom.get('coordinates'))
        if sample:
            break
    if sample and 50 <= sample[0] <= 60 and 5 <= sample[1] <= 15:
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

    downloaded = {k: normalise_axis_order(fetch_json(t)) for k, t in LAYERS.items()}
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
