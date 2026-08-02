#!/usr/bin/env python3
"""Build static Aalborg passenger train routes and bus/train stops from Rejseplanen GTFS.

The output is intentionally a small browser bundle. Train geometry keeps every
scheduled GTFS shape variant that intersects the Hide + Seek play area, while
stops are deduplicated by name/proximity and carried in a small padded envelope
so app.js can apply the exact live Zone-2 play-area filter at runtime.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import unicodedata
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import LineString, Point, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAY_AREA = ROOT / 'scripts' / 'play_area.geojson'
DEFAULT_OUTPUT = ROOT / 'transit-data.js'
DEFAULT_AUDIT = ROOT / 'TRANSIT_AUDIT.md'

BUS_AGENCY_ID = '206'  # NT
RAIL_ROUTE_TYPES = {'2'}  # GTFS conventional rail; excludes heritage OSM infrastructure
BUS_ROUTE_TYPES = {'3'}
EXCLUDED_TRAIN_NAMES = {
    'osteradalen', 'gug', 'hadsundvej', 'limfjorden', 'train limfjorden'
}
MIN_TRAIN_ROUTES = 3
MIN_BUS_STOPS = 250
MIN_TRAIN_STOPS = 4
MAX_STOPS = 800


def read_csv_from_zip(zf: zipfile.ZipFile, name: str):
    raw = zf.open(name)
    text = io.TextIOWrapper(raw, encoding='utf-8-sig', newline='')
    return text, csv.DictReader(text)


def load_play_area(path: Path):
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('type') == 'FeatureCollection':
        geoms = [shape(f['geometry']) for f in data.get('features', []) if f.get('geometry')]
        if not geoms:
            raise RuntimeError('play-area file has no polygon geometry')
        play = unary_union(geoms)
    elif data.get('type') == 'Feature':
        play = shape(data['geometry'])
    else:
        play = shape(data)
    minx, miny, maxx, maxy = play.bounds
    if minx < 9.65 or miny < 56.86 or maxx > 10.32 or maxy > 57.24:
        raise RuntimeError(
            'play-area snapshot is outside the expected Aalborg game vicinity: '
            f'{minx:.4f},{miny:.4f},{maxx:.4f},{maxy:.4f}. '
            'Keep the previous scripts/play_area.geojson and refresh zones later.'
        )
    return play


def feed_dates(zf: zipfile.ZipFile):
    starts, ends = [], []
    try:
        text, rows = read_csv_from_zip(zf, 'calendar.txt')
        with text:
            for row in rows:
                if row.get('start_date'): starts.append(row['start_date'])
                if row.get('end_date'): ends.append(row['end_date'])
    except KeyError:
        pass
    fmt = lambda s: datetime.strptime(s, '%Y%m%d').strftime('%Y-%m-%d')
    return (fmt(min(starts)) if starts else 'unknown', fmt(max(ends)) if ends else 'unknown')


def norm_name(value: str) -> str:
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = s.lower().replace('æ', 'ae').replace('ø', 'o').replace('å', 'a')
    s = re.sub(r'\([^)]*\)', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def natural_key(value: str):
    parts = re.split(r'(\d+)', str(value or '').upper())
    return tuple(int(p) if p.isdigit() else p for p in parts)


def haversine_m(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1.0, math.sqrt(h)))


def clipped_parts(geom):
    if geom.is_empty: return []
    if geom.geom_type == 'LineString': return [geom]
    if geom.geom_type == 'MultiLineString': return list(geom.geoms)
    if geom.geom_type == 'GeometryCollection':
        return [g for g in geom.geoms if g.geom_type == 'LineString' and not g.is_empty]
    return []


def round_line(line):
    coords = [[round(float(x), 6), round(float(y), 6)] for x, y in line.coords]
    clean = []
    for p in coords:
        if not clean or p != clean[-1]: clean.append(p)
    return clean if len(clean) >= 2 else []


def parse_existing(path: Path):
    if not path.exists(): return None
    text = path.read_text(encoding='utf-8')
    m = re.search(r'window\.AALBORG_GTFS_TRANSIT\s*=\s*(\{.*\});\s*$', text, re.S)
    if not m: return None
    try:
        data = json.loads(m.group(1))
        return data if data.get('ready') else None
    except Exception:
        return None


def dedupe_stop_records(records, threshold_m):
    """Collapse directional/platform duplicates with the same normalized name."""
    grouped = defaultdict(list)
    for rec in records:
        grouped[(rec['kind'], norm_name(rec['name']))].append(rec)
    out = []
    for (_, _), rows in grouped.items():
        clusters = []
        for rec in rows:
            hit = None
            for cluster in clusters:
                if min(haversine_m(rec['coord'], x['coord']) for x in cluster) <= threshold_m:
                    hit = cluster; break
            if hit is None:
                clusters.append([rec])
            else:
                hit.append(rec)
        for cluster in clusters:
            lon = sum(x['coord'][0] for x in cluster) / len(cluster)
            lat = sum(x['coord'][1] for x in cluster) / len(cluster)
            refs = sorted({r for x in cluster for r in x['refs']}, key=natural_key)
            name = max((x['name'] for x in cluster), key=lambda x: (len(x), x))
            out.append({
                'type': 'Feature',
                'properties': {
                    'name': name, '__displayName': name, '__stopKind': cluster[0]['kind'],
                    'route_ref': ', '.join(refs), '__routeRefs': refs,
                    'source': 'Rejseplanen GTFS'
                },
                'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]}
            })
    out.sort(key=lambda f: (f['properties']['__stopKind'], norm_name(f['properties']['name']), f['geometry']['coordinates']))
    return out


def build_bundle(gtfs: Path, play_area_path: Path):
    play = load_play_area(play_area_path)
    minx, miny, maxx, maxy = play.bounds
    # Keep a small margin so exact runtime clipping against the freshly loaded
    # official Zone-2 union cannot lose an edge stop/shape because the checked-in
    # play-area snapshot differs by a few metres.
    envelope = box(minx - 0.025, miny - 0.020, maxx + 0.025, maxy + 0.020)

    with zipfile.ZipFile(gtfs) as zf:
        required = {'agency.txt','routes.txt','trips.txt','shapes.txt','stops.txt','stop_times.txt'}
        missing = required.difference(zf.namelist())
        if missing: raise RuntimeError('GTFS archive is missing ' + ', '.join(sorted(missing)))
        feed_start, feed_end = feed_dates(zf)

        agencies = {}
        text, rows = read_csv_from_zip(zf, 'agency.txt')
        with text:
            for row in rows: agencies[row['agency_id']] = row.get('agency_name', row['agency_id'])

        routes = {}
        text, rows = read_csv_from_zip(zf, 'routes.txt')
        with text:
            for row in rows: routes[row['route_id']] = row

        relevant_trip = {}
        rail_shape_routes = defaultdict(set)
        text, rows = read_csv_from_zip(zf, 'trips.txt')
        with text:
            for row in rows:
                route = routes.get(row.get('route_id', ''))
                if not route: continue
                rtype = route.get('route_type', '')
                if rtype in RAIL_ROUTE_TYPES:
                    kind = 'train'
                elif rtype in BUS_ROUTE_TYPES and route.get('agency_id') == BUS_AGENCY_ID:
                    kind = 'bus'
                else:
                    continue
                ref = (route.get('route_short_name') or route.get('route_long_name') or route.get('route_id') or '').strip()
                relevant_trip[row['trip_id']] = (kind, ref, row['route_id'])
                sid = row.get('shape_id', '').strip()
                if kind == 'train' and sid:
                    rail_shape_routes[sid].add(row['route_id'])

        rail_points = defaultdict(list)
        text, rows = read_csv_from_zip(zf, 'shapes.txt')
        with text:
            for row in rows:
                sid = row.get('shape_id', '')
                if sid not in rail_shape_routes: continue
                try:
                    rail_points[sid].append((int(float(row.get('shape_pt_sequence', '0'))),
                                             float(row['shape_pt_lon']), float(row['shape_pt_lat'])))
                except (ValueError, KeyError):
                    pass

        stop_usage = defaultdict(lambda: {'bus': set(), 'train': set()})
        text, rows = read_csv_from_zip(zf, 'stop_times.txt')
        with text:
            for row in rows:
                info = relevant_trip.get(row.get('trip_id', ''))
                if not info: continue
                kind, ref, _ = info
                if ref: stop_usage[row['stop_id']][kind].add(ref)

        stops = {}
        text, rows = read_csv_from_zip(zf, 'stops.txt')
        with text:
            for row in rows: stops[row['stop_id']] = row

    # Train routes: group every distinct scheduled shape by agency + displayed ref.
    route_parts = defaultdict(list)
    route_shapes = defaultdict(set)
    route_meta = {}
    for sid, seq in rail_points.items():
        if len(seq) < 2: continue
        seq.sort(key=lambda p: p[0])
        line = LineString([(p[1], p[2]) for p in seq])
        if line.is_empty or not line.intersects(play): continue
        parts = [round_line(g) for g in clipped_parts(line.intersection(envelope))]
        parts = [p for p in parts if p]
        if not parts: continue
        for rid in rail_shape_routes[sid]:
            route = routes[rid]
            ref = (route.get('route_short_name') or route.get('route_long_name') or rid).strip()
            agency = agencies.get(route.get('agency_id', ''), route.get('agency_id', ''))
            key = (agency, ref)
            route_parts[key].extend(parts)
            route_shapes[key].add(sid)
            route_meta[key] = route

    train_features = []
    for key in sorted(route_parts, key=lambda k: (k[0], natural_key(k[1]))):
        agency, ref = key
        seen, unique = set(), []
        for part in route_parts[key]:
            t = tuple(map(tuple, part)); canonical = min(t, tuple(reversed(t)))
            if canonical in seen: continue
            seen.add(canonical); unique.append(part)
        geometry = {'type': 'LineString', 'coordinates': unique[0]} if len(unique) == 1 else {'type': 'MultiLineString', 'coordinates': unique}
        display = f'{ref} · {agency}' if ref and agency else (ref or agency or 'Train')
        train_features.append({
            'type': 'Feature',
            'properties': {
                'ref': ref, 'navn': display, '__displayName': ref or display,
                '__routeRefs': [ref] if ref else [], 'agency': agency,
                'variants': len(route_shapes[key]), 'source': f'Rejseplanen GTFS {feed_start}'
            },
            'geometry': geometry
        })

    # Scheduled passenger stops. Keep only a padded Aalborg envelope here; exact
    # game-area filtering is repeated by the browser after official Zone 2 loads.
    stop_records = []
    for sid, usage in stop_usage.items():
        row = stops.get(sid)
        if not row: continue
        name = (row.get('stop_name') or '').strip()
        if not name: continue
        try: coord = [float(row['stop_lon']), float(row['stop_lat'])]
        except (ValueError, KeyError): continue
        if not envelope.covers(Point(coord)): continue
        kind = 'train' if usage['train'] else 'bus'
        if kind == 'train' and norm_name(name) in EXCLUDED_TRAIN_NAMES: continue
        refs = usage[kind]
        stop_records.append({'name': name, 'kind': kind, 'coord': coord, 'refs': refs})

    bus_stops = [x for x in stop_records if x['kind'] == 'bus']
    train_stops = [x for x in stop_records if x['kind'] == 'train']
    stop_features = dedupe_stop_records(bus_stops, 150) + dedupe_stop_records(train_stops, 70)
    stop_features.sort(key=lambda f: (f['properties']['__stopKind'], norm_name(f['properties']['name'])))

    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    return {
        'version': 1, 'ready': True, 'generatedAt': generated,
        'feedStart': feed_start, 'feedEnd': feed_end,
        'source': 'Rejseplanen static GTFS',
        'trainRoutes': {'type': 'FeatureCollection', 'features': train_features},
        'stops': {'type': 'FeatureCollection', 'features': stop_features},
    }


def validate(bundle, existing=None):
    routes = bundle['trainRoutes']['features']
    stops = bundle['stops']['features']
    bus = sum(1 for f in stops if f['properties'].get('__stopKind') == 'bus')
    train = sum(1 for f in stops if f['properties'].get('__stopKind') == 'train')
    errors = []
    if len(routes) < MIN_TRAIN_ROUTES: errors.append(f'train routes: expected at least {MIN_TRAIN_ROUTES}, got {len(routes)}')
    if bus < MIN_BUS_STOPS: errors.append(f'bus stops: expected at least {MIN_BUS_STOPS}, got {bus}')
    if train < MIN_TRAIN_STOPS: errors.append(f'train stops: expected at least {MIN_TRAIN_STOPS}, got {train}')
    if len(stops) > MAX_STOPS: errors.append(f'stops suspiciously high: {len(stops)} > {MAX_STOPS}')
    if existing and existing.get('ready'):
        old_routes = len((existing.get('trainRoutes') or {}).get('features', []))
        old_stops = (existing.get('stops') or {}).get('features', [])
        old_bus = sum(1 for f in old_stops if (f.get('properties') or {}).get('__stopKind') == 'bus')
        old_train = sum(1 for f in old_stops if (f.get('properties') or {}).get('__stopKind') == 'train')
        if old_routes >= 3 and len(routes) < old_routes * .5: errors.append(f'train routes dropped from {old_routes} to {len(routes)}')
        if old_bus >= 100 and bus < old_bus * .55: errors.append(f'bus stops dropped from {old_bus} to {bus}')
        if old_train >= 4 and train < old_train * .5: errors.append(f'train stops dropped from {old_train} to {train}')
    for f in stops:
        c = (f.get('geometry') or {}).get('coordinates') or []
        if len(c) < 2 or not (9.4 <= c[0] <= 10.4 and 56.7 <= c[1] <= 57.4):
            errors.append(f'invalid stop coordinate {c}'); break
    if errors: raise RuntimeError('Transit validation failed:\n  - ' + '\n  - '.join(errors))
    return len(routes), bus, train


def write_outputs(bundle, output: Path, audit: Path, existing=None):
    if existing and existing.get('ready'):
        if existing.get('trainRoutes') == bundle.get('trainRoutes') and existing.get('stops') == bundle.get('stops'):
            bundle['generatedAt'] = existing.get('generatedAt', bundle['generatedAt'])
    output.write_text('/* Auto-generated by scripts/update_transit.py. Do not edit by hand. */\nwindow.AALBORG_GTFS_TRANSIT = ' +
                      json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    routes = bundle['trainRoutes']['features']; stops = bundle['stops']['features']
    bus_names = [f['properties']['name'] for f in stops if f['properties']['__stopKind'] == 'bus']
    train_names = [f['properties']['name'] for f in stops if f['properties']['__stopKind'] == 'train']
    lines = [
        '# Aalborg transit bundle audit', '',
        f'- Generated: `{bundle["generatedAt"]}`',
        f'- GTFS validity: `{bundle["feedStart"]}` → `{bundle["feedEnd"]}`',
        '- Source: Rejseplanen static GTFS', '',
        f'- Train services intersecting the play area: **{len(routes)}**',
        f'- Bus stops in the padded Aalborg bundle: **{len(bus_names)}**',
        f'- Rail stations/stops in the padded Aalborg bundle: **{len(train_names)}**', '',
        '## Train services', '',
        ', '.join(f'{f["properties"].get("ref") or f["properties"].get("navn")} ({f["properties"].get("agency")})' for f in routes) or '_None_', '',
        '## Rail stations/stops', '', ', '.join(train_names) or '_None_', '',
        '## Bus stops', '', ', '.join(bus_names) or '_None_', ''
    ]
    audit.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('gtfs', type=Path)
    ap.add_argument('--play-area', type=Path, default=DEFAULT_PLAY_AREA)
    ap.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    ap.add_argument('--audit', type=Path, default=DEFAULT_AUDIT)
    args = ap.parse_args()
    existing = parse_existing(args.output)
    bundle = build_bundle(args.gtfs, args.play_area)
    route_count, bus_count, train_count = validate(bundle, existing)
    write_outputs(bundle, args.output, args.audit, existing)
    print('Transit bundle generated successfully')
    print(f'  train routes  {route_count}')
    print(f'  bus stops     {bus_count}')
    print(f'  train stops   {train_count}')


if __name__ == '__main__': main()
