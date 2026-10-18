#!/usr/bin/env python3
"""Check that the map data is fresh and that every outside service still answers.

Run by the weekly workflow after the data refresh. Writes a Markdown report and
exits non-zero when something needs attention, so the workflow can open an issue.

    python scripts/health_check.py --report health.md --max-age-days 8
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for `common`, even under python -I
from common import ROOT, city_ids, load_city  # noqa: E402

USER_AGENT = 'jetlag-aalborg-health-check (+https://github.com/Negi132/jetlag-aalborg)'
FEED_MIN_DAYS_LEFT = 14

# Services the weekly refresh downloads from (checked with HEAD; they are large).
DATA_SOURCES = {
    'Rejseplanen GTFS feed': 'https://www.rejseplanen.info/labs/GTFS.zip',
    'Geofabrik Denmark OpenStreetMap extract': 'https://download.geofabrik.de/europe/denmark-latest.osm.pbf',
}


def live_services():
    """Services the browser calls while playing: the relay, and each city's zone WFS."""
    services = {'ntfy.sh relay (shared maps)': 'https://ntfy.sh/v1/health'}
    for city_id in city_ids():
        zones = load_city(city_id).config['zones']
        url = zones['serviceUrl']
        sep = '&' if '?' in url else '?'
        services[f'{zones["service"]} zone WFS for {load_city(city_id).name} (live zone fallback)'] = \
            f'{url}{sep}service=WFS&request=GetCapabilities'
    return services


