#!/usr/bin/env python3
"""Build the Aalborg bus-route bundle from Rejseplanen's static GTFS feed.

The script keeps every distinct scheduled NT GTFS shape that intersects the
Aalborg Hide + Seek play area. Geometry is cropped only to a small padded
Aalborg envelope; app.js performs the final clip against the live official
Zone 2 union in the browser.

Designed for GitHub Actions but also runnable locally:
    python scripts/update_bus_routes.py GTFS.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from shapely.geometry import LineString, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAY_AREA = ROOT / "scripts" / "play_area.geojson"
DEFAULT_CATEGORIES = ROOT / "scripts" / "bus_route_categories.json"
DEFAULT_OUTPUT = ROOT / "bus-routes.js"
DEFAULT_AUDIT = ROOT / "BUS_ROUTE_AUDIT.md"

# Deliberately conservative. A bad/partial source must never replace a good map.
MIN_CATEGORY_COUNTS = {"bybus": 8, "regional": 3, "express": 2, "local": 1}
MIN_TOTAL_ROUTES = 20
MAX_TOTAL_ROUTES = 80


def natural_route_key(ref: str):
    parts = re.split(r"(\d+)", ref.upper())
    return tuple(int(p) if p.isdigit() else p for p in parts)


def read_csv_from_zip(zf: zipfile.ZipFile, name: str):
    raw = zf.open(name)
    text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
    return text, csv.DictReader(text)


def load_play_area(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("type") == "FeatureCollection":
        geoms = [shape(f["geometry"]) for f in data.get("features", []) if f.get("geometry")]
        if not geoms:
            raise RuntimeError("play-area file has no polygon geometry")
        return unary_union(geoms)
    if data.get("type") == "Feature":
        return shape(data["geometry"])
    return shape(data)


def feed_dates(zf: zipfile.ZipFile):
    starts, ends = [], []
    try:
        text, rows = read_csv_from_zip(zf, "calendar.txt")
        with text:
            for row in rows:
                if row.get("start_date"):
                    starts.append(row["start_date"])
                if row.get("end_date"):
                    ends.append(row["end_date"])
    except KeyError:
        pass
    fmt = lambda s: datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")
    return (fmt(min(starts)) if starts else "unknown", fmt(max(ends)) if ends else "unknown")


def find_nt_agency(zf: zipfile.ZipFile):
    text, rows = read_csv_from_zip(zf, "agency.txt")
    with text:
        agencies = list(rows)
    for row in agencies:
        if row.get("agency_name", "").strip().upper() == "NT":
            return row.get("agency_id", "206"), row.get("agency_name", "NT")
    for row in agencies:
        if "NORDJYLLAND" in row.get("agency_name", "").upper():
            return row.get("agency_id", "206"), row.get("agency_name", "NT")
    raise RuntimeError("Could not find NT in agency.txt")


def load_category_rules(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    reverse = {}
    for category in ("bybus", "regional", "express", "local"):
        refs = [str(x).strip().upper() for x in data.get(category, [])]
        out[category] = refs
        for ref in refs:
            reverse[ref] = category
    return out, reverse


def classify_route(ref: str, reverse: dict[str, str]):
    key = ref.strip().upper()
    if key in reverse:
        return reverse[key], False
    # Night/special extras are present in GTFS but are not part of the four
    # transport-form filters selected for this game on NT's timetable page.
    if re.fullmatch(r"\d+[NE]", key):
        return None, False
    # For a genuinely new ordinary route, prefer showing it (with an audit
    # warning) over silently losing its geometry. The saved NT category list
    # remains authoritative for known local-vs-regional distinctions.
    if key.endswith("X"):
        return "express", True
    m = re.fullmatch(r"(\d+)", key)
    if m and int(m.group(1)) <= 30:
        return "bybus", True
    if m:
        return "regional", True
    return None, False


def parse_existing_refs(output_path: Path):
    if not output_path.exists():
        return set()
    text = output_path.read_text(encoding="utf-8")
    m = re.search(r"window\.AALBORG_GTFS_BUS_ROUTES\s*=\s*(\{.*\});\s*$", text, re.S)
    if not m:
        return set()
    try:
        data = json.loads(m.group(1))
        return {str(f.get("properties", {}).get("ref", "")) for f in data.get("features", []) if f.get("properties")}
    except Exception:
        return set()


def clipped_parts(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type == "MultiLineString":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        return [g for g in geom.geoms if g.geom_type == "LineString" and not g.is_empty]
    return []


def round_coords(line: LineString):
    coords = [[round(float(x), 6), round(float(y), 6)] for x, y in line.coords]
    # Remove repeated adjacent points after rounding.
    clean = []
    for p in coords:
        if not clean or p != clean[-1]:
            clean.append(p)
    return clean if len(clean) >= 2 else []


def build_bundle(gtfs: Path, play_area_path: Path, categories_path: Path):
    play = load_play_area(play_area_path)
    minx, miny, maxx, maxy = play.bounds
    # Matches the envelope used for the hand-built first GTFS bundle: enough
    # context around Zone 2 for accurate runtime clipping, without shipping
    # long regional tails through North Jutland.
    envelope = box(minx - 0.015, miny - 0.010, maxx + 0.015, maxy + 0.010)
    _, reverse_categories = load_category_rules(categories_path)

    with zipfile.ZipFile(gtfs) as zf:
        names = set(zf.namelist())
        for required in ("agency.txt", "routes.txt", "trips.txt", "shapes.txt"):
            if required not in names:
                raise RuntimeError(f"GTFS archive is missing {required}")

        agency_id, agency_name = find_nt_agency(zf)
        feed_start, feed_end = feed_dates(zf)

        route_to_ref = {}
        text, rows = read_csv_from_zip(zf, "routes.txt")
        with text:
            for row in rows:
                if row.get("agency_id") != agency_id:
                    continue
                # GTFS route_type 3 is ordinary bus. NT also has flex/on-demand
                # route types in the same feed; those are not part of this layer.
                if row.get("route_type") != "3":
                    continue
                ref = row.get("route_short_name", "").strip().upper()
                if ref:
                    route_to_ref[row["route_id"]] = ref

        shape_to_refs = defaultdict(set)
        text, rows = read_csv_from_zip(zf, "trips.txt")
        with text:
            for row in rows:
                ref = route_to_ref.get(row.get("route_id", ""))
                sid = row.get("shape_id", "").strip()
                if ref and sid:
                    shape_to_refs[sid].add(ref)

        needed = set(shape_to_refs)
        points = defaultdict(list)
        text, rows = read_csv_from_zip(zf, "shapes.txt")
        with text:
            for row in rows:
                sid = row.get("shape_id", "")
                if sid not in needed:
                    continue
                try:
                    seq = int(float(row.get("shape_pt_sequence", "0")))
                    lon = float(row["shape_pt_lon"])
                    lat = float(row["shape_pt_lat"])
                except (ValueError, KeyError):
                    continue
                points[sid].append((seq, lon, lat))

    route_parts = defaultdict(list)
    route_shape_ids = defaultdict(set)
    for sid, seq_points in points.items():
        if len(seq_points) < 2:
            continue
        seq_points.sort(key=lambda p: p[0])
        line = LineString([(p[1], p[2]) for p in seq_points])
        if line.is_empty or not line.intersects(play):
            continue
        clipped = line.intersection(envelope)
        parts = [round_coords(g) for g in clipped_parts(clipped)]
        parts = [p for p in parts if p]
        if not parts:
            continue
        for ref in shape_to_refs[sid]:
            route_shape_ids[ref].add(sid)
            route_parts[ref].extend(parts)

    inferred = []
    excluded_special = []
    features = []
    categories = {k: [] for k in ("bybus", "regional", "express", "local")}
    for ref in sorted(route_parts, key=natural_route_key):
        category, was_inferred = classify_route(ref, reverse_categories)
        if category is None:
            excluded_special.append(ref)
            continue
        if was_inferred:
            inferred.append((ref, category))
        categories[category].append(ref)

        # Exact duplicate shape fragments occur when several GTFS trips share a
        # shape. Keep all genuine variants but only one copy of identical lines.
        seen = set()
        unique = []
        for part in route_parts[ref]:
            key = tuple((p[0], p[1]) for p in part)
            rev = tuple(reversed(key))
            canonical = min(key, rev)
            if canonical in seen:
                continue
            seen.add(canonical)
            unique.append(part)

        geometry = (
            {"type": "LineString", "coordinates": unique[0]}
            if len(unique) == 1
            else {"type": "MultiLineString", "coordinates": unique}
        )
        features.append({
            "type": "Feature",
            "properties": {
                "ref": ref,
                "navn": ref,
                "category": category,
                "source": f"Rejseplanen GTFS {feed_start}",
                "__routeRefs": [ref],
                "__displayName": ref,
                "variants": len(route_shape_ids[ref]),
            },
            "geometry": geometry,
        })

    for refs in categories.values():
        refs.sort(key=natural_route_key)

    bundle = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Rejseplanen GTFS",
            "feed_date": feed_start,
            "feed_end": feed_end,
            "agency": agency_name,
            "agency_id": agency_id,
            "note": (
                "All scheduled GTFS bus shape variants whose route enters the Aalborg game area. "
                "Geometry is cropped to a padded Aalborg envelope; the app clips it to the exact "
                "live Zone 2 union before drawing."
            ),
            "categories": categories,
            "inferred_categories": [
                {"ref": ref, "category": category} for ref, category in inferred
            ],
            "excluded_special_routes": sorted(excluded_special, key=natural_route_key),
        },
        "features": features,
    }
    return bundle, inferred


def validate(bundle, previous_refs: set[str]):
    features = bundle.get("features", [])
    refs = {f.get("properties", {}).get("ref") for f in features}
    refs.discard(None)
    cats = bundle.get("metadata", {}).get("categories", {})
    problems = []
    total = len(refs)
    if total < MIN_TOTAL_ROUTES:
        problems.append(f"only {total} routes found (minimum {MIN_TOTAL_ROUTES})")
    if total > MAX_TOTAL_ROUTES:
        problems.append(f"{total} routes found (maximum sanity limit {MAX_TOTAL_ROUTES})")
    for cat, minimum in MIN_CATEGORY_COUNTS.items():
        count = len(cats.get(cat, []))
        if count < minimum:
            problems.append(f"{cat} has only {count} routes (minimum {minimum})")
    if previous_refs and len(previous_refs) >= MIN_TOTAL_ROUTES:
        floor = max(MIN_TOTAL_ROUTES, int(len(previous_refs) * 0.65))
        if total < floor:
            problems.append(
                f"route total collapsed from {len(previous_refs)} to {total}; refusing to overwrite"
            )
    for f in features:
        geom = f.get("geometry", {})
        if geom.get("type") not in ("LineString", "MultiLineString"):
            problems.append(f"route {f.get('properties',{}).get('ref')} has invalid geometry")
    if problems:
        raise RuntimeError("GTFS sanity checks failed:\n- " + "\n- ".join(problems))


def render_js(bundle):
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    date = bundle["metadata"].get("feed_date", "unknown")
    return (
        f"/* Generated automatically from Rejseplanen GTFS feed dated {date}. */\n"
        f"window.AALBORG_GTFS_BUS_ROUTES = {payload};\n"
    )


def render_audit(bundle, inferred, previous_refs):
    meta = bundle["metadata"]
    cats = meta["categories"]
    lines = [
        f"# Aalborg bus route audit — Rejseplanen GTFS {meta.get('feed_date','unknown')}",
        "",
        f"Generated automatically from agency {meta.get('agency_id')} = {meta.get('agency')}.",
        "Only scheduled GTFS bus shapes that intersect the Aalborg game area are bundled; the browser performs the final exact Zone 2 clip.",
        "",
    ]
    labels = [("bybus", "Bybus"), ("regional", "Regionalbus"), ("express", "Expresbus"), ("local", "Lokalbus")]
    for key, label in labels:
        refs = cats.get(key, [])
        lines += [f"## {label} — {len(refs)}", ", ".join(refs) if refs else "(none)", ""]
    current = {r for refs in cats.values() for r in refs}
    if previous_refs:
        added = sorted(current - previous_refs, key=natural_route_key)
        removed = sorted(previous_refs - current, key=natural_route_key)
        lines += ["## Changes from previous bundle", f"- Added: {', '.join(added) if added else 'none'}", f"- Removed: {', '.join(removed) if removed else 'none'}", ""]
    excluded_special = meta.get("excluded_special_routes", [])
    if excluded_special:
        lines += [
            "## GTFS special/night lines not in the game categories",
            ", ".join(excluded_special),
            "",
            "These are present in GTFS but are not part of the four NT transport-form categories selected for this game.",
            "",
        ]
    if inferred:
        lines += ["## Category inference", "These new/unknown route numbers were not in the saved NT category catalogue, so the generator inferred their category rather than dropping them:"]
        lines += [f"- {ref} → {cat}" for ref, cat in inferred]
        lines.append("")
    lines += [
        "## Automation safeguards",
        "- A partial/broken GTFS download cannot replace the working map if route counts collapse below sanity thresholds.",
        "- All distinct scheduled shape variants are retained; exact duplicate line fragments are removed.",
        "- `app.js` trusts the generated category tags, so a newly discovered route is not blocked by the legacy Overpass whitelist.",
        "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("gtfs", type=Path, help="Path to Rejseplanen GTFS.zip")
    parser.add_argument("--play-area", type=Path, default=DEFAULT_PLAY_AREA)
    parser.add_argument("--categories", type=Path, default=DEFAULT_CATEGORIES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    args = parser.parse_args()

    previous = parse_existing_refs(args.output)
    bundle, inferred = build_bundle(args.gtfs, args.play_area, args.categories)
    validate(bundle, previous)

    js = render_js(bundle)
    audit = render_audit(bundle, inferred, previous)
    args.output.write_text(js, encoding="utf-8")
    args.audit.write_text(audit, encoding="utf-8")

    cats = bundle["metadata"]["categories"]
    print(f"GTFS feed: {bundle['metadata']['feed_date']} to {bundle['metadata']['feed_end']}")
    print(f"NT agency: {bundle['metadata']['agency_id']} ({bundle['metadata']['agency']})")
    for key in ("bybus", "regional", "express", "local"):
        print(f"{key:8s}: {len(cats[key]):2d}  {' '.join(cats[key])}")
    print(f"total   : {len(bundle['features']):2d}")
    if inferred:
        print("WARNING: inferred categories: " + ", ".join(f"{r}->{c}" for r, c in inferred))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
