#!/usr/bin/env python3
"""Build a city's passenger train routes and bus/train stops from Rejseplanen GTFS.

The output is intentionally a small browser bundle. Train geometry keeps every
scheduled GTFS shape variant that intersects the Hide + Seek play area, while
stops are deduplicated by name/proximity and carried in a small padded envelope
so app.js can apply the exact live Zone-2 play-area filter at runtime.
"""

from __future__ import annotations

import argparse
import sys
import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import LineString, Point, box

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for `common`, even under python -I
from common import DEFAULT_CITY, add_city_argument, feed_dates, haversine_m, line_parts, load_city, load_play_area, natural_key, normalise_name, read_csv_from_zip, rounded_line_coords

GLOBAL_NAME = 'HS_GTFS_TRANSIT'
RAIL_ROUTE_TYPES = {'2'}  # GTFS conventional rail; excludes heritage OSM infrastructure
BUS_ROUTE_TYPES = {'3'}


def norm_name(value: str) -> str:
    return normalise_name(value, drop_parenthetical=True)


def use_city(city_id: str = DEFAULT_CITY):
    """Point the generator at a city: its bus operator, excluded halts and sanity limits."""
    global CITY, BUS_AGENCY_ID, EXCLUDED_TRAIN_NAMES, MIN_TRAIN_ROUTES, MIN_BUS_STOPS, MIN_TRAIN_STOPS, MAX_STOPS, STOP_BOUNDS
    CITY = load_city(city_id)
    transit = CITY.config['transit']
    BUS_AGENCY_ID = transit['busAgency']['id']
    # Railway halts that are not ordinary passenger stations (Aalborg: heritage halts).
    EXCLUDED_TRAIN_NAMES = {norm_name(n) for n in transit.get('excludedTrainStops', [])}
    MIN_TRAIN_ROUTES = transit['minTrainRoutes']
    MIN_BUS_STOPS = transit['minBusStops']
    MIN_TRAIN_STOPS = transit['minTrainStops']
    MAX_STOPS = transit['maxStops']
    STOP_BOUNDS = CITY.bounds('stops')
    return CITY


use_city()


def parse_existing(path: Path):
    if not path.exists(): return None
    text = path.read_text(encoding='utf-8')
    m = re.search(r'window\.' + GLOBAL_NAME + r'\s*=\s*(\{.*\});\s*$', text, re.S)
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


def build_bundle(gtfs: Path, play_area_path: Path | None = None):
    play = load_play_area(play_area_path, city=CITY, check_bounds=True)
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
        parts = [rounded_line_coords(g) for g in line_parts(line.intersection(envelope))]
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

    # Scheduled passenger stops. Keep only a padded envelope here; exact
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
        if len(c) < 2 or not (STOP_BOUNDS[0] <= c[0] <= STOP_BOUNDS[2] and STOP_BOUNDS[1] <= c[1] <= STOP_BOUNDS[3]):
            errors.append(f'invalid stop coordinate {c}'); break
    if errors: raise RuntimeError('Transit validation failed:\n  - ' + '\n  - '.join(errors))
    return len(routes), bus, train


def write_outputs(bundle, output: Path, audit: Path, existing=None):
    if existing and existing.get('ready'):
        if existing.get('trainRoutes') == bundle.get('trainRoutes') and existing.get('stops') == bundle.get('stops'):
            bundle['generatedAt'] = existing.get('generatedAt', bundle['generatedAt'])
    output.write_text(f'/* Auto-generated by scripts/update_transit.py. Do not edit by hand. */\nwindow.{GLOBAL_NAME} = ' +
                      json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    routes = bundle['trainRoutes']['features']; stops = bundle['stops']['features']
    bus_names = [f['properties']['name'] for f in stops if f['properties']['__stopKind'] == 'bus']
    train_names = [f['properties']['name'] for f in stops if f['properties']['__stopKind'] == 'train']
    lines = [
        f'# {CITY.name} transit bundle audit', '',
        f'- Generated: `{bundle["generatedAt"]}`',
        f'- GTFS validity: `{bundle["feedStart"]}` → `{bundle["feedEnd"]}`',
        '- Source: Rejseplanen static GTFS', '',
        f'- Train services intersecting the play area: **{len(routes)}**',
        f'- Bus stops in the padded {CITY.name} bundle: **{len(bus_names)}**',
        f'- Rail stations/stops in the padded {CITY.name} bundle: **{len(train_names)}**', '',
        '## Train services', '',
        ', '.join(f'{f["properties"].get("ref") or f["properties"].get("navn")} ({f["properties"].get("agency")})' for f in routes) or '_None_', '',
        '## Rail stations/stops', '', ', '.join(train_names) or '_None_', '',
        '## Bus stops', '', ', '.join(bus_names) or '_None_', ''
    ]
    audit.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('gtfs', type=Path)
    add_city_argument(ap)
    ap.add_argument('--play-area', type=Path, help="default: the city's play_area.geojson")
    ap.add_argument('--output', type=Path, help="default: the city's transit-data.js")
    ap.add_argument('--audit', type=Path, help="default: the city's TRANSIT_AUDIT.md")
    args = ap.parse_args()
    city = use_city(args.city)
    args.output = args.output or city.path('transit-data.js')
    args.audit = args.audit or city.path('TRANSIT_AUDIT.md')
    existing = parse_existing(args.output)
    bundle = build_bundle(args.gtfs, args.play_area)
    route_count, bus_count, train_count = validate(bundle, existing)
    write_outputs(bundle, args.output, args.audit, existing)
    print('Transit bundle generated successfully')
    print(f'  train routes  {route_count}')
    print(f'  bus stops     {bus_count}')
    print(f'  train stops   {train_count}')


if __name__ == '__main__': main()
