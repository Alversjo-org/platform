# Alversjö map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every logged-in member a `/map` page showing the real Alversjö
property photo with a grid overlay and the eleven named bookable areas
(sections) drawn on it, and give member-admins a way to assign/reassign
which grid cells belong to which area — replacing the unused `area.mapRef`
text field with real geometry.

**Architecture:** A static aerial-photo JPEG (rendered once from the source
PDF) is the map's coordinate frame. A fixed-size grid (60×85 cells) divides
it; a new `area_grid_cell` join table (no uniqueness constraint — a cell may
belong to more than one area) links existing `area` rows to cells. All
geometry is normalized (0–1 fraction of image width/height), rendered with
an SVG `viewBox="0 0 1 1"` overlay so no client-side pixel math is needed.
`/map` (any member) is read-only; a new `/areas/[id]/cells` page (reusing
the existing member-admin gate from `/areas`) is the editor.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (Postgres/PGlite),
Vitest, Tailwind. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-alversjo-map-design.md`

## Global Constraints

- All stored/rendered geometry is normalized to 0–1 (fraction of image
  width/height), never raw pixels (spec §2).
- No uniqueness constraint on `area_grid_cell(col, row)` across areas — a
  cell may belong to more than one area at once (spec §3).
- Grid is a fixed code constant, not a DB table: `GRID_COLS = 60`,
  `GRID_ROWS = 85`, derived from the committed image's 1755×2482px size
  (spec §2–3).
- `/map` is gated with `requireUser` (any logged-in member). The cell editor
  (`/areas`, `/areas/[id]/cells`) is gated with `requireMemberAdmin`, same as
  today's `/areas` (spec §4–5).
- `area.mapRef` is removed (superseded by `area_grid_cell`); an area with no
  grid cells simply has no presence on `/map` (spec §3).
- Out of scope: point objects on the map, a UI for multiple parallel
  grouping schemes, survey-accurate geometry, hard double-booking blocks
  (spec §1).

## Review Focus

- An area with zero grid cells must not appear on `/map` — a reasonable
  admin expects an area they haven't drawn yet to simply be invisible, not
  show as an empty/broken region. → Task 6.
- Deleting an area must cascade-delete its `area_grid_cell` rows — a
  reasonable admin expects no orphaned cell rows left referencing a deleted
  area. → Task 4.
- A grid cell assigned to one area must stay assigned when a *different*
  area also claims it — overlap is an explicit design decision (spec §3),
  not an edge case to silently break. → Task 4.
- The grid's last column/row must produce a cell rect that stays within
  [0, 1] — an off-by-one here would clip or overflow the final row/column of
  the image. → Task 3.
- An event-area booking whose `to` has already passed must not show as
  "upcoming" on `/map` — a reasonable member expects the map's bookings list
  to mean "coming up," not "ever happened." → Task 4.

---

## Task 1: Schema — `area_grid_cell`, drop `area.mapRef`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/app/areas/page.tsx` (remove Map ref column/input)
- Modify: `src/app/areas/actions.ts` (remove `mapRef` parsing)
- Modify: `src/lib/areas/service.ts` (remove `mapRef` from `AreaInput`)
- Modify: `src/lib/areas/service.test.ts` (remove `mapRef` from fixtures)
- Create: `drizzle/<generated>.sql` (via `db:generate`, not hand-authored)

**Interfaces:**
- Produces: `schema.areaGridCell` (`areaId: string`, `col: number`,
  `row: number`, composite PK `(areaId, col, row)`, `areaId` references
  `area.id` with `onDelete: 'cascade'`); `type AreaGridCell`. `area` loses
  its `mapRef` column; `AreaInput` (in `src/lib/areas/service.ts`) loses
  `mapRef`.

- [ ] **Step 1: Add `areaGridCell` to the schema and drop `area.mapRef`**

In `src/db/schema.ts`, remove the `mapRef: text('map_ref'),` line from
`area`, and add:

```ts
export const areaGridCell = pgTable('area_grid_cell', {
  areaId: text('area_id').notNull().references(() => area.id, { onDelete: 'cascade' }),
  col: integer('col').notNull(),
  row: integer('row').notNull(),
}, (t) => [primaryKey({ columns: [t.areaId, t.col, t.row] })]);

export type AreaGridCell = typeof areaGridCell.$inferSelect;
```

