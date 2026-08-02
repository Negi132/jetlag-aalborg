#!/usr/bin/env python3
"""Build a static Aalborg Matching-POI bundle from an Osmium GeoJSON export.

The scheduled GitHub Action downloads Geofabrik's Denmark OSM PBF, uses
`osmium tags-filter` to keep only POI-relevant objects, exports that small
subset as GeoJSON, then calls this script.

The browser treats the generated bundle as authoritative for the automatic
Matching cards. If generation fails or looks suspicious, the old bundle is
left untouched and the workflow fails instead of publishing partial data.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAY_AREA = ROOT / "scripts" / "play_area.geojson"
DEFAULT_OUTPUT = ROOT / "poi-data.js"
DEFAULT_AUDIT = ROOT / "POI_AUDIT.md"

PARK_AUTO_MIN_AREA_M2 = 2500

OFFICIAL_AALBORG_PARKS = [
    'Budolfihaven', 'Bundgårdsparken', 'Den Gamle Golfbane', 'Jomfru Ane Parken',
    'Karolinelund', 'Kildeparken', 'Lindholm Fjordpark', 'Lindholm Strandpark',
    'Mulighedernes Park', 'Mølleparken', 'Nordens Kridtgrav', 'Skanseparken',
    'Sofiendal Enge klimapark', 'Sohngårdsholmparken', 'Stigsparken',
    'Svanemølleparken i Svenstrup', 'Urtehaven i Nørresundby',
    'Vestre Fjordpark', 'Østre Anlæg'
]
AALBORG_PARK_ADJACENT_EXACT = [
    'Østerådalen', 'Østerådalen Nord', 'Østerådalen Syd', 'Golfparken', 'Vandbakken'
]
AALBORG_PARK_ADJACENT_FALLBACK = [
    {'name': 'Østerådalen Nord', 'coordinates': [9.91342, 57.02087]},
    {'name': 'Østerådalen Syd', 'coordinates': [9.8890, 56.9915]},
    {'name': 'Golfparken', 'coordinates': [9.95498, 57.02563]},
    {'name': 'Vandbakken', 'coordinates': [9.93371, 57.03202]},
]

AALBORG_LIBRARY_LOCATIONS = [
    {'name': 'Hovedbiblioteket i Aalborg', 'address': 'Rendsburggade 2, 9000 Aalborg', 'coordinates': [9.9275896, 57.0472572]},
    {'name': 'Haraldslund', 'address': 'Kastetvej 83, 9000 Aalborg', 'coordinates': [9.89904347, 57.05420492], 'servicePoint': True},
    {'name': 'Hasseris Bibliotek', 'address': 'Thulebakken 46, 9000 Aalborg', 'coordinates': [9.88452416, 57.03559821]},
    {'name': 'Nørresundby Bibliotek', 'address': 'Torvet 5, 9400 Nørresundby', 'coordinates': [9.9231595, 57.05896286]},
    {'name': 'Trekanten - Bibliotek og Kulturhus', 'address': 'Sebbersundvej 2A, 9220 Aalborg Øst', 'coordinates': [10.0008729, 57.0276469]},
    {'name': 'Vejgaard Bibliotek', 'address': 'Hadsundvej 35, 9000 Aalborg', 'coordinates': [9.95176, 57.04130]},
    {'name': 'Svenstrup Bibliotek', 'address': 'Godthåbsvej 14B, 9230 Svenstrup J', 'coordinates': [9.8518, 56.9749]},
    {'name': 'Vodskov Bibliotek', 'address': 'Brorsonsvej 3B, 9310 Vodskov', 'coordinates': [10.0245, 57.1088]},
    {'name': 'Storvorde Bibliotek', 'address': 'Stationsvej 5, 9280 Storvorde', 'coordinates': [10.1017, 57.0058]},
    {'name': 'Nibe Bibliotek', 'address': 'St Algade 4, 9240 Nibe', 'coordinates': [9.6398, 56.9820]},
    {'name': 'Hals Bibliotek', 'address': 'Østergade 2A, 9370 Hals', 'coordinates': [10.3070, 56.9965]},
]

AALBORG_HOSPITAL_FALLBACK = [
    # Stable coordinates are stored with the authoritative site list so the
    # unattended updater never depends on a third-party geocoder being online.
    # [longitude, latitude]
    {'name': 'Aalborg Universitetshospital, Hospitalsbyen', 'address': 'Hospitalsbyen 1, 9260 Gistrup', 'coordinates': [9.99941003, 57.00966924]},
    {'name': 'Aalborg Universitetshospital, Syd', 'address': 'Hobrovej 18-22, 9000 Aalborg', 'coordinates': [9.9082114, 57.0382516]},
    {'name': 'Aalborg Universitetshospital, Nord', 'address': 'Reberbansgade 15, 9000 Aalborg', 'coordinates': [9.912635, 57.048857]},
    {'name': 'Aalborg Universitetshospital, Mølleparkvej', 'address': 'Mølleparkvej 10, 9000 Aalborg', 'coordinates': [9.90532768, 57.03853921]},
    {'name': 'Aalborg Universitetshospital, Brandevej', 'address': 'Brandevej 5, 9220 Aalborg Ø', 'coordinates': [9.97885646, 57.02588105]},
]

AUTHORITATIVE_ONLY = {
    'airport': [
        {'name': 'Aalborg Airport (AAL)', 'coordinates': [9.849243, 57.092759], 'authoritative': True},
    ],
    'zoo': [
        {'name': 'Aalborg Zoo', 'coordinates': [9.89970, 57.03804], 'authoritative': True},
    ],
    'golf': [
        {'name': 'Aalborg Golf Klub', 'coordinates': [9.782950, 57.026760], 'authoritative': True},
        {'name': 'Ørnehøj Golfklub', 'coordinates': [9.968050, 56.987570], 'authoritative': True},
    ],
    'cinema': [
        {'name': 'Nordisk Film Biografer Aalborg Kennedy', 'coordinates': [9.9189535, 57.0419503], 'authoritative': True},
        {'name': 'Biffen', 'coordinates': [9.9329399, 57.0463840], 'authoritative': True},
        {'name': 'Nordisk Film Biografer Aalborg City Syd', 'coordinates': [9.8714578, 57.0027432], 'authoritative': True},
    ],
    'library': [{**x, 'authoritative': True} for x in AALBORG_LIBRARY_LOCATIONS],
}

CATEGORY_ORDER = [
    'airport', 'park', 'amusement', 'zoo', 'aquarium', 'golf',
    'museum', 'cinema', 'hospital', 'library', 'consulate'
]
CATEGORY_LABELS = {
    'airport': 'Commercial airport', 'park': 'Park', 'amusement': 'Amusement park',
    'zoo': 'Zoo', 'aquarium': 'Aquarium', 'golf': 'Golf course', 'museum': 'Museum',
    'cinema': 'Movie theater', 'hospital': 'Hospital', 'library': 'Library',
    'consulate': 'Foreign consulate'
}
# First-generation floor checks. Categories which can legitimately be empty have zero minima.
MIN_COUNTS = {
    'airport': 1, 'park': 10, 'amusement': 0, 'zoo': 1, 'aquarium': 0,
    'golf': 1, 'museum': 3, 'cinema': 3, 'hospital': 2, 'library': 4,
    'consulate': 0,
}
MIN_TOTAL = 25


def load_play_area(path: Path):
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('type') == 'FeatureCollection':
        geoms = [shape(f['geometry']) for f in data.get('features', []) if f.get('geometry')]
        if not geoms:
            raise RuntimeError('play-area file contains no geometry')
        return unary_union(geoms)
    if data.get('type') == 'Feature':
        return shape(data['geometry'])
    return shape(data)


def norm_name(value: str) -> str:
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = s.lower().replace('æ', 'ae').replace('ø', 'o').replace('å', 'a')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s.replace('aa', 'a')


def haversine_m(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1.0, math.sqrt(h)))


def approx_area_m2(geom):
    if geom.is_empty or geom.geom_type not in ('Polygon', 'MultiPolygon'):
        return float('nan')
    lat = geom.representative_point().y
    metres_lon = 111320.0 * math.cos(math.radians(lat))
    metres_lat = 111320.0
    return abs(float(geom.area)) * metres_lon * metres_lat


def park_name_allowed(name: str) -> bool:
    n = norm_name(name)
    exacts = {norm_name(x) for x in AALBORG_PARK_ADJACENT_EXACT}
    if n in exacts:
        return True
    for official in OFFICIAL_AALBORG_PARKS:
        o = norm_name(official)
        if n == o or n in o or o in n:
            return True
    return False


def category_matches(props):
    amenity = str(props.get('amenity', ''))
    tourism = str(props.get('tourism', ''))
    leisure = str(props.get('leisure', ''))
    landuse = str(props.get('landuse', ''))
    natural = str(props.get('natural', ''))
    boundary = str(props.get('boundary', ''))
    healthcare = str(props.get('healthcare', ''))
    office = str(props.get('office', ''))
    diplomatic = str(props.get('diplomatic', ''))

    out = []
    if props.get('aeroway') == 'aerodrome' and props.get('iata'):
        out.append('airport')
    if (leisure in {'park', 'garden', 'nature_reserve'} or landuse in {'recreation_ground', 'forest'}
            or boundary == 'protected_area' or natural == 'wood'):
        out.append('park')
    if tourism == 'theme_park': out.append('amusement')
    if tourism == 'zoo': out.append('zoo')
    if tourism == 'aquarium': out.append('aquarium')
    if leisure == 'golf_course': out.append('golf')
    if tourism == 'museum': out.append('museum')
    if amenity == 'cinema': out.append('cinema')
    if amenity == 'hospital' or healthcare == 'hospital': out.append('hospital')
    if amenity == 'library': out.append('library')
    if (office == 'diplomatic' and diplomatic == 'consulate') or amenity == 'consulate': out.append('consulate')
    return out


def point_feature(category, name, coord, props=None, **extra):
    p = props or {}
    osm_type = str(p.get('@type') or p.get('type') or '')
    osm_id = p.get('@id') or p.get('id')
    return {
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(float(coord[0]), 7), round(float(coord[1]), 7)]},
        'properties': {
            'name': name,
            '__displayName': name,
            '__poiKind': category,
            '__norm': norm_name(name),
            **({'osmType': osm_type} if osm_type else {}),
            **({'osmId': osm_id} if osm_id is not None else {}),
            **extra,
        },
    }


def dedupe_features(features):
    out = []
    for ft in features:
        coord = ft['geometry']['coordinates']
        p = ft['properties']
        n = p.get('__norm') or norm_name(p.get('name', ''))
        hit = None
        for i, old in enumerate(out):
            op = old['properties']
            same_osm = (p.get('osmType') and p.get('osmId') is not None and
                        p.get('osmType') == op.get('osmType') and p.get('osmId') == op.get('osmId'))
            d = haversine_m(coord, old['geometry']['coordinates'])
            if same_osm or d < 12 or (n and op.get('__norm') == n and d < 300):
                hit = i
                break
        if hit is None:
            out.append(ft)
            continue
        oldp = out[hit]['properties']
        if p.get('authoritative') and not oldp.get('authoritative'):
            out[hit] = ft
        elif bool(p.get('authoritative')) == bool(oldp.get('authoritative')):
            if len(str(p.get('name', ''))) > len(str(oldp.get('name', ''))):
                out[hit] = ft
    return out


def append_fallbacks(features, category, fallbacks):
    out = list(features)
    for f in fallbacks:
        coord = f.get('coordinates')
        if not coord:
            continue
        ft = point_feature(category, f['name'], coord,
                           authoritative=bool(f.get('authoritative')),
                           fallback=True,
                           servicePoint=bool(f.get('servicePoint', False)))
        n = ft['properties']['__norm']
        hit = None
        for i, old in enumerate(out):
            d = haversine_m(coord, old['geometry']['coordinates'])
            same_name = n and old['properties'].get('__norm') == n
            if d < 30 or same_name:
                hit = i
                break
        if hit is None:
            out.append(ft)
        elif f.get('authoritative'):
            out[hit] = ft
    return out


def geocode_address(address: str):
    query = urllib.parse.urlencode({'q': address, 'struktur': 'mini', 'per_side': 1})
    url = 'https://api.dataforsyningen.dk/adresser?' + query
    req = urllib.request.Request(url, headers={'User-Agent': 'aalborg-hide-seek-poi-updater/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            rows = json.load(res)
        if not rows:
            return None
        hit = rows[0]
        x, y = hit.get('x'), hit.get('y')
        if x is None or y is None:
            ap = ((hit.get('adgangsadresse') or {}).get('adgangspunkt') or {}).get('koordinater')
            if ap and len(ap) >= 2:
                x, y = ap[:2]
        if x is None or y is None:
            return None
        return [float(x), float(y)]
    except Exception as exc:
        print(f'warning: geocoding failed for {address!r}: {exc}', file=sys.stderr)
        return None


def parse_existing_bundle(path: Path):
    if not path.exists():
        return None
    text = path.read_text(encoding='utf-8')
    m = re.search(r'window\.AALBORG_POI_DATA\s*=\s*(\{.*\});\s*$', text, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
        return data if data.get('ready') else None
    except Exception:
        return None


def collapse_hospitals(features):
    kept = []
    for ft in features:
        hit = None
        for i, old in enumerate(kept):
            if haversine_m(ft['geometry']['coordinates'], old['geometry']['coordinates']) <= 350:
                hit = i
                break
        if hit is None:
            kept.append(ft)
            continue
        p, op = ft['properties'], kept[hit]['properties']
        if p.get('authoritative') and not op.get('authoritative'):
            kept[hit] = ft
        elif bool(p.get('authoritative')) == bool(op.get('authoritative')):
            if len(str(p.get('name', ''))) > len(str(op.get('name', ''))):
                kept[hit] = ft
    return kept


def build_bundle(source_geojson: Path, play_area_path: Path):
    play = load_play_area(play_area_path)
    source = json.loads(source_geojson.read_text(encoding='utf-8'))
    features = source.get('features', []) if source.get('type') == 'FeatureCollection' else []

    by_category = defaultdict(list)
    for raw in features:
        props = dict(raw.get('properties') or {})
        categories = category_matches(props)
        if not categories or not raw.get('geometry'):
            continue
        try:
            geom = shape(raw['geometry'])
            if geom.is_empty:
                continue
            rep = geom if geom.geom_type == 'Point' else geom.representative_point()
            coord = [float(rep.x), float(rep.y)]
        except Exception:
            continue

        name = props.get('name') or props.get('name:da') or props.get('official_name') or props.get('brand')
        for category in categories:
            if category in AUTHORITATIVE_ONLY:
                continue
            display = str(name or f'Unnamed {CATEGORY_LABELS[category].lower()}')
            if category == 'park':
                if park_name_allowed(display):
                    pass
                else:
                    if props.get('leisure') != 'park' or not name:
                        continue
                    if str(props.get('access', '')).lower() in {'private', 'no'}:
                        continue
                    area_m2 = approx_area_m2(geom)
                    if not math.isfinite(area_m2) or area_m2 < PARK_AUTO_MIN_AREA_M2:
                        continue
            by_category[category].append(point_feature(category, display, coord, props))

    # Use exactly the app's current authoritative local sets for stable categories.
    for category, fallbacks in AUTHORITATIVE_ONLY.items():
        by_category[category] = append_fallbacks([], category, fallbacks)

    # Parks retain the curated public recreation fallbacks used by the live app.
    by_category['park'] = append_fallbacks(dedupe_features(by_category['park']), 'park', AALBORG_PARK_ADJACENT_FALLBACK)

    # Hospitals combine OSM with Region Nordjylland's current named-site fallbacks.
    # The known sites carry stable coordinates, so a geocoder outage can never
    # make the weekly build fail. Geocoding remains a best-effort compatibility
    # fallback only if a future entry is added without coordinates.
    by_category['hospital'] = dedupe_features(by_category['hospital'])
    hospital_fallbacks = []
    unresolved_hospitals = []
    existing_hospital_names = {ft['properties'].get('__norm') for ft in by_category['hospital']}
    for h in AALBORG_HOSPITAL_FALLBACK:
        wanted = norm_name(h['name'])
        if wanted in existing_hospital_names:
            continue
        coord = h.get('coordinates') or geocode_address(h['address'])
        if coord:
            hospital_fallbacks.append({**h, 'coordinates': coord, 'authoritative': True})
        else:
            unresolved_hospitals.append(h['name'])
    if unresolved_hospitals:
        print('warning: unresolved authoritative hospital sites: ' + ', '.join(unresolved_hospitals), file=sys.stderr)
    by_category['hospital'] = append_fallbacks(by_category['hospital'], 'hospital', hospital_fallbacks)
    by_category['hospital'] = collapse_hospitals(by_category['hospital'])

    # Generic OSM categories get the same co-location/name dedupe as the browser parser.
    for category in CATEGORY_ORDER:
        if category not in {'park', 'hospital'} and category not in AUTHORITATIVE_ONLY:
            by_category[category] = dedupe_features(by_category[category])

    # Most cards use candidate points inside the game area. Commercial airport
    # is the intentional exception: Aalborg Airport sits just outside the four
    # Zone-2 polygons but is still the relevant airport for every player inside
    # the game. Keep it in the bundle for both Matching and Measuring.
    for category in CATEGORY_ORDER:
        kept = []
        for ft in by_category[category]:
            try:
                if category == 'airport' or play.covers(Point(ft['geometry']['coordinates'])):
                    kept.append(ft)
            except Exception:
                pass
        kept.sort(key=lambda f: (norm_name(f['properties'].get('name', '')), f['geometry']['coordinates']))
        by_category[category] = kept

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    return {
        'version': 1,
        'ready': True,
        'generatedAt': generated_at,
        'source': 'OpenStreetMap via Geofabrik Denmark extract; authoritative local fallbacks retained',
        'license': 'OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0',
        'categories': {
            k: {'type': 'FeatureCollection', 'features': by_category[k]}
            for k in CATEGORY_ORDER
        },
    }


def validate_bundle(bundle, existing=None):
    counts = {k: len(bundle['categories'][k]['features']) for k in CATEGORY_ORDER}
    errors = []
    for k, minimum in MIN_COUNTS.items():
        if counts[k] < minimum:
            errors.append(f'{k}: expected at least {minimum}, got {counts[k]}')
    total = sum(counts.values())
    if total < MIN_TOTAL:
        errors.append(f'total POIs: expected at least {MIN_TOTAL}, got {total}')

    if existing and existing.get('ready'):
        old = {k: len((existing.get('categories', {}).get(k) or {}).get('features', [])) for k in CATEGORY_ORDER}
        old_total = sum(old.values())
        if old_total and total < old_total * 0.60:
            errors.append(f'total POIs dropped suspiciously from {old_total} to {total}')
        for k in CATEGORY_ORDER:
            if old[k] >= 5 and counts[k] < old[k] * 0.45:
                errors.append(f'{k} dropped suspiciously from {old[k]} to {counts[k]}')

    # No malformed/out-of-range points.
    for k in CATEGORY_ORDER:
        for ft in bundle['categories'][k]['features']:
            c = (ft.get('geometry') or {}).get('coordinates') or []
            if len(c) < 2 or not (8.5 <= c[0] <= 10.6 and 56.7 <= c[1] <= 57.4):
                errors.append(f'{k}: invalid/out-of-region coordinate {c}')
                break
    if errors:
        raise RuntimeError('POI validation failed:\n  - ' + '\n  - '.join(errors))
    return counts


def write_outputs(bundle, output: Path, audit: Path, existing=None):
    # Keep generatedAt stable when the actual POI payload is unchanged, so the
    # weekly job does not create meaningless commits solely because time passed.
    if existing and existing.get('ready'):
        old_payload = existing.get('categories')
        if old_payload == bundle.get('categories'):
            bundle['generatedAt'] = existing.get('generatedAt', bundle['generatedAt'])

    text = '/* Auto-generated by scripts/update_pois.py. Do not edit by hand. */\n' \
           'window.AALBORG_POI_DATA = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n'
    output.write_text(text, encoding='utf-8')

    counts = {k: len(bundle['categories'][k]['features']) for k in CATEGORY_ORDER}
    lines = [
        '# Aalborg POI bundle audit', '',
        f'- Generated: `{bundle["generatedAt"]}`',
        '- Source: OpenStreetMap Denmark extract from Geofabrik + the project\'s authoritative local fallbacks',
        '- License: OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0',
        '- Scope: representative points inside the Hide + Seek play-area snapshot; commercial airport is retained just outside the boundary as an explicit game-rule exception', '',
        '| Category | Count |', '|---|---:|',
    ]
    for k in CATEGORY_ORDER:
        lines.append(f'| {CATEGORY_LABELS[k]} | {counts[k]} |')
    lines += ['', f'**Total: {sum(counts.values())} POIs**', '', '## Included names', '']
    for k in CATEGORY_ORDER:
        names = [f['properties'].get('name', '') for f in bundle['categories'][k]['features']]
        lines += [f'### {CATEGORY_LABELS[k]} ({len(names)})', '', ', '.join(names) if names else '_None in the play area._', '']
    audit.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source_geojson', type=Path, help='GeoJSON from `osmium export` after POI tag filtering')
    ap.add_argument('--play-area', type=Path, default=DEFAULT_PLAY_AREA)
    ap.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    ap.add_argument('--audit', type=Path, default=DEFAULT_AUDIT)
    args = ap.parse_args()

    existing = parse_existing_bundle(args.output)
    bundle = build_bundle(args.source_geojson, args.play_area)
    counts = validate_bundle(bundle, existing)
    write_outputs(bundle, args.output, args.audit, existing)
    print('POI bundle generated successfully')
    for k in CATEGORY_ORDER:
        print(f'  {k:10s} {counts[k]:3d}')
    print(f'  {"total":10s} {sum(counts.values()):3d}')


if __name__ == '__main__':
    main()