def fetch(url: str, method: str = 'GET', timeout: int = 45):
    req = urllib.request.Request(url, method=method, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = res.read() if method == 'GET' else b''
        return res.status, res.headers.get('Content-Type', ''), body


def bundle(path: Path, global_name: str):
    text = Path(path).read_text(encoding='utf-8')
    start = text.index('window.' + global_name)
    return json.loads(text[text.index('{', start):text.rstrip().rstrip(';').rindex('}') + 1])


def tile_xy(lat: float, lng: float, z: int):
    n = 2 ** z
    x = int((lng + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


class Report:
    def __init__(self):
        self.rows = []

    def add(self, area: str, ok: bool, detail: str):
        self.rows.append((area, ok, detail))
        print(f"{'ok  ' if ok else 'FAIL'}  {area}: {detail}")

    def attempt(self, area: str, fn):
        try:
            ok, detail = fn()
        except Exception as exc:   # a crash in one check must not hide the others
            ok, detail = False, f'{type(exc).__name__}: {exc}'[:300]
        self.add(area, ok, detail)

    @property
    def problems(self):
        return [r for r in self.rows if not r[1]]

    def markdown(self) -> str:
        lines = ['| Check | Status | Detail |', '|---|---|---|']
        for area, ok, detail in self.rows:
            lines.append(f"| {area} | {'✅' if ok else '❌'} | {detail.replace('|', '/')} |")
        return '\n'.join(lines) + '\n'


def check_freshness(report: Report, max_age_days: int):
    """Every city's generated bundles are recent, and its timetable is not about to expire."""
    now = datetime.now(timezone.utc)
    for city_id in city_ids():
        city = load_city(city_id)
        for file, global_name in (
            ('transit-data.js', 'HS_GTFS_TRANSIT'),
            ('poi-data.js', 'HS_POI_DATA'),
            ('hydro-data.js', 'HS_HYDRO_DATA'),
            ('zone-data.js', 'HS_ZONE_DATA'),
        ):
            def one(path=city.path(file), global_name=global_name):
                data = bundle(path, global_name)
                if not data.get('ready'):
                    return False, 'bundle is not marked ready'
                generated = datetime.fromisoformat(str(data['generatedAt']).replace('Z', '+00:00'))
                age = (now - generated).total_seconds() / 86400
                return age <= max_age_days, f'generated {generated:%Y-%m-%d} ({age:.1f} days ago, limit {max_age_days})'
            report.attempt(f'Fresh data: {city_id}/{file}', one)

        def feeds(city=city):
            today = date.today()
            bus_end = date.fromisoformat(bundle(city.path('bus-routes.js'), 'HS_GTFS_BUS_ROUTES')['metadata']['feed_end'])
            transit_end = date.fromisoformat(bundle(city.path('transit-data.js'), 'HS_GTFS_TRANSIT')['feedEnd'])
            left = min((bus_end - today).days, (transit_end - today).days)
            return left >= FEED_MIN_DAYS_LEFT, f'timetable valid until {min(bus_end, transit_end)} ({left} days left)'
        report.attempt(f'GTFS timetable still valid: {city_id}', feeds)


def check_page_assets(report: Report):
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    for url in sorted(set(re.findall(r'(?:src|href)="(https://[^"]+)"', html))):
        if re.fullmatch(r'https://[^/]+/?', url):   # bare preconnect hint, not a file
            continue
        def one(url=url):
            status, ctype, body = fetch(url)
            return status == 200 and len(body) > 200, f'HTTP {status}, {len(body)} bytes'
        report.attempt(f'Page asset: {url.split("/")[2]} {url.rsplit("/", 1)[-1][:40]}', one)


def check_basemaps(report: Report):
    """Every basemap must serve real, varying tiles.

    A provider that starts requiring a key often keeps answering 200 with the
    same placeholder image for every tile, so two neighbouring tiles must differ.
    """
    app = (ROOT / 'app.js').read_text(encoding='utf-8')
    templates = re.findall(r"L\.tileLayer\('([^']+)'", app)
    x, y = tile_xy(*load_city().config['map']['center'], 14)
    for template in templates:
        def one(template=template):
            hashes = []
            for dx in (0, 1):
                url = (template.replace('{s}', 'a').replace('{z}', '14').replace('{x}', str(x + dx))
                       .replace('{y}', str(y)).replace('{r}', ''))
                status, ctype, body = fetch(url)
                if status != 200 or not ctype.startswith('image/'):
                    return False, f'HTTP {status} {ctype} for {url}'
                hashes.append(hashlib.sha1(body).hexdigest())
            if hashes[0] == hashes[1]:
                return False, 'neighbouring tiles are identical — probably a placeholder/"API key required" image'
            return True, 'serves distinct image tiles'
        report.attempt(f'Basemap: {template.split("/")[2]}', one)


def check_services(report: Report):
    for name, url in DATA_SOURCES.items():
        def head(url=url):
            status, ctype, _ = fetch(url, method='HEAD')
            return status == 200, f'HTTP {status}'
        report.attempt(f'Data source: {name}', head)
    for name, url in live_services().items():
        def get(url=url):
            status, ctype, body = fetch(url)
            return live_service_ok(status, body)
        report.attempt(f'Live service: {name}', get)


def live_service_ok(status: int, body: bytes):
    """(ok, detail) for a live service's reply.

    A health endpoint (ntfy.sh's /v1/health) answers with a tiny JSON
    {"healthy": true}, so judge it by that; anything else must send real content.
    """
    try:
        data = json.loads(body)
    except ValueError:
        data = None
    if isinstance(data, dict) and 'healthy' in data:
        return status == 200 and data['healthy'] is True, f'HTTP {status}, healthy={data["healthy"]}'
    return status == 200 and len(body) > 100, f'HTTP {status}, {len(body)} bytes'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--max-age-days', type=int, default=8,
                    help='how old a generated bundle may be (0 skips the freshness check)')
    args = ap.parse_args()

    report = Report()
    if args.max_age_days:
        check_freshness(report, args.max_age_days)
    check_page_assets(report)
    check_basemaps(report)
    check_services(report)

    summary = (f'**{len(report.problems)} problem(s)** found.\n\n' if report.problems
               else '**All checks passed.**\n\n') + report.markdown()
    args.report.write_text(summary, encoding='utf-8')
    sys.exit(1 if report.problems else 0)


if __name__ == '__main__':
    main()
