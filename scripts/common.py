"""Helpers shared by the map-data generators in this folder."""
from __future__ import annotations

import csv
import io
import json
import math
import re
import unicodedata
import zipfile
from datetime import datetime
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
PLAY_AREA = ROOT / 'scripts' / 'play_area.geojson'

# Generous box around Aalborg; a play area outside it is a corrupted snapshot.
AALBORG_BOUNDS = (9.65, 56.86, 10.32, 57.24)


def normalise_name(value, *, drop_parenthetical: bool = False, fold_aa: bool = False) -> str:
    """Lower-case ASCII form of a Danish name for matching ("Nørresundby" -> "norresundby").

    drop_parenthetical removes "(…)" qualifiers; fold_aa treats "aa" and "å" alike.
    """
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = s.lower().replace('æ', 'ae').replace('ø', 'o').replace('å', 'a')
    if drop_parenthetical:
        s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s.replace('aa', 'a') if fold_aa else s


def natural_key(value):
    """Sort key that orders route numbers naturally: 2 < 11 < 60X."""
    parts = re.split(r'(\d+)', str(value or '').upper())
    return tuple(int(p) if p.isdigit() else p for p in parts)


def haversine_m(a, b) -> float:
    """Great-circle distance in metres between two [lng, lat] points."""
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1.0, math.sqrt(h)))


def geometry_from_geojson(data):
    """One shapely geometry from a GeoJSON FeatureCollection, Feature or geometry."""
    if data.get('type') == 'FeatureCollection':
        geoms = [shape(f['geometry']) for f in data.get('features', []) if f.get('geometry')]
        if not geoms:
            raise RuntimeError('play-area file has no polygon geometry')
        return unary_union(geoms)
    if data.get('type') == 'Feature':
        return shape(data['geometry'])
    return shape(data)


def load_play_area(path: Path = PLAY_AREA, *, check_bounds: bool = False):
    """The game area (union of the four Zone 2 areas) from a GeoJSON file."""
    play = geometry_from_geojson(json.loads(Path(path).read_text(encoding='utf-8')))
    if check_bounds:
        minx, miny, maxx, maxy = play.bounds
        lo_x, lo_y, hi_x, hi_y = AALBORG_BOUNDS
        if minx < lo_x or miny < lo_y or maxx > hi_x or maxy > hi_y:
            raise RuntimeError(
                'play-area snapshot is outside the expected Aalborg game vicinity: '
                f'{minx:.4f},{miny:.4f},{maxx:.4f},{maxy:.4f}. '
                'Keep the previous scripts/play_area.geojson and refresh zones later.'
            )
    return play


def read_csv_from_zip(zf: zipfile.ZipFile, name: str):
    """Open a GTFS table; returns (text handle to close, csv.DictReader)."""
    text = io.TextIOWrapper(zf.open(name), encoding='utf-8-sig', newline='')
    return text, csv.DictReader(text)


def feed_dates(zf: zipfile.ZipFile):
    """First and last service dates in a GTFS feed as YYYY-MM-DD, or 'unknown'."""
    starts, ends = [], []
    try:
        text, rows = read_csv_from_zip(zf, 'calendar.txt')
        with text:
            for row in rows:
                if row.get('start_date'):
                    starts.append(row['start_date'])
                if row.get('end_date'):
                    ends.append(row['end_date'])
    except KeyError:
        pass
    fmt = lambda s: datetime.strptime(s, '%Y%m%d').strftime('%Y-%m-%d')
    return (fmt(min(starts)) if starts else 'unknown', fmt(max(ends)) if ends else 'unknown')


def line_parts(geom):
    """The LineStrings inside a clipped line geometry (dropping points and empties)."""
    if geom.is_empty:
        return []
    if geom.geom_type == 'LineString':
        return [geom]
    if geom.geom_type == 'MultiLineString':
        return list(geom.geoms)
    if geom.geom_type == 'GeometryCollection':
        return [g for g in geom.geoms if g.geom_type == 'LineString' and not g.is_empty]
    return []


def rounded_line_coords(line, ndigits: int = 6):
    """Line coordinates rounded to ~0.1 m, with repeated points removed; [] if degenerate."""
    clean = []
    for x, y in line.coords:
        p = [round(float(x), ndigits), round(float(y), ndigits)]
        if not clean or p != clean[-1]:
            clean.append(p)
    return clean if len(clean) >= 2 else []
