"""Helpers shared by the map-data generators in this folder.

Each city has a folder, cities/<id>/, holding its settings (city.json), its
play area (play_area.geojson) and the data files the generators write. Every
generator takes --city (default: aalborg).
"""
from __future__ import annotations

import csv
import functools
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
CITIES_DIR = ROOT / 'cities'
DEFAULT_CITY = 'aalborg'


class City:
    """A city's settings (cities/<id>/city.json) and the folder its files live in."""

    def __init__(self, city_id: str):
        self.id = city_id
        self.dir = CITIES_DIR / city_id
        self.config = json.loads((self.dir / 'city.json').read_text(encoding='utf-8'))
        if self.config.get('id') != city_id:
            raise RuntimeError(f'{self.dir / "city.json"} says it is {self.config.get("id")!r}, not {city_id!r}')

    @property
    def name(self) -> str:
        return self.config['name']

    @property
    def play_area(self) -> Path:
        """The official play area every generator filters by (written by update_zones.py)."""
        return self.dir / 'play_area.geojson'

    def path(self, name: str) -> Path:
        return self.dir / name

    def bounds(self, key: str):
        """A [west, south, east, north] box from city.json's bounds."""
        return tuple(self.config['bounds'][key])

    def __repr__(self):
        return f'City({self.id!r})'


def city_ids():
    return sorted(p.name for p in CITIES_DIR.iterdir() if (p / 'city.json').is_file())


@functools.lru_cache(maxsize=None)
def load_city(city_id: str = DEFAULT_CITY) -> City:
    return City(city_id)


def add_city_argument(parser):
    parser.add_argument('--city', default=DEFAULT_CITY, choices=city_ids(),
                        help=f'which cities/<id>/ folder to read settings from and write to (default: {DEFAULT_CITY})')


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


def load_play_area(path: Path | None = None, *, city: City | None = None, check_bounds: bool = False):
    """The game area (union of the Zone 2 play areas), by default the city's play_area.geojson.

    check_bounds rejects one outside the city's bounds.playArea box: a corrupted snapshot.
    """
    city = city or load_city()
    path = Path(path) if path else city.play_area
    play = geometry_from_geojson(json.loads(path.read_text(encoding='utf-8')))
    if check_bounds:
        minx, miny, maxx, maxy = play.bounds
        lo_x, lo_y, hi_x, hi_y = city.bounds('playArea')
        if minx < lo_x or miny < lo_y or maxx > hi_x or maxy > hi_y:
            raise RuntimeError(
                f'play-area snapshot is outside the expected {city.name} game vicinity: '
                f'{minx:.4f},{miny:.4f},{maxx:.4f},{maxy:.4f}. '
                f'Keep the previous {city.play_area.relative_to(ROOT).as_posix()} and refresh zones later.'
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


def round_coords_deep(geometry, ndigits: int = 6):
    """A GeoJSON geometry with every coordinate rounded and tuples turned into lists."""
    def walk(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(float(v), ndigits) for v in c]
        return [walk(x) for x in c]
    return dict(geometry, coordinates=walk(geometry['coordinates']))