- [ ] **Step 2: Remove `mapRef` from application code**

Remove the `mapRef` field from `AreaInput` in `src/lib/areas/service.ts`;
remove the `mapRef`/`Map ref` column, input, and parsing from
`src/app/areas/page.tsx` and `src/app/areas/actions.ts`; remove `mapRef:
null` from every fixture in `src/lib/areas/service.test.ts`.

- [ ] **Step 3: Generate and inspect the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` containing
`CREATE TABLE "area_grid_cell"` and `ALTER TABLE "area" DROP COLUMN
"map_ref"`.

- [ ] **Step 4: Run the full test suite and the migration-drift check**

Run: `npm test && npm run db:check`
Expected: all tests pass (PGlite applies the new migration fresh in every
test's `beforeEach`); `db:check` exits clean (generated SQL matches
`schema.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/ src/app/areas/ src/lib/areas/
git commit -m "feat: add area_grid_cell table, drop unused area.mapRef"
```

---

## Task 2: Map image asset

**Files:**
- Create: `public/map/alversjo.jpg`
- Create: `src/lib/map/constants.ts`
- Test: `src/lib/map/constants.test.ts`

**Interfaces:**
- Produces: `MAP_IMAGE_SRC = '/map/alversjo.jpg'`, `MAP_IMAGE_WIDTH = 1755`,
  `MAP_IMAGE_HEIGHT = 2482`, `GRID_COLS = 60`, `GRID_ROWS = 85` (all
  `number`/`string` constants in `src/lib/map/constants.ts`).

- [ ] **Step 1: Render the source PDF to a JPEG**

Source PDF: `/root/.cloudcli/assets/1792683194703-266672905-Alversjo_map_large.pdf`
(if unreachable, the PDF must be re-supplied — see spec §2). `poppler-utils`
must be installed (`apt-get update && apt-get install -y poppler-utils` if
`pdftoppm` is not already on PATH).

Run: `pdftoppm -r 150 -jpeg /root/.cloudcli/assets/1792683194703-266672905-Alversjo_map_large.pdf /tmp/alversjo-map && mv /tmp/alversjo-map-1.jpg public/map/alversjo.jpg`
Expected: `public/map/alversjo.jpg` exists, 1755×2482px (verify with
`node -e "require('sharp')('public/map/alversjo.jpg').metadata().then(m=>console.log(m.width,m.height))"`).

- [ ] **Step 2: Write `src/lib/map/constants.ts`**

```ts
export const MAP_IMAGE_SRC = '/map/alversjo.jpg';
export const MAP_IMAGE_WIDTH = 1755;
export const MAP_IMAGE_HEIGHT = 2482;
export const GRID_COLS = 60;
export const GRID_ROWS = 85;
```

- [ ] **Step 3: Write the failing asset-dimension test**

```ts
import sharp from 'sharp';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_IMAGE_HEIGHT, MAP_IMAGE_WIDTH } from './constants';

