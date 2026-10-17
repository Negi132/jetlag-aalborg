#!/usr/bin/env python3
"""List the cities, for the workflow's loops.

    python scripts/cities.py              # aalborg aarhus …
    python scripts/cities.py bbox aalborg # 9.7,56.94,10.25,57.18 (osmium --bbox)
"""
import json
import sys
from pathlib import Path

# Reads city.json directly, so this runs before the generators' dependencies are installed.
CITIES_DIR = Path(__file__).resolve().parents[1] / 'cities'


def city_ids():
    return sorted(p.name for p in CITIES_DIR.iterdir() if (p / 'city.json').is_file())


def main(argv):
    if not argv:
        print(' '.join(city_ids()))
    elif argv[0] == 'bbox' and len(argv) == 2:
        config = json.loads((CITIES_DIR / argv[1] / 'city.json').read_text(encoding='utf-8'))
        print(','.join(str(v) for v in config['bounds']['search']))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
