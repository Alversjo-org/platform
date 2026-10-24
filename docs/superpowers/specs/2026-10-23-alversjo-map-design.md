# Alversjö map design

## 1. Summary

Builds the "map/grid area picker" explicitly deferred in the events module
design (`2026-10-22-events-module-design.md`, §4: "`area` stays a flat,
admin-managed list for this pass... When a map-based picker is built later,
it needs no migration here: a custom area is just another `area` row"). This
is that work.

What ships:

- A static image of the real Alversjö property map, with a grid overlaid on
  it, stored at a fixed pixel size so all geometry has a stable reference
  frame.
- `area_grid_cell`, a new table linking existing `area` rows to grid cells,
  replacing the unused `mapRef` free-text column.
- `/map`: a page any logged-in member can view, showing the image, the grid,
  and every area that has grid cells assigned, colored and labeled. Clicking
  an area shows its name, description, capacity, bookable flag, and upcoming
  event bookings (sourced from the existing `eventArea` table).
- A grid-cell picker added to the existing member-admin `/areas` page: click
  cells on the map to assign/unassign them to the area being edited.
- Seed data for the eleven sections visible on the source map: A, B, C, C1,
  D, E, F, G, H ("Sunny Hills"), T ("Downtown"), I ("Bison") — as real `area`
  rows with hand-traced starting geometry.

Out of scope for this pass, by earlier agreement in conversation: placing
point objects (toilets, water points, power distribution) on the map;
building a UI for multiple parallel "sectioning schemes" (the data model
permits a grid cell to belong to more than one area — see §3 — but only one
set of areas, the eleven above, is built now); real-world survey accuracy —
this is a flat pixel grid traced by eye against a flattened image, not GIS;
hard-blocking double-booking (unchanged from the events module).

## 2. Map image asset

Correction from an earlier draft of this document: the colored, lettered
annotation (A–G, C1, D, red T/H/I labels, pink/yellow boundary lines) that
was pasted inline into the chat this design came from is **not** part of any
attached file — it only exists as reference pixels I saw in that
conversation. The actual attached file,
`Alversjo_map_large.pdf` (as of this writing at
`/root/.cloudcli/assets/1792683194703-266672905-Alversjo_map_large.pdf`,
not durable — see below), is a single-page, un-annotated aerial photo (QGIS
export, red building outlines only, plus a scale bar and north arrow). This
is actually the better source to use as the displayed map image: the app
draws its own colored, labeled area overlays in §4/§5 anyway, so the base
image should be the clean photo, not one with someone else's hand-drawn
boundaries and labels baked into the pixels.

Source: the PDF's one page, rendered with poppler (`pdftoppm -r 150 -jpeg`)
to a 1755×2482px JPEG — confirmed working in this environment (poppler-utils
installed via apt) and visually verified to show the same lake, farm
buildings, and fields as the reference images from the chat, so the two can
be cross-referenced by landmark when tracing §6's area boundaries. Committed
to `public/map/alversjo.jpg`. If the source PDF is no longer reachable at
the path above when implementation starts, it needs to be re-supplied — nothing
downstream can substitute for it.

Pixel dimensions (1755×2482) are recorded as constants in code
(`src/lib/map/constants.ts`: `MAP_IMAGE_WIDTH`/`MAP_IMAGE_HEIGHT`) so the
grid has one fixed coordinate frame to divide.

All geometry — grid cells now, point objects later — is expressed as a
**fraction of image width/height (0–1)**, not raw pixels, so it survives the
image being displayed at any size and stays meaningful if a higher-res scan
ever replaces this file (re-registering existing data against a *different*
crop or alignment would still require redoing this work — that's inherent to
any image-pinned coordinate system, not something this design avoids).

## 3. Data model

```ts
export const areaGridCell = pgTable('area_grid_cell', {
  areaId: text('area_id').notNull().references(() => area.id, { onDelete: 'cascade' }),
  col: integer('col').notNull(),
  row: integer('row').notNull(),
}, (t) => [primaryKey({ columns: [t.areaId, t.col, t.row] })]);
```

No uniqueness constraint on `(col, row)` across areas — a cell can belong to
more than one area at once. This was a deliberate decision: sections may be
re-drawn or re-grouped differently in the future, and the schema shouldn't
assume exclusivity it can't later relax without a migration.

The grid itself (`GRID_COLS`, `GRID_ROWS`) is a code constant, not a DB
table — there's no per-cell state beyond "which areas include it." Default:
`GRID_COLS = 60`, `GRID_ROWS` computed from the image's aspect ratio so cells
are approximately square (`Math.round(60 * MAP_IMAGE_HEIGHT / MAP_IMAGE_WIDTH)`).
A cell's normalized rectangle is `[col / GRID_COLS, row / GRID_ROWS]` to
`[(col+1) / GRID_COLS, (row+1) / GRID_ROWS]`. These are implementation
constants, tunable without a design change; changing them after cells exist
would invalidate stored `(col, row)` pairs, so in practice they get picked
once during this pass and left alone.

`area.mapRef` (free text, unused by any real data today) is dropped in the
same migration — superseded by `area_grid_cell`. An area with zero grid-cell
rows simply has no presence on `/map` (this is how non-map areas like
"Kitchen" or "Big top" stay representable — they're still bookable `area`
rows, just not drawn anywhere).

Grid-cell editing reuses `requireMemberAdmin` — no new role or permission
table, matching how `/areas` is gated today.

## 4. Map viewer (`/map`)

New route, gated with `requireUser` (any logged-in member — unlike `/areas`,
this is not admin-only, since members need to recognize sections referenced
from events). Linked from `AppShell`'s nav alongside `Boxes`/`Members`.

Rendering: the map image as the background, with an SVG overlay using
`viewBox="0 0 1 1"` so every shape is just placed at its normalized
coordinates — no client-side pixel math needed. Grid lines are drawn at
`1/GRID_COLS` / `1/GRID_ROWS` spacing. Each area with at least one grid cell
is drawn as the union of its cells' rectangles, filled with a color derived
deterministically from its id (hash → hue), with its name centered on the
region (or placed at the first cell if the region is too irregular/small for
a centered label to read).

Clicking/hovering an area shows a panel with its name, description,
capacity, bookable flag, and a short list of upcoming `eventArea` bookings
for that area (event title + date range, linking to the event page) — reusing
the existing area/event-area query pattern from
`src/lib/areas/booking-service.ts`, scoped by `areaId` instead of by event.

Purely read-only. No cell-editing controls here.

## 5. Area editor (extends `/areas`)

The existing member-admin `/areas` page (name/description/capacity/bookable
CRUD, already built) gains a grid-cell picker per area: the same map +
SVG-grid rendering as `/map`, but every cell is clickable and toggles
membership of *that area* (the one being edited) in/out of `area_grid_cell`.
A "Save cells" action replaces that area's full cell set in one write
(delete all `area_grid_cell` rows for the area, insert the new set) rather
than diffing — simpler, and cell counts here are small enough that this
isn't a performance concern.

Creating a brand-new area (for a custom, not-pre-seeded section) uses the
existing "Add area" form exactly as today, then the same picker once the row
exists — consistent with the events design doc's "a custom area is just
another `area` row."

No multi-select/drag-select in this pass — click toggles one cell at a time.
Worth revisiting if tracing turns out painful in practice, but not designed
in now.

## 6. Seed data

Correction from an earlier draft: `renewal_message_setting`'s default row
turns out to be seeded by a lazy upsert in application code, not by a SQL
migration — so there's no actual precedent in this codebase for seed data
living inside a migration. Instead, a standalone idempotent seed script
(`tsx src/db/seed-map-areas.ts`, mirroring `src/db/migrate.ts`'s shape)
inserts eleven `area` rows on demand, skipping any area id that already
exists and only populating an area's cells if it doesn't have any yet — so
re-running it after an admin has edited a section's cells doesn't clobber
their work. It inserts:

| Letter | Name | Notes |
|---|---|---|
| A | A | strip area, "no plowing, grass only" per source map — not modeled as a field, just not carried into description |
| B | B | "no plowing, pastures" per source map |
| C | C | |
| C1 | C1 | small plowed patch between C and D, visually and functionally distinct from C on the source map |
| D | D | |
| E | E | |
| F | F | |
| G | G | |
| H | Sunny Hills | everything west of the road |
| T | Downtown | barn area, buildings, garden |
| I | Bison | east of Downtown — machine hall, wood shed |

All eleven: `bookable = true`, `description = ''`, `capacity = null` —
placeholders, since names/metadata for the plain letters aren't decided yet
("we'll deal with that later," per conversation) and will be filled in
through the `/areas` editor.

Grid cells for each are hand-traced by me against the exported map image —
approximating the colored boundary lines on the source map for A–G/C1/D, and
the verbal descriptions above for H/T/I, which aren't boundary-marked on the
source image the same way. These are explicitly starting drafts, not
survey-accurate, matching "we are going to want to revise these later."

## 7. Testing

Following the existing layout (`.test.ts` beside the module, PGlite for
anything hitting the DB):

- `area_grid_cell` CRUD: replace-cells action overwrites the full set for an
  area without touching other areas' cells; a cell can be assigned to two
  areas at once without conflict.
- Normalized-rect helper: cell `(col, row)` → `[x0, y0, x1, y1]` fraction
  math, including edge cells (`col = GRID_COLS - 1`, etc).
- `/map` page: an area with cells renders with its name; an area with no
  cells (e.g. "Kitchen") doesn't appear on the map but still exists in
  `/areas`.
- Seed migration: all eleven areas exist afterward, each with at least one
  grid cell.

## 8. Migration

Single `drizzle-kit generate`: new `area_grid_cell` table, drop
`area.map_ref` column. Seed data (§6) is applied separately, by running the
seed script once — not part of this schema migration. Existing code
referencing `mapRef` (`src/app/areas/page.tsx`,
`src/app/areas/actions.ts`, `src/lib/areas/service.ts`'s `AreaInput` type,
and their tests) is updated to drop the field as part of this pass.
