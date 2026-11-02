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
- the old property map image (off by default).

`/map` (any member) draws each mapped area with its name; clicking shows details and upcoming
bookings, as before. `/areas/[id]/shape` (admin, mapper) replaces the cell picker with
leaflet-geoman: draw polygon/rectangle, edit corners, drag, cut holes, delete; several pieces
become a MultiPolygon. geoman runs in opt-in mode so it never touches background layers or
other areas.

## Interop

`GET /map/areas.geojson` (members only, 401 otherwise): FeatureCollection with `id`, `name`,
`description`, `capacity`, `bookable` and simplestyle `fill`/`stroke` properties.

## Later

1. Earlier drone years (2022–2025, ~430 MB of tiles) as one PMTiles file per year on Cloudflare
   R2, with a year switcher. They currently live only in the Borderland repo, which has no
   licence: ask before copying.
2. Rehost the 2026 imagery too; OpenAerialMap renders it from a bucket named `…-temp`.
3. Offline: a service worker that pre-caches the site's tiles up to z18 (~50 MB per year).
4. Point features (toilets, water, power) as a `map_feature` table.
5. Borderland's property border and buildings as layers, with their permission.
