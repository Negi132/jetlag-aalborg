#!/usr/bin/env python3
"""Build a city's static Matching-POI bundle from an Osmium GeoJSON export.

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
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import Point, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for `common`, even under python -I
from common import DEFAULT_CITY, add_city_argument, haversine_m, load_city, load_play_area, normalise_name

GLOBAL_NAME = 'HS_POI_DATA'
PARK_AUTO_MIN_AREA_M2 = 2500


def use_city(city_id: str = DEFAULT_CITY):
    """Point the generator at a city: its curated places, official names and minimum counts.

    Categories marked authoritativeOnly use exactly the city's own list (OSM is
    not consulted); the others combine OSM with any curated places.
    """
    global CITY, POIS, OFFICIAL_PARKS, PARK_ADJACENT_EXACT, PARK_FALLBACK, HOSPITAL_FALLBACK
    global AUTHORITATIVE_ONLY, MIN_COUNTS, MIN_TOTAL, POI_BOUNDS
    CITY = load_city(city_id)
    POIS = CITY.config['pois']
    cats = POIS['categories']
    park = cats.get('park', {})
    OFFICIAL_PARKS = park.get('officialNames', [])
    PARK_ADJACENT_EXACT = park.get('officialExactNames', [])
    PARK_FALLBACK = [dict(p) for p in park.get('places', [])]
    # Stable coordinates are stored with the authoritative site list so the
    # unattended updater never depends on a third-party geocoder being online.
    HOSPITAL_FALLBACK = [dict(p) for p in cats.get('hospital', {}).get('places', [])]
    AUTHORITATIVE_ONLY = {key: [{**p, 'authoritative': True} for p in c.get('places', [])]
                          for key, c in cats.items() if c.get('authoritativeOnly')}
    MIN_COUNTS = {key: cats.get(key, {}).get('minCount', 0) for key in CATEGORY_ORDER}
    MIN_TOTAL = POIS['minTotal']
    POI_BOUNDS = CITY.bounds('pois')
    return CITY


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

use_city()


def norm_name(value: str) -> str:
    return normalise_name(value, drop_parenthetical=True, fold_aa=True)


def approx_area_m2(geom):
    if geom.is_empty or geom.geom_type not in ('Polygon', 'MultiPolygon'):
        return float('nan')
    lat = geom.representative_point().y
    metres_lon = 111320.0 * math.cos(math.radians(lat))
    metres_lat = 111320.0
    return abs(float(geom.area)) * metres_lon * metres_lat


def park_name_allowed(name: str) -> bool:
    n = norm_name(name)
    exacts = {norm_name(x) for x in PARK_ADJACENT_EXACT}
    if n in exacts:
        return True
    for official in OFFICIAL_PARKS:
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


def parse_existing_bundle(path: Path):
    if not path.exists():
        return None
    text = path.read_text(encoding='utf-8')
    m = re.search(r'window\.' + GLOBAL_NAME + r'\s*=\s*(\{.*\});\s*$', text, re.S)
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


def build_bundle(source_geojson: Path, play_area_path: Path | None = None):
    play = load_play_area(play_area_path, city=CITY)
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
    by_category['park'] = append_fallbacks(dedupe_features(by_category['park']), 'park', PARK_FALLBACK)

    # Hospitals combine OSM with the city's named sites (Aalborg: Region Nordjylland's).
    # The known sites carry stable coordinates, so a geocoder outage can never
    # make the weekly build fail. Geocoding remains a best-effort compatibility
    # fallback only if a future entry is added without coordinates.
    by_category['hospital'] = dedupe_features(by_category['hospital'])
    hospital_fallbacks = []
    unresolved_hospitals = []
    existing_hospital_names = {ft['properties'].get('__norm') for ft in by_category['hospital']}
    for h in HOSPITAL_FALLBACK:
        wanted = norm_name(h['name'])
        if wanted in existing_hospital_names:
            continue
        coord = h.get('coordinates')
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

    # Candidate points must lie inside the game area. The airport fallback uses
    # the passenger-terminal/address point rather than the aerodrome centroid,
    # so it participates normally without an outside-area exception.
    for category in CATEGORY_ORDER:
        kept = []
        for ft in by_category[category]:
            try:
                if play.covers(Point(ft['geometry']['coordinates'])):
                    kept.append(ft)
            except Exception:
                pass
        kept.sort(key=lambda f: (norm_name(f['properties'].get('name', '')), f['geometry']['coordinates']))
        by_category[category] = kept

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    return {
        'version': 1,
        'ready': True,
        'generatedAt': generated_at,   # when the data last changed (kept if unchanged)
        'checkedAt': generated_at,     # when this job last rebuilt and validated it
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
            if len(c) < 2 or not (POI_BOUNDS[0] <= c[0] <= POI_BOUNDS[2] and POI_BOUNDS[1] <= c[1] <= POI_BOUNDS[3]):
                errors.append(f'{k}: invalid/out-of-region coordinate {c}')
                break
    if errors:
        raise RuntimeError('POI validation failed:\n  - ' + '\n  - '.join(errors))
    return counts


def write_outputs(bundle, output: Path, audit: Path, existing=None):
    # Keep generatedAt stable when the actual POI payload is unchanged: phones
    # compare it to tell whether they run the same data. checkedAt still moves,
    # and is what the health check's freshness rule reads.
    if existing and existing.get('ready'):
        old_payload = existing.get('categories')
        if old_payload == bundle.get('categories'):
            bundle['generatedAt'] = existing.get('generatedAt', bundle['generatedAt'])

    text = '/* Auto-generated by scripts/update_pois.py. Do not edit by hand. */\n' \
           f'window.{GLOBAL_NAME} = ' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';\n'
    output.write_text(text, encoding='utf-8')

    counts = {k: len(bundle['categories'][k]['features']) for k in CATEGORY_ORDER}
    lines = [
        f'# {CITY.name} POI bundle audit', '',
        f'- Checked: `{bundle["checkedAt"]}` · data last changed: `{bundle["generatedAt"]}`',
        '- Source: OpenStreetMap Denmark extract from Geofabrik + the project\'s authoritative local fallbacks',
        '- License: OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0',
        '- Scope: representative points inside the Hide + Seek play-area snapshot; the commercial-airport point is the passenger terminal rather than the aerodrome centroid', '',
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
    add_city_argument(ap)
    ap.add_argument('--play-area', type=Path, help="default: the city's play_area.geojson")
    ap.add_argument('--output', type=Path, help="default: the city's poi-data.js")
    ap.add_argument('--audit', type=Path, help="default: the city's POI_AUDIT.md")
    args = ap.parse_args()
    city = use_city(args.city)
    args.output = args.output or city.path('poi-data.js')
    args.audit = args.audit or city.path('POI_AUDIT.md')

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
