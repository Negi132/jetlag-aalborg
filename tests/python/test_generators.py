"""Tests for the map-data generators in scripts/.

Run from the repository root:  python -m unittest discover -s tests/python -v
Needs shapely and pyproj (the generators' own dependencies).
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from shapely.affinity import scale  # noqa: E402
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point, box, mapping  # noqa: E402

import common  # noqa: E402
import update_bus_routes as bus  # noqa: E402
import update_hydro as hydro  # noqa: E402
import update_pois as pois  # noqa: E402
import update_transit as transit  # noqa: E402
import update_zones as zones  # noqa: E402
import health_check  # noqa: E402
import make_kommune_outline  # noqa: E402

AALBORG = common.load_city('aalborg')
DATA = AALBORG.dir

# How each generator normalised names before the helpers were shared. The
# expected values were recorded from the original per-script functions.
NAME_CASES = {
    'Nørresundby': ('norresundby', 'norresundby', 'norresundby', 'norresundby'),
    'Vejgård Bibliotek': ('vejgard bibliotek',) * 4,
    'Vejgaard Bibliotek': ('vejgaard bibliotek', 'vejgard bibliotek', 'vejgard bibliotek', 'vejgaard bibliotek'),
    'Aalborg St. (Område A3 / John F. Kennedys Plads)': (
        'aalborg st', 'alborg st',
        'alborg st omrade a3 john f kennedys plads', 'aalborg st omrade a3 john f kennedys plads'),
    'Øst Aalborg': ('ost aalborg', 'ost alborg', 'ost alborg', 'ost aalborg'),
    'Æblehaven': ('aeblehaven',) * 4,
    '  Kildeparken!! ': ('kildeparken',) * 4,
    'Østerådalen Nord': ('osteradalen nord',) * 4,
    '': ('',) * 4,
}


def bundle_json(path: Path, global_name: str):
    """The JSON object a generated bundle assigns to window.<global_name>."""
    text = path.read_text(encoding='utf-8')
    start = text.index('window.' + global_name)
    return json.loads(text[text.index('{', start):text.rstrip().rstrip(';').rindex('}') + 1])


class SharedHelpersTest(unittest.TestCase):
    def test_name_normalisers_keep_each_generators_rules(self):
        for name, (t, p, h, z) in NAME_CASES.items():
            with self.subTest(name=name):
                self.assertEqual(transit.norm_name(name), t)
                self.assertEqual(pois.norm_name(name), p)
                self.assertEqual(hydro.norm(name), h)
                self.assertEqual(zones.norm_text(name), z)
        self.assertEqual(common.normalise_name(None), '')

    def test_natural_key_orders_route_numbers(self):
        refs = ['60X', '2', '11', 'FR1', '1', '950X']
        self.assertEqual(sorted(refs, key=common.natural_key), ['1', '2', '11', '60X', '950X', 'FR1'])

    def test_haversine_one_degree_of_latitude(self):
        d = common.haversine_m([9.92, 57.0], [9.92, 58.0])
        self.assertAlmostEqual(d, 111_195, delta=200)
        self.assertEqual(common.haversine_m([9.92, 57.0], [9.92, 57.0]), 0)

    def test_line_parts_keeps_only_lines(self):
        a, b = LineString([(0, 0), (1, 1)]), LineString([(2, 2), (3, 3)])
        self.assertEqual(len(common.line_parts(a)), 1)
        self.assertEqual(len(common.line_parts(MultiLineString([a, b]))), 2)
        self.assertEqual(len(common.line_parts(GeometryCollection([a, Point(5, 5)]))), 1)
        self.assertEqual(common.line_parts(LineString()), [])
        self.assertEqual(common.line_parts(Point(0, 0)), [])

    def test_rounded_line_coords_drops_repeats_and_degenerate_lines(self):
        line = LineString([(9.1234561, 57.0000001), (9.1234562, 57.0000002), (9.2, 57.1)])
        self.assertEqual(common.rounded_line_coords(line), [[9.123456, 57.0], [9.2, 57.1]])
        self.assertEqual(common.rounded_line_coords(LineString([(9.0, 57.0), (9.0000001, 57.0)])), [])

    def test_load_play_area_checks_bounds_when_asked(self):
        with tempfile.TemporaryDirectory() as tmp:
            far = Path(tmp) / 'far.geojson'
            far.write_text(json.dumps({'type': 'Feature', 'properties': {},
                                       'geometry': mapping(box(12.0, 55.6, 12.1, 55.7))}))
            common.load_play_area(far)  # no check: accepted
            with self.assertRaises(RuntimeError):
                common.load_play_area(far, check_bounds=True)


class CityTest(unittest.TestCase):
    """Every cities/<id>/city.json loads, and every generator can be pointed at it."""

    def test_the_default_city_exists(self):
        self.assertIn(common.DEFAULT_CITY, common.city_ids())

    def test_the_kommune_outline_script_loads(self):
        self.assertTrue(callable(make_kommune_outline.main))

    def test_every_city_loads_in_every_generator(self):
        try:
            for city_id in common.city_ids():
                with self.subTest(city=city_id):
                    city = common.load_city(city_id)
                    self.assertEqual(city.id, city_id)
                    self.assertTrue(city.play_area.name == 'play_area.geojson')
                    for module in (bus, transit, pois, hydro, zones):
                        self.assertIs(module.use_city(city_id), city)
                    self.assertEqual(sorted(zones.LAYERS), ['zone1', 'zone2', 'zone3', 'zone4'])
                    self.assertEqual(set(pois.MIN_COUNTS), set(pois.CATEGORY_ORDER))
                    self.assertTrue(bus.CATEGORY_KEYS)
        finally:
            for module in (bus, transit, pois, hydro, zones):
                module.use_city(common.DEFAULT_CITY)

    def test_a_city_file_must_name_its_own_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'elsewhere'
            folder.mkdir()
            (folder / 'city.json').write_text(json.dumps({'id': 'aalborg', 'name': 'X'}), encoding='utf-8')
            real = common.CITIES_DIR
            common.CITIES_DIR = Path(tmp)
            try:
                with self.assertRaises(RuntimeError):
                    common.City('elsewhere')
            finally:
                common.CITIES_DIR = real

    def test_aalborg_settings_match_what_was_hard_coded(self):
        self.assertEqual(zones.LAYERS['zone2'], 'ugis:TL445984')
        self.assertEqual(transit.BUS_AGENCY_ID, '206')
        self.assertEqual(transit.EXCLUDED_TRAIN_NAMES, {'osteradalen', 'osteraadalen', 'gug', 'hadsundvej', 'limfjorden', 'train limfjorden'})
        self.assertEqual(pois.MIN_COUNTS['park'], 10)
        self.assertEqual(sorted(pois.AUTHORITATIVE_ONLY), ['airport', 'cinema', 'golf', 'library', 'zoo'])
        self.assertEqual(bus.MIN_CATEGORY_COUNTS, {'bybus': 8, 'regional': 3, 'express': 2, 'local': 1})
        self.assertEqual((bus.MIN_TOTAL_ROUTES, bus.MAX_TOTAL_ROUTES), (20, 80))


class PlayAreaTest(unittest.TestCase):
    """cities/aalborg/play_area.geojson is the official Zone 2 union every generator filters by."""

    def setUp(self):
        self.data = json.loads(AALBORG.play_area.read_text(encoding='utf-8'))
        self.play = common.load_play_area(check_bounds=True)

    def test_has_the_four_named_areas(self):
        areas = sorted((f['properties']['area'], f['properties']['navn']) for f in self.data['features'])
        self.assertEqual([a for a, _ in areas], [1, 2, 3, 4])
        self.assertEqual([n for _, n in areas], ['Midtbyen', 'Nørresundby', 'Vest Aalborg', 'Øst Aalborg'])

    def test_passes_the_zone_snapshot_validation(self):
        area_km2 = zones.validate_play_geometry(self.play, self.play)
        self.assertTrue(80 < area_km2 < 140, area_km2)

    def test_hydro_splits_north_and_south_of_the_fjord(self):
        play, north, south = hydro.load_play()
        self.assertFalse(north.is_empty)
        self.assertGreater(north.centroid.y, south.centroid.y)
        self.assertAlmostEqual(north.area + south.area, play.area, places=9)


class ZoneSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.play = common.load_play_area()

    def test_rejects_a_play_area_far_larger_than_the_last_one(self):
        oversized = scale(self.play, 1.6, 1.6)   # ~2.5x the area, like the old tracing
        with self.assertRaises(RuntimeError):
            zones.validate_play_geometry(oversized, self.play)

    def test_rejects_implausible_areas_and_bounds(self):
        with self.assertRaises(RuntimeError):
            zones.validate_play_geometry(box(9.90, 57.04, 9.91, 57.05))   # ~0.6 km²
        with self.assertRaises(RuntimeError):
            zones.validate_play_geometry(box(12.0, 55.6, 12.2, 55.8))     # Copenhagen
        with self.assertRaises(RuntimeError):
            zones.validate_play_geometry(GeometryCollection())

    def test_recognises_zone2_area_names_in_any_field_order(self):
        self.assertEqual(zones.zone2_def({'PLOTNAVN': 'Nørresundby'}), (2, 'Nørresundby'))
        self.assertEqual(zones.zone2_def({'x': 'Aalborg Øst'}), (4, 'Øst Aalborg'))
        self.assertEqual(zones.zone2_def({'navn': 'Vest Aalborg'}), (3, 'Vest Aalborg'))
        self.assertIsNone(zones.zone2_def({'navn': 'Hals'}))

    def test_parses_kortinfo_gml_and_reprojects_utm32(self):
        gml = (b'<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" '
               b'xmlns:gml="http://www.opengis.net/gml"><gml:featureMember><ugis:x xmlns:ugis="u">'
               b'<ugis:navn>Midtbyen</ugis:navn><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>'
               b'556000 6322000 557000 6322000 557000 6323000 556000 6323000 556000 6322000'
               b'</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></ugis:x></gml:featureMember>'
               b'</wfs:FeatureCollection>')
        gj = zones.normalise_axis_order(zones.parse_gml(gml))
        self.assertEqual(len(gj['features']), 1)
        self.assertEqual(gj['features'][0]['properties']['navn'], 'Midtbyen')
        lng, lat = gj['features'][0]['geometry']['coordinates'][0][0]
        self.assertTrue(9.8 < lng < 10.1 and 56.9 < lat < 57.2, (lng, lat))

    def test_gml_service_exceptions_are_reported(self):
        with self.assertRaisesRegex(RuntimeError, 'Access denied'):
            zones.parse_gml(b'<ServiceExceptionReport><ServiceException>Access denied'
                            b'</ServiceException></ServiceExceptionReport>')

    def test_rounding_never_leaves_zero_length_segments(self):
        # Two vertices 0.04 m apart merge when rounded to 6 decimals.
        line = {'type': 'LineString', 'coordinates': [[9.9, 57.0], [9.9200001, 57.0], [9.9200002, 57.0], [9.95, 57.01]]}
        self.assertEqual(zones.round_coords(line)['coordinates'], [[9.9, 57.0], [9.92, 57.0], [9.95, 57.01]])
        ring = [[9.9, 57.0], [9.91, 57.0], [9.9100001, 57.0], [9.91, 57.01], [9.9, 57.0]]
        rounded = zones.round_coords({'type': 'Polygon', 'coordinates': [ring]})['coordinates'][0]
        self.assertEqual(rounded, [[9.9, 57.0], [9.91, 57.0], [9.91, 57.01], [9.9, 57.0]])

    def test_border_lines_that_collapse_are_dropped(self):
        fc = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': [[9.9, 57.0], [9.9, 57.0]]}},
            {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString',
                                                              'coordinates': [[9.9, 57.0], [9.91, 57.0], [9.91, 57.0], [9.9, 57.0]]}},
            {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'MultiLineString',
                                                              'coordinates': [[[9.8, 57.0], [9.8, 57.0]], [[9.8, 57.0], [9.81, 57.0]]]}},
        ]}
        out = zones.drop_degenerate_lines(fc)['features']
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]['geometry']['coordinates'], [[9.9, 57.0], [9.91, 57.0], [9.9, 57.0]])
        self.assertEqual(out[1]['geometry']['coordinates'], [[[9.8, 57.0], [9.81, 57.0]]])

    def test_round_coords_rounds_every_coordinate(self):
        gj = {'type': 'Feature', 'properties': {'v': 1.23456789},
              'geometry': {'type': 'Point', 'coordinates': [9.123456789, 57.987654321]}}
        out = zones.round_coords(gj)
        self.assertEqual(out['geometry']['coordinates'], [9.123457, 57.987654])
        self.assertEqual(out['properties']['v'], 1.23456789)   # properties untouched


class BusRoutesTest(unittest.TestCase):
    def setUp(self):
        self.bundle = bundle_json(DATA / 'bus-routes.js', 'HS_GTFS_BUS_ROUTES')
        self.categories, self.reverse = bus.load_category_rules()

    def test_category_snapshot_has_the_four_nt_categories(self):
        self.assertEqual(sorted(self.categories), ['bybus', 'express', 'local', 'regional'])
        self.assertTrue(all(self.categories.values()))

    def test_classifies_known_new_and_night_routes(self):
        self.assertEqual(bus.classify_route('11', self.reverse), ('bybus', False))
        self.assertEqual(bus.classify_route('38', self.reverse), ('local', False))
        self.assertEqual(bus.classify_route('21N', self.reverse), (None, False))
        self.assertEqual(bus.classify_route('999X', self.reverse), ('express', True))
        self.assertEqual(bus.classify_route('29', self.reverse)[0], 'bybus')
        self.assertEqual(bus.classify_route('555', self.reverse)[0], 'regional')

    def test_committed_bundle_passes_validation(self):
        bus.validate(self.bundle, bus.parse_existing_refs(DATA / 'bus-routes.js'))

    def test_validation_refuses_a_collapsed_route_set(self):
        collapsed = dict(self.bundle, features=self.bundle['features'][:3])
        with self.assertRaises(RuntimeError):
            bus.validate(collapsed, bus.parse_existing_refs(DATA / 'bus-routes.js'))


class TransitTest(unittest.TestCase):
    def setUp(self):
        self.bundle = transit.parse_existing(DATA / 'transit-data.js')

    def test_committed_bundle_is_ready_and_valid(self):
        self.assertIsNotNone(self.bundle)
        routes, bus_stops, rail_stops = transit.validate(self.bundle, self.bundle)
        self.assertGreaterEqual(routes, transit.MIN_TRAIN_ROUTES)
        self.assertGreaterEqual(bus_stops, transit.MIN_BUS_STOPS)
        self.assertGreaterEqual(rail_stops, transit.MIN_TRAIN_STOPS)

    def test_validation_refuses_a_bundle_that_lost_its_stops(self):
        broken = dict(self.bundle, stops={'type': 'FeatureCollection',
                                          'features': self.bundle['stops']['features'][:20]})
        with self.assertRaises(RuntimeError):
            transit.validate(broken, self.bundle)

    def test_heritage_halts_are_excluded_as_train_stations(self):
        rail = {transit.norm_name(f['properties']['name']) for f in self.bundle['stops']['features']
                if f['properties'].get('__stopKind') == 'train'}
        self.assertFalse(rail & transit.EXCLUDED_TRAIN_NAMES)


class PoiTest(unittest.TestCase):
    def setUp(self):
        self.bundle = pois.parse_existing_bundle(DATA / 'poi-data.js')

    def test_committed_bundle_is_ready_and_valid(self):
        self.assertIsNotNone(self.bundle)
        counts = pois.validate_bundle(self.bundle, self.bundle)
        self.assertEqual(set(counts), set(pois.CATEGORY_ORDER))

    def test_validation_refuses_a_bundle_with_no_parks(self):
        broken = json.loads(json.dumps(self.bundle))
        broken['categories']['park']['features'] = []
        with self.assertRaises(RuntimeError):
            pois.validate_bundle(broken, self.bundle)

    def test_every_authoritative_fallback_has_fixed_coordinates(self):
        # No geocoding service is used, so a place without coordinates would vanish.
        for place in pois.AUTHORITATIVE_ONLY['library'] + pois.HOSPITAL_FALLBACK:
            with self.subTest(place=place['name']):
                lng, lat = place['coordinates']
                self.assertTrue(9.4 < lng < 10.5 and 56.8 < lat < 57.3)

    def test_park_rules(self):
        self.assertTrue(pois.park_name_allowed('Kildeparken'))
        self.assertTrue(pois.park_name_allowed('Østerådalen Nord'))
        self.assertTrue(pois.park_name_allowed('Golfparken'))
        self.assertFalse(pois.park_name_allowed('Some private garden'))


class HealthCheckTest(unittest.TestCase):
    def test_tile_numbers_for_aalborg(self):
        self.assertEqual(health_check.tile_xy(57.0488, 9.9217, 12), (2160, 1253))

    def test_committed_data_passes_the_freshness_rules(self):
        report = health_check.Report()
        health_check.check_freshness(report, max_age_days=3650)
        self.assertEqual(report.problems, [], report.markdown())

    def test_stale_data_is_reported(self):
        report = health_check.Report()
        health_check.check_freshness(report, max_age_days=-1)   # everything counts as too old
        self.assertGreaterEqual(len(report.problems), 4)

    def test_health_endpoints_are_judged_by_their_answer(self):
        ok = health_check.live_service_ok
        self.assertTrue(ok(200, b'{"healthy":true,"role":"active"}')[0])    # ntfy.sh, 33 bytes
        self.assertFalse(ok(200, b'{"healthy":false}')[0])
        self.assertFalse(ok(503, b'{"healthy":true}')[0])
        self.assertTrue(ok(200, b'<WFS_Capabilities>' + b' ' * 200)[0])
        self.assertFalse(ok(200, b'<html></html>')[0])                     # too short to be real

    def test_a_crashing_check_is_reported_not_raised(self):
        report = health_check.Report()
        report.attempt('boom', lambda: 1 / 0)
        self.assertEqual(len(report.problems), 1)
        self.assertIn('ZeroDivisionError', report.markdown())


if __name__ == '__main__':
    unittest.main()
