# Geographic map (real coordinates)

Supersedes the image-pinned grid of `2026-10-23-alversjo-map-design.md` (§2–§5). That design
stored areas as cells of a 60×85 grid over a static image and said real-world accuracy was out
of scope. This one stores every shape in real coordinates, so the map can use drone and
satellite imagery, zoom freely, and exchange data with other tools (QGIS, Google Earth, the
Borderland placement map, GPS positions people publish).

## Data model

- `area.geometry`: `jsonb`, a GeoJSON (RFC 7946) `Polygon` or `MultiPolygon` in WGS84,
  positions `[lon, lat]`, rounded to 7 decimals (~1 cm). `null` = not on the map; the area
  stays bookable (e.g. "Kitchen").
- Validated on save (`parseAreaGeometry`): closed rings of ≥4 positions, numeric, inside a box
  around the property (catches swapped lat/lon), ≤5000 positions.
- No PostGIS: a few dozen shapes don't need it, and the tests run on PGlite. Geometry work
  happens in the app with Turf.
- `area_grid_cell` is no longer read or written except by the one-time conversion below. Drop
  it in a follow-up once production has been checked.

## Old image → real coordinates

`public/map/alversjo.jpg` (QGIS export, north-up) was georeferenced by matching its red building
outlines to the building polygons in the Borderland map's `drawnmap/buildings.geojson`
(github.com/theborderland/map): affine fit, 12 buildings, RMS 3.7 m, 1.15 m/px.
`src/lib/map/legacy-image.ts` holds the transform. It is used to:

- convert existing grid cells: `seedMapAreas` runs on every deploy (fly.toml
  `release_command`) and gives every area that has cells but no geometry an outline made by
  merging its cells. It never overwrites an existing outline;
- convert the eleven seed polygons (done once; `seed-data.ts` now holds `[lon, lat]`);
- show the image as an optional "Old property map" layer.

## Map UI

Leaflet + react-leaflet, loaded with `next/dynamic` (`ssr: false`) so only `/map` and the
editor download it (~150 KB). Layers:

- OpenStreetMap (base);
- drone orthophoto July 2026, 5 cm/px, Ebbe Valbak, CC-BY 4.0, served as tiles by
  OpenAerialMap (on by default; tiles only for what is on screen, a few MB per view);
- the old property map image (off by default);
- reference layers from `public/map/site/` (see below).

## Reference layers

Static GeoJSON in `public/map/site/`, taken on 2026-11-02 from the Borderland placement map
(github.com/theborderland/map, commit 826dccb) and the alversjomaps sound guide, with the
Borderland team's permission. Only permanent site features; event-specific things (camps,
plazas, neighbourhoods, main parking, gate, The Sanctuary, event toilets) are left out.

| Layer | Default |
|---|---|
| Property border + nature reserve | on |
| Places: The Barn, Machine Hall, The Brewery, Sheep barn, The Well, water tap, Downtown toilets | on |
| Buildings, lakes + water protection zone, paths, protected biotopes, flood-prone spots, neighbours, sound zones (class A–F) | off |

Reference shapes are drawn below areas (pane z-index 350) so they never catch clicks meant for
an area; reference points above them (450). The import script lives outside this repo
(`tools/map-data/import-site-layers.py` in the maintainers' workspace); rerun it to refresh.

`/map` (any member) draws each mapped area with its name; clicking shows details and upcoming
bookings, as before. `/areas/[id]/shape` (admin, mapper) replaces the cell picker with
leaflet-geoman: draw polygon/rectangle, edit corners, drag, cut holes, delete; several pieces
become a MultiPolygon. geoman runs in opt-in mode so it never touches background layers or
other areas.

## Interop

`GET /map/areas.geojson` (members only, 401 otherwise): FeatureCollection with `id`, `name`,
`description`, `capacity`, `bookable` and simplestyle `fill`/`stroke` properties.

## Later

1. Rehost the 2026 imagery; OpenAerialMap renders it from a bucket named `…-temp`. (The
   2022–2025 drone photos are post-event "aftermath" shots; not needed for this map.)
2. Offline: a service worker that pre-caches the site's tiles up to z18 (~50 MB).
3. Editable points (so members can move a toilet or add a water point) as a `map_feature`
   table, seeded from `points.geojson`.
4. A neutral, non-event aerial base layer (e.g. Lantmäteriet's open orthophoto).