describe('map image asset', () => {
  it('matches the dimensions recorded in constants.ts', async () => {
    const meta = await sharp(path.join(process.cwd(), 'public/map/alversjo.jpg')).metadata();
    expect(meta.width).toBe(MAP_IMAGE_WIDTH);
    expect(meta.height).toBe(MAP_IMAGE_HEIGHT);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/map/constants.test.ts`
Expected: PASS (this guards against someone swapping the image file without
updating the constants it's measured against).

- [ ] **Step 5: Commit**

```bash
git add public/map/alversjo.jpg src/lib/map/constants.ts src/lib/map/constants.test.ts
git commit -m "feat: add Alversjö map image asset and grid constants"
```

---

## Task 3: Grid, polygon, and color helpers

**Files:**
- Create: `src/lib/map/grid.ts`
- Test: `src/lib/map/grid.test.ts`
- Create: `src/lib/map/polygon.ts`
- Test: `src/lib/map/polygon.test.ts`
- Create: `src/lib/map/area-color.ts`
- Test: `src/lib/map/area-color.test.ts`

**Interfaces:**
- Consumes: `GRID_COLS`, `GRID_ROWS` from `src/lib/map/constants.ts` (Task 2).
- Produces: `cellRect(col: number, row: number): { x0: number; y0: number;
  x1: number; y1: number }`; `cellsInPolygon(polygon: Array<[number,
  number]>, cols: number, rows: number): Array<{ col: number; row: number
  }>`; `areaColor(id: string): string`.

- [ ] **Step 1: Write failing tests for `cellRect`**

```ts
import { describe, expect, it } from 'vitest';
import { cellRect } from './grid';
import { GRID_COLS, GRID_ROWS } from './constants';

describe('cellRect', () => {
  it('returns the top-left cell flush with the image origin', () => {
    expect(cellRect(0, 0)).toEqual({ x0: 0, y0: 0, x1: 1 / GRID_COLS, y1: 1 / GRID_ROWS });
  });
  it('returns the bottom-right cell flush with the image edge, not overflowing past 1', () => {
    const r = cellRect(GRID_COLS - 1, GRID_ROWS - 1);
    expect(r.x1).toBeCloseTo(1, 10);
    expect(r.y1).toBeCloseTo(1, 10);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `cellRect` in `src/lib/map/grid.ts`**

`cellRect(col, row)` returns `{ x0: col / GRID_COLS, y0: row / GRID_ROWS,
x1: (col + 1) / GRID_COLS, y1: (row + 1) / GRID_ROWS }`.

Run: `npx vitest run src/lib/map/grid.test.ts` — expect PASS.

- [ ] **Step 3: Write failing tests for `cellsInPolygon`**

```ts
import { describe, expect, it } from 'vitest';
import { cellsInPolygon } from './polygon';

describe('cellsInPolygon', () => {
  it('returns the left half of a 4x4 grid for a square covering x in [0, 0.5]', () => {
    const cells = cellsInPolygon([[0, 0], [0.5, 0], [0.5, 1], [0, 1]], 4, 4);
    const keys = cells.map((c) => `${c.col},${c.row}`).sort();
    expect(keys).toEqual(['0,0', '0,1', '0,2', '0,3', '1,0', '1,1', '1,2', '1,3'].sort());
  });
  it('returns no cells for a degenerate zero-area polygon', () => {
    expect(cellsInPolygon([[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]], 4, 4)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `cellsInPolygon` in `src/lib/map/polygon.ts`**

For each `(col, row)` in the `cols`×`rows` grid, test the cell's center
point `((col + 0.5) / cols, (row + 0.5) / rows)` against `polygon` with a
standard ray-casting point-in-polygon test; include the cell if its center
is inside.

Run: `npx vitest run src/lib/map/polygon.test.ts` — expect PASS.

- [ ] **Step 5: Write failing tests for `areaColor`**

```ts
import { describe, expect, it } from 'vitest';
import { areaColor } from './area-color';

describe('areaColor', () => {
  it('is deterministic for the same id', () => {
    expect(areaColor('area-a')).toBe(areaColor('area-a'));
  });
  it('differs between two different ids', () => {
    expect(areaColor('area-a')).not.toBe(areaColor('area-b'));
  });
  it('returns an hsl() string', () => {
    expect(areaColor('area-a')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });
});
```

- [ ] **Step 6: Run to verify failure, then implement `areaColor` in `src/lib/map/area-color.ts`**

Hash `id` to a number (e.g. sum of char codes, or a small string hash),
take it mod 360 for hue, and return a fixed-saturation/lightness
`hsl(hue, 65%, 55%)` string.

Run: `npx vitest run src/lib/map/area-color.test.ts` — expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/map/grid.ts src/lib/map/grid.test.ts src/lib/map/polygon.ts src/lib/map/polygon.test.ts src/lib/map/area-color.ts src/lib/map/area-color.test.ts
git commit -m "feat: add map grid, polygon, and area-color helpers"
```

---

## Task 4: Area map data services

**Files:**
- Create: `src/lib/map/area-cells.ts`
- Test: `src/lib/map/area-cells.test.ts`
- Modify: `src/lib/areas/booking-service.ts`
- Modify: `src/lib/areas/booking-service.test.ts`
- Modify: `src/lib/areas/service.ts`
- Modify: `src/lib/areas/service.test.ts`

**Interfaces:**
- Consumes: `schema.area`, `schema.areaGridCell`, `type Db`, `type Area`
  from `@/db`/`@/db/schema` (Task 1).
- Produces: `listAreaCells(db: Db, areaId: string): Promise<Array<{ col:
  number; row: number }>>`; `listAreasWithCells(db: Db): Promise<Array<{
  area: Area; cells: Array<{ col: number; row: number }> }>>`;
  `replaceAreaCells(db: Db, areaId: string, cells: Array<{ col: number; row:
  number }>): Promise<void>`; `listUpcomingAreaBookings(db: Db, now: Date):
  Promise<Array<{ areaId: string; eventProjectId: string; eventSlug:
  string; eventTitle: string; from: Date; to: Date }>>`; `getArea(db: Db,
  id: string): Promise<Area | null>`.

- [ ] **Step 1: Write failing tests for `area-cells.ts`**

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { listAreaCells, listAreasWithCells, replaceAreaCells } from './area-cells';

describe('area-cells', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.area).values([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  });

  it('replaceAreaCells fully overwrites a prior set', async () => {
    await replaceAreaCells(db, 'a', [{ col: 0, row: 0 }, { col: 1, row: 0 }]);
    await replaceAreaCells(db, 'a', [{ col: 2, row: 2 }]);
    expect(await listAreaCells(db, 'a')).toEqual([{ col: 2, row: 2 }]);
  });

  it('a cell can belong to two different areas at once', async () => {
    await replaceAreaCells(db, 'a', [{ col: 5, row: 5 }]);
    await replaceAreaCells(db, 'b', [{ col: 5, row: 5 }]);
    expect(await listAreaCells(db, 'a')).toEqual([{ col: 5, row: 5 }]);
    expect(await listAreaCells(db, 'b')).toEqual([{ col: 5, row: 5 }]);
  });

  it('deleting an area cascades to remove its cells', async () => {
    await replaceAreaCells(db, 'a', [{ col: 0, row: 0 }]);
    await db.delete(schema.area).where(eq(schema.area.id, 'a'));
    expect(await listAreaCells(db, 'a')).toEqual([]);
  });

  it('listAreasWithCells returns every area, pairing empty-celled ones with []', async () => {
    await replaceAreaCells(db, 'a', [{ col: 0, row: 0 }]);
    const result = await listAreasWithCells(db);
    expect(result.find((r) => r.area.id === 'a')?.cells).toEqual([{ col: 0, row: 0 }]);
    expect(result.find((r) => r.area.id === 'b')?.cells).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `src/lib/map/area-cells.ts`**

`listAreaCells` selects `col, row` from `areaGridCell` where `areaId`
matches. `replaceAreaCells` runs in `db.transaction`: delete all
`areaGridCell` rows for `areaId`, then (if `cells.length`) bulk-insert the
new set. `listAreasWithCells` selects all areas (reuse `listAreas` from
`@/lib/areas/service`) and all `areaGridCell` rows, groups cells by
`areaId` in memory, and pairs each area with its cells (`[]` if none).

Run: `npx vitest run src/lib/map/area-cells.test.ts` — expect PASS.

- [ ] **Step 3: Write failing tests for `listUpcomingAreaBookings`**

Add to `src/lib/areas/booking-service.test.ts`, inside a new `describe`
block reusing the file's existing `beforeEach` fixtures (`kitchen` area,
`e1`/`e2` projects):

```ts
describe('listUpcomingAreaBookings', () => {
  it('includes a booking that has not ended yet, excludes one that already has', async () => {
    await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T09:00:00Z'), setupNote: null });
    await bookEventArea(db, { eventProjectId: 'e2', areaId: 'kitchen', from: new Date('2020-01-01T08:00:00Z'), to: new Date('2020-01-01T09:00:00Z'), setupNote: null });
    const upcoming = await listUpcomingAreaBookings(db, new Date('2027-01-01T00:00:00Z'));
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ areaId: 'kitchen', eventProjectId: 'e1' });
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `listUpcomingAreaBookings` in `src/lib/areas/booking-service.ts`**

Select `eventArea` joined to `project` (for `eventTitle`/`eventSlug`) where
`eventArea.to > now`, ordered by `eventArea.from` ascending — mirror the
join style already used in `bookEventArea`'s overlap query in this file.

Run: `npx vitest run src/lib/areas/booking-service.test.ts` — expect PASS.

- [ ] **Step 5: Write a failing test for `getArea`, then implement it**

Add to `src/lib/areas/service.test.ts`:

```ts
it('getArea returns the matching row, or null if unknown', async () => {
  const created = await createArea(db, { name: 'Kitchen', description: '', capacity: null, bookable: true });
  expect((await getArea(db, created.id))?.id).toBe(created.id);
  expect(await getArea(db, 'nope')).toBeNull();
});
```

In `src/lib/areas/service.ts`, add `getArea(db: Db, id: string):
Promise<Area | null>` — select by id, return the row or `null`.

Run: `npx vitest run src/lib/areas/service.test.ts` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/map/area-cells.ts src/lib/map/area-cells.test.ts src/lib/areas/booking-service.ts src/lib/areas/booking-service.test.ts src/lib/areas/service.ts src/lib/areas/service.test.ts
git commit -m "feat: add area-cells, upcoming-bookings, and getArea data access"
```

---

## Task 5: Seed data for the eleven sections

**Files:**
- Create: `src/lib/map/seed-data.ts`
- Create: `src/lib/map/seed.ts`
- Test: `src/lib/map/seed.test.ts`
- Create: `src/db/seed-map-areas.ts`
- Modify: `package.json` (add `db:seed-map-areas` script)

**Interfaces:**
- Consumes: `cellsInPolygon`, `GRID_COLS`, `GRID_ROWS` (Task 3),
  `listAreaCells`/`replaceAreaCells` (Task 4), `createDb` (`@/db`).
- Produces: `SEED_AREAS: Array<{ id: string; name: string; polygon:
  Array<[number, number]> }>`; `seedMapAreas(db: Db): Promise<void>`.

- [ ] **Step 1: Determine each section's polygon**

View `public/map/alversjo.jpg` and cross-reference it against the lettered
reference map and verbal descriptions in
`docs/superpowers/specs/2026-10-23-alversjo-map-design.md` §6 (H = west of
the road, T = barn/buildings/garden, I/Bison = east of Downtown with the
machine hall and wood shed). For each of A, B, C, C1, D, E, F, G, H, T, I,
estimate a polygon as a list of `[x, y]` vertices in normalized (0–1)
image-fraction coordinates. Write these into `src/lib/map/seed-data.ts` as:

```ts
export const SEED_AREAS: Array<{ id: string; name: string; polygon: Array<[number, number]> }> = [
  { id: 'section-a', name: 'A', polygon: [/* ... */] },
  // ... one entry per section, 11 total, ids 'section-a' .. 'section-g', 'section-c1', 'section-d', 'section-h', 'section-t', 'section-i'
];
```

- [ ] **Step 2: Write failing tests for `seedMapAreas`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db';
import { listAreaCells } from './area-cells';
import { replaceAreaCells } from './area-cells';
import { SEED_AREAS } from './seed-data';
import { seedMapAreas } from './seed';

describe('seedMapAreas', () => {
  let db: Db;
  beforeEach(async () => { db = await createDb('pglite://memory'); });

  it('creates all eleven areas, each with at least one cell', async () => {
    await seedMapAreas(db);
    for (const entry of SEED_AREAS) {
      expect(await listAreaCells(db, entry.id)).not.toEqual([]);
    }
  });

  it('is idempotent: re-running does not duplicate areas or clobber cells someone else already changed', async () => {
    await seedMapAreas(db);
    const customCells = [{ col: 0, row: 0 }];
    await replaceAreaCells(db, SEED_AREAS[0].id, customCells);
    await seedMapAreas(db);
    expect(await listAreaCells(db, SEED_AREAS[0].id)).toEqual(customCells);
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement `seedMapAreas` in `src/lib/map/seed.ts`**

For each entry in `SEED_AREAS`: insert an `area` row (`id`, `name`,
`description: ''`, `capacity: null`, `bookable: true`) with
`.onConflictDoNothing()`; then, only if `(await listAreaCells(db,
entry.id)).length === 0`, call `replaceAreaCells(db, entry.id,
cellsInPolygon(entry.polygon, GRID_COLS, GRID_ROWS))`.

Run: `npx vitest run src/lib/map/seed.test.ts` — expect PASS.

- [ ] **Step 4: Add the seed script entry point**

`src/db/seed-map-areas.ts`, mirroring `src/db/migrate.ts`'s structure:

```ts
import { createDb } from './index';
import { seedMapAreas } from '@/lib/map/seed';

createDb()
  .then(async (db) => { await seedMapAreas(db); console.log('map areas seeded'); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
```

Add to `package.json` `scripts`: `"db:seed-map-areas": "tsx src/db/seed-map-areas.ts"`.

- [ ] **Step 5: Run the seed script against the local dev database**

Run: `npm run db:seed-map-areas`
Expected: prints `map areas seeded`, exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/map/seed-data.ts src/lib/map/seed.ts src/lib/map/seed.test.ts src/db/seed-map-areas.ts package.json
git commit -m "feat: seed the eleven Alversjö map sections"
```

---

## Task 6: `/map` viewer page

**Files:**
- Create: `src/lib/map/view-model.ts`
- Test: `src/lib/map/view-model.test.ts`
- Create: `src/components/map/map-view.tsx`
- Create: `src/app/map/page.tsx`
- Modify: `src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `listAreasWithCells`, `listUpcomingAreaBookings` (Task 4),
  `areaColor` (Task 3), `cellRect` (Task 3), `MAP_IMAGE_SRC`, `GRID_COLS`,
  `GRID_ROWS` (Task 2), `requireUser` (`@/lib/session`), `AppShell`
  (`@/components/app-shell`).
- Produces: `type MapAreaData = { id: string; name: string; description:
  string; capacity: number | null; bookable: boolean; color: string; cells:
  Array<{ col: number; row: number }>; bookings: Array<{ eventTitle:
  string; eventSlug: string; from: string; to: string }> }`;
  `buildMapAreaData(areasWithCells: Array<{ area: Area; cells: Array<{ col:
  number; row: number }> }>, bookings: Array<{ areaId: string; eventSlug:
  string; eventTitle: string; from: Date; to: Date }>): MapAreaData[]`;
  `MapView({ areas: MapAreaData[] })` (React component).

- [ ] **Step 1: Write failing tests for `buildMapAreaData`**

```ts
import { describe, expect, it } from 'vitest';
import type { Area } from '@/db/schema';
import { buildMapAreaData } from './view-model';

const area = (id: string, over: Partial<Area> = {}): Area =>
  ({ id, name: id, description: '', capacity: null, bookable: true, ...over }) as Area;

describe('buildMapAreaData', () => {
  it('excludes an area with zero grid cells', () => {
    const result = buildMapAreaData([{ area: area('empty'), cells: [] }], []);
    expect(result).toEqual([]);
  });

  it('includes an area with cells, attaching its formatted upcoming bookings', () => {
    const result = buildMapAreaData(
      [{ area: area('f'), cells: [{ col: 1, row: 1 }] }],
      [{ areaId: 'f', eventSlug: 'harvest', eventTitle: 'Harvest', from: new Date('2027-09-01T10:00:00Z'), to: new Date('2027-09-01T12:00:00Z') }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'f', bookings: [{ eventTitle: 'Harvest', eventSlug: 'harvest', from: '2027-09-01', to: '2027-09-01' }] });
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `buildMapAreaData` in `src/lib/map/view-model.ts`**

Filter `areasWithCells` to entries where `cells.length > 0`. For each, group
`bookings` by `areaId`, format `from`/`to` with `.toISOString().slice(0,
10)` (matching the existing date-formatting convention in this codebase,
e.g. `src/app/members/page.tsx`), and set `color: areaColor(area.id)`.

Run: `npx vitest run src/lib/map/view-model.test.ts` — expect PASS.

- [ ] **Step 3: Implement `MapView` in `src/components/map/map-view.tsx`**

`'use client'`. Renders `<img src={MAP_IMAGE_SRC} />` with an absolutely
positioned `<svg viewBox="0 0 1 1" preserveAspectRatio="none">` overlay on
top. Grid lines: one `<pattern>` tiled at `1/GRID_COLS` × `1/GRID_ROWS`,
applied as the fill of a single full-size `<rect>`. Each area in `areas`
renders as a `<g onClick={() => setSelected(area.id)}>` containing one
`<rect>` per cell (from `cellRect`), filled with `area.color` at partial
opacity; the area's name is drawn as a single `<text>` at the average
(centroid) of its cells' rect centers. Track `selected: string | null` in
state; when set, render a details panel below the map showing that area's
name/description/capacity/bookable flag and its `bookings` list (event
title + `from`–`to`, linking to `/events/${eventSlug}`).

- [ ] **Step 4: Implement `src/app/map/page.tsx`**

`requireUser()`, then `buildMapAreaData(await listAreasWithCells(db), await
listUpcomingAreaBookings(db, new Date()))`, rendered inside
`<AppShell user={user}><MapView areas={...} /></AppShell>`. `export const
dynamic = 'force-dynamic'`, matching every other page in this app.

- [ ] **Step 5: Add the nav link**

In `src/components/app-shell.tsx`, add `<Link href="/map"
className="text-sm text-muted-foreground hover:text-foreground">Map</Link>`
to the `<nav>`, visible to everyone (not admin-gated), alongside the
existing `Boxes` link.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, log in, visit `/map`.
Expected: the eleven seeded sections render over the map image at roughly
plausible positions/shapes; clicking one shows its name and details panel.

- [ ] **Step 7: Commit**

```bash
git add src/lib/map/view-model.ts src/lib/map/view-model.test.ts src/components/map/map-view.tsx src/app/map/page.tsx src/components/app-shell.tsx
git commit -m "feat: add /map viewer page"
```

---

## Task 7: Area cell editor (`/areas/[id]/cells`)

**Files:**
- Create: `src/components/map/cell-picker.tsx`
- Create: `src/app/areas/[id]/cells/actions.ts`
- Create: `src/app/areas/[id]/cells/page.tsx`
- Modify: `src/app/areas/page.tsx`

**Interfaces:**
- Consumes: `getArea`, `listAreaCells`, `replaceAreaCells` (Task 4),
  `cellRect`, `GRID_COLS`, `GRID_ROWS`, `MAP_IMAGE_SRC` (Task 2–3),
  `requireMemberAdmin` (`@/lib/session`).
- Produces: `CellPicker({ areaId: string; initialCells: Array<{ col:
  number; row: number }> })` (React component);
  `replaceAreaCellsAction(areaId: string, cells: Array<{ col: number; row:
  number }>): Promise<void>` (server action).

- [ ] **Step 1: Implement `replaceAreaCellsAction` in `src/app/areas/[id]/cells/actions.ts`**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { replaceAreaCells } from '@/lib/map/area-cells';
import { requireMemberAdmin } from '@/lib/session';

export async function replaceAreaCellsAction(areaId: string, cells: Array<{ col: number; row: number }>): Promise<void> {
  await requireMemberAdmin();
  await replaceAreaCells(await getDb(), areaId, cells);
  revalidatePath('/map');
  revalidatePath(`/areas/${areaId}/cells`);
}
```

- [ ] **Step 2: Implement `CellPicker` in `src/components/map/cell-picker.tsx`**

`'use client'`. Same image + SVG `viewBox="0 0 1 1"` grid-line rendering as
`MapView` (Task 6), but: tracks `selected: Set<string>` (keys `"col,row"`)
in state, initialized from `initialCells`; a single full-size transparent
`<rect>` with an `onClick` handler computes `col`/`row` from the click's
position relative to the element's bounding box
(`e.clientX/Y` minus `getBoundingClientRect()`, divided by cell size) and
toggles that key in `selected`; renders one highlighted `<rect>` (via
`cellRect`) per selected cell; a "Save" button calls
`replaceAreaCellsAction(areaId, [...selected].map(parse back to {col,row}))`
and shows a brief "Saved" confirmation in local state on success.

- [ ] **Step 3: Implement `src/app/areas/[id]/cells/page.tsx`**

```tsx
export default async function AreaCellsPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireMemberAdmin();
  const { id } = await params;
  const db = await getDb();
  const area = await getArea(db, id);
  if (!area) notFound();
  const cells = await listAreaCells(db, id);
  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Edit cells: {area.name}</h1>
      <CellPicker areaId={id} initialCells={cells} />
    </AppShell>
  );
}
export const dynamic = 'force-dynamic';
```

- [ ] **Step 4: Link to the editor from `/areas`**

In `src/app/areas/page.tsx`, add `<Link href={\`/areas/${a.id}/cells\`}
className="text-sm underline">Edit cells on map</Link>` to each row's
action cell, alongside the existing "Edit" `<details>`.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. As a member-admin: visit `/areas`, open "Edit cells on
map" for section F, toggle a cell, save, then visit `/map` and confirm the
change is reflected. As a plain member: visit `/areas/<id>/cells` directly
and confirm it redirects to `/` (same gate as `/areas` itself).

- [ ] **Step 6: Commit**

```bash
git add src/components/map/cell-picker.tsx src/app/areas/
git commit -m "feat: add grid-cell editor for areas"
```
