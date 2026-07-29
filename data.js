/* =============================================================
   Aalborg zone data — APPROXIMATE

   These are not the municipality's official boundaries. They are
   estimated from screenshots of Aalborg's KortInfo map, and they
   will be wrong by a few hundred metres in places.

   Rather than hand-trace 30-odd district outlines by eye (which
   invents precision that isn't there), each district is stored as
   a single centre point. Zone 3 is then built as nearest-centre
   territories — so every location belongs to whichever district
   centre is closest. That is an honest approximation: it gets the
   layout right and only the exact borders are fuzzy.

   Zone 2 is the union of those districts by `area`, so zones 2 and
   3 can never disagree with each other.

   TO CORRECT A DISTRICT: nudge its lat/lng below, or drop the
   district entirely and draw it by hand in the Layers tab.
   TO REGROUP: change the `area` number (1-4).
   ============================================================= */

const AALBORG_AREAS = {
  1: { name: 'Midtbyen',      color: '#e8734d' },
  2: { name: 'Nørresundby',   color: '#4f9bd8' },
  3: { name: 'Vest Aalborg',  color: '#5fb56a' },
  4: { name: 'Øst Aalborg',   color: '#b878cf' }
};

/* name, latitude, longitude, area */
const AALBORG_DISTRICTS = [
  // ── North of the Limfjord — area 2, Nørresundby ──────────────
  ['Landområde Nørresundby', 57.1010,  9.9060, 2],
  ['Lindholm',               57.0710,  9.8940, 2],
  ['Løvvang',                57.0700,  9.9285, 2],
  ['Skansekvarteret',        57.0645,  9.9120, 2],
  ['Nørresundby Midtby',     57.0580,  9.9250, 2],
  ['Nørre Uttrup',           57.0748,  9.9425, 2],
  ['Landområde Øst',         57.0800, 10.0320, 2],
  ['Stae',                   57.0890, 10.1330, 2],
  ['Langholt',               57.1250, 10.1100, 2],

  // ── The core — area 1, Midtbyen ──────────────────────────────
  ['Aalborg Midtby',         57.0470,  9.9210, 1],
  ['Vestbyen',               57.0490,  9.9020, 1],
  ['Kærby',                  57.0345,  9.9090, 1],
  ['Grønlandskvarteret',     57.0330,  9.9215, 1],

  // ── West — area 3, Vest Aalborg ──────────────────────────────
  ['Mølholm',                57.0450,  9.8770, 3],
  ['Hasseris',               57.0390,  9.8850, 3],
  ['Sofiendal',              57.0260,  9.8760, 3],
  ['Skalborg',               57.0160,  9.8850, 3],
  ['Dall Villaby',           56.9990,  9.8890, 3],

  // ── East and south-east — area 4, Øst Aalborg ────────────────
  ['Vejgård',                57.0440,  9.9470, 4],
  ['Nørre Tranders',         57.0400,  9.9630, 4],
  ['Smedegård',              57.0390,  9.9760, 4],
  ['Rørdal',                 57.0660,  9.9930, 4],
  ['Erhverv Øst',            57.0560, 10.0250, 4],
  ['Tornhøj',                57.0300,  9.9740, 4],
  ['Universitetsområdet',    57.0160,  9.9780, 4],
  ['Gug',                    57.0130,  9.9330, 4],
  ['Visse',                  56.9990,  9.9490, 4],
  ['Landområde Sydøst',      56.9980,  9.9880, 4],
  ['Gistrup',                56.9910, 10.0140, 4],
  ['Klarup',                 57.0100, 10.0500, 4],
  ['Storvorde',              57.0000, 10.1000, 4]
];

/* How far past the outermost district centre the play area reaches.
   The convex hull of the centres alone would clip the edge districts
   in half, so it gets padded. */
const AALBORG_HULL_PAD_KM = 2.2;

if (typeof window !== 'undefined') {
  window.AALBORG_AREAS = AALBORG_AREAS;
  window.AALBORG_DISTRICTS = AALBORG_DISTRICTS;
  window.AALBORG_HULL_PAD_KM = AALBORG_HULL_PAD_KM;
}
