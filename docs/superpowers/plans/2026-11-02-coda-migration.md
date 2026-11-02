# Coda Export Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time, re-runnable script that imports the Coda "Alversjö Land Manual" Markdown export (36 pages, images, a wish-list table) into the new wiki and purchase-project tables.

**Architecture:** A small pipeline of pure, independently-testable functions (`parse-export.ts` → `strip-coda-boilerplate.ts` → `build-tree.ts` → `rewrite-links.ts` → `import-images.ts` → `markdown-to-blocks.ts`) composed by one orchestrator (`import-coda-export.ts`), run via a CLI entrypoint. No web UI — this runs once, by an admin, from a terminal.

**Tech Stack:** Node.js (`tsx` for running TypeScript directly), the wiki and purchase-project services from the two plans this depends on, `@blocknote/server-util` (new dependency, for server-side Markdown→blocks conversion — see Task 6's risk note).

**Spec:** `docs/superpowers/specs/2026-11-02-wiki-design.md` §9 (Migration).

**Depends on:** `2026-11-02-wiki-core.md` (`createPage`, `updatePage`, `getPageBySlug`) and `2026-11-02-purchase-wishlist-ui.md` (`createPurchaseProject`). Both must be implemented first. Also reuses `src/lib/images/` from `2026-11-02-task-entity.md`.

## Global Constraints

- The script must be re-runnable without creating duplicates. This requires two small additive schema columns neither earlier plan included (deliberately — neither needed them for anything except this migration): `wikiPage.importSourceFile` (the original `.md` filename, unique, nullable) and `project.importSourceKey` (a synthetic per-row key for wish-list items, unique, nullable).
- `Events.md` and `Calendar.md` are never imported (spec §1 — redundant with the events module).
- `Stuff-Wish-List.md` is never imported as a wiki page — its table rows become `purchase`-kind projects via `createPurchaseProject` (spec §9).
- Every other page, including `Work-Weekends.md`, imports as a normal wiki page, table and all — no page's content is specially parsed into `task` rows (spec §9 — "the task board starts empty").
- The Coda-specific header line (`[Original page](...) · Saved ...`) and trailing `## Image sources` section are stripped from rendered content on import; the original URL is kept as import metadata (`wikiPage.importSourceUrl`, not rendered to readers), not discarded (spec §9).
- Re-running the script against a page that a member has since edited **overwrites their edit** — this is accepted, flagged risk (spec §11.2), not a bug to fix in this plan.

## Review Focus

- A page whose title collides with another page's title after `slugify()` (none exist in the current 36-page export, confirmed by manifest, but the script must not corrupt the link graph if it ever happens) — `uniqueWikiSlug`'s existing collision suffix handles the DB write; link-rewriting uses a separately precomputed filename→slug map and must use that same final, deduped slug, not a naive `slugify(title)` guess.
- A page's images directory contains an image file listed in `manifest.json` but missing on disk, or vice versa — `verification.json` claims zero missing images for this specific export, but the importer must fail loudly (not silently skip) if that's ever not true on a re-run against updated source material.
- Running the script twice in a row must produce the same end state as running it once — zero duplicate pages, zero duplicate wish-list items.
- A Markdown internal link to a page that was dropped (`Events.md`, `Calendar.md`) must not become a broken `/wiki/undefined` link — it should be left as plain text or removed, not silently produce a dangling URL.
- The wish-list table's mostly-empty cells (`What is it for`, `approx. price`, and two trailing blank columns — confirmed from the real `Stuff-Wish-List.md`) must not produce literal `"undefined"`/`"null"` strings in a project's summary.

---

## File Structure

- Modify: `src/db/schema.ts` — add `importSourceFile`, `importSourceUrl` to `wikiPage`; add `importSourceKey` to `project`.
- Create: `drizzle/<timestamp>_import_metadata.sql` — generated.
- Create: `src/lib/wiki/import/parse-export.ts` — `parseExport`.
- Create: `src/lib/wiki/import/parse-export.test.ts`.
- Create: `src/lib/wiki/import/strip-coda-boilerplate.ts` — `stripCodaBoilerplate`.
- Create: `src/lib/wiki/import/strip-coda-boilerplate.test.ts`.
- Create: `src/lib/wiki/import/build-tree.ts` — `buildPageTree`.
- Create: `src/lib/wiki/import/build-tree.test.ts`.
- Create: `src/lib/wiki/import/rewrite-links.ts` — `rewriteInternalLinks`.
- Create: `src/lib/wiki/import/rewrite-links.test.ts`.
- Create: `src/lib/wiki/import/import-images.ts` — `importPageImages`.
- Create: `src/lib/wiki/import/import-images.test.ts`.
- Create: `src/lib/wiki/import/markdown-to-blocks.ts` — `markdownToBlocks`.
- Create: `src/lib/wiki/import/markdown-to-blocks.test.ts`.
- Create: `src/lib/wiki/import/parse-wishlist-table.ts` — `parseWishlistTable`.
- Create: `src/lib/wiki/import/parse-wishlist-table.test.ts`.
- Create: `src/lib/wiki/import/import-coda-export.ts` — `importCodaExport`.
- Create: `src/lib/wiki/import/import-coda-export.test.ts`.
- Create: `src/lib/wiki/import/cli.ts` — CLI entrypoint.
- Modify: `package.json` — add a `wiki:import` script.

## Task 1: Schema

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Produces: `wikiPage.importSourceFile: text (unique, nullable)`, `wikiPage.importSourceUrl: text (nullable)`, `project.importSourceKey: text (unique, nullable)`.

- [ ] **Step 1: Add the columns.** `wikiPage` gains `importSourceFile: text('import_source_file').unique()` and `importSourceUrl: text('import_source_url')`. `project` gains `importSourceKey: text('import_source_key').unique()`.

- [ ] **Step 2: Generate the migration.**

Run: `cd /work/platform && npx drizzle-kit generate`
Expected: a migration altering both tables, adding two nullable unique columns to `wiki_page` and one to `project`.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(wiki): add import-provenance columns for re-runnable migration"
```

## Task 2: Parse the export

**Files:**
- Create: `src/lib/wiki/import/parse-export.ts`
- Test: `src/lib/wiki/import/parse-export.test.ts`

**Interfaces:**
- Produces: `export type ParsedPage = { filename: string; title: string; rawMarkdown: string; imageFilenames: string[] }`; `export async function parseExport(exportDir: string): Promise<ParsedPage[]>` (reads `manifest.json` for the filename/title/images list, reads each listed `.md` file's contents from `exportDir`).

- [ ] **Step 1: Write the failing test**, against a tiny fixture tree built in a temp dir (not the real 36-page export):

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseExport } from './parse-export';

describe('parseExport', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'coda-fixture-'));
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify([
      { title: 'Big Barn', file: 'Big-Barn.md', source: 'https://docs.superhuman.com/d/x/Big-Barn_abc', images: ['Big-Barn-image-01.webp'] },
      { title: 'Buildings', file: 'Buildings.md', source: 'https://docs.superhuman.com/d/x/Buildings_def', images: [] },
    ]));
    await writeFile(path.join(dir, 'Big-Barn.md'), '# Big Barn\n\n[Original page](https://docs.superhuman.com/d/x/Big-Barn_abc) · Saved 2026-10-23\n\nSome content.\n');
    await writeFile(path.join(dir, 'Buildings.md'), '# Buildings\n\n[Original page](https://docs.superhuman.com/d/x/Buildings_def) · Saved 2026-10-23\n\n- [Big Barn](Big-Barn.md)\n');
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('reads every page listed in the manifest, with its raw markdown and image filenames', async () => {
    const pages = await parseExport(dir);
    expect(pages).toHaveLength(2);
    const bigBarn = pages.find((p) => p.filename === 'Big-Barn.md')!;
    expect(bigBarn.title).toBe('Big Barn');
    expect(bigBarn.imageFilenames).toEqual(['Big-Barn-image-01.webp']);
    expect(bigBarn.rawMarkdown).toContain('Some content.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run src/lib/wiki/import/parse-export.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `parseExport`**: read and parse `manifest.json`, then `readFile` each entry's `file` from `exportDir`, mapping manifest fields to `ParsedPage`.

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run src/lib/wiki/import/parse-export.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki/import/parse-export.ts src/lib/wiki/import/parse-export.test.ts
git commit -m "feat(wiki-import): add parseExport"
```

## Task 3: Strip Coda boilerplate

**Files:**
- Create: `src/lib/wiki/import/strip-coda-boilerplate.ts`
- Test: `src/lib/wiki/import/strip-coda-boilerplate.test.ts`

**Interfaces:**
- Produces: `export function stripCodaBoilerplate(markdown: string): { content: string; sourceUrl: string | null }`.

- [ ] **Step 1: Write the failing tests**, using the real header/footer shape (confirmed against the actual export, e.g. `Big-Barn.md`):

```ts
import { describe, expect, it } from 'vitest';
import { stripCodaBoilerplate } from './strip-coda-boilerplate';

describe('stripCodaBoilerplate', () => {
  it('removes the "[Original page]... · Saved ..." header line and extracts its URL', () => {
    const input = '# Big Barn\n\n[Original page](https://docs.superhuman.com/d/x/Big-Barn_abc) · Saved 2026-10-23\n\nSome content.\n';
    const { content, sourceUrl } = stripCodaBoilerplate(input);
    expect(sourceUrl).toBe('https://docs.superhuman.com/d/x/Big-Barn_abc');
    expect(content).not.toContain('Saved 2026-10-23');
    expect(content).toContain('Some content.');
  });

  it('removes the trailing "## Image sources" section', () => {
    const input = '# X\n\nBody text.\n\n## Image sources\n\n- [a.webp](a.webp) — [original image](https://codaio.imgix.net/x)\n';
    const { content } = stripCodaBoilerplate(input);
    expect(content).toContain('Body text.');
    expect(content).not.toContain('Image sources');
    expect(content).not.toContain('codaio.imgix.net');
  });

  it('returns a null sourceUrl, unchanged content, for markdown with no header line', () => {
    const { content, sourceUrl } = stripCodaBoilerplate('# X\n\nJust text.\n');
    expect(sourceUrl).toBeNull();
    expect(content).toContain('Just text.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/wiki/import/strip-coda-boilerplate.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `stripCodaBoilerplate`**: a regex matching the `[Original page](URL) · Saved DATE` line, capturing `URL` and removing the whole line; a second pass removing everything from a `## Image sources` heading (inclusive) to the end of the document, if present.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/wiki/import/strip-coda-boilerplate.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki/import/strip-coda-boilerplate.ts src/lib/wiki/import/strip-coda-boilerplate.test.ts
git commit -m "feat(wiki-import): add stripCodaBoilerplate"
```

## Task 4: Build the page tree

**Files:**
- Create: `src/lib/wiki/import/build-tree.ts`
- Test: `src/lib/wiki/import/build-tree.test.ts`

**Interfaces:**
- Consumes: `ParsedPage` (Task 2).
- Produces: `export type TreePlacement = { filename: string; parentFilename: string | null; position: number }`; `export function buildPageTree(pages: ParsedPage[], rootFilename: string): TreePlacement[]` — walks the root page's leading bullet-list-of-Markdown-links block, recursing into each linked page's own leading bullet-list-of-links block; any page never reached this way gets `parentFilename: null` (top-level), appended after the reached pages.

- [ ] **Step 1: Write the failing tests**

```ts
describe('buildPageTree', () => {
  it('nests a page under the hub page that links to it, in link order', () => {
    const pages: ParsedPage[] = [
      { filename: 'Root.md', title: 'Root', rawMarkdown: '- [Buildings](Buildings.md)\n\n- [FAQ](FAQ.md)\n', imageFilenames: [] },
      { filename: 'Buildings.md', title: 'Buildings', rawMarkdown: '- [Big Barn](Big-Barn.md)\n', imageFilenames: [] },
      { filename: 'Big-Barn.md', title: 'Big Barn', rawMarkdown: 'Some content, no leading link list.\n', imageFilenames: [] },
      { filename: 'FAQ.md', title: 'FAQ', rawMarkdown: 'Some FAQ content.\n', imageFilenames: [] },
    ];
    const placements = buildPageTree(pages, 'Root.md');
    expect(placements).toEqual(expect.arrayContaining([
      { filename: 'Root.md', parentFilename: null, position: 0 },
      { filename: 'Buildings.md', parentFilename: 'Root.md', position: 0 },
      { filename: 'FAQ.md', parentFilename: 'Root.md', position: 1 },
      { filename: 'Big-Barn.md', parentFilename: 'Buildings.md', position: 0 },
    ]));
  });

  it('places a page never reached from the root at the top level', () => {
    const pages: ParsedPage[] = [
      { filename: 'Root.md', title: 'Root', rawMarkdown: '- [FAQ](FAQ.md)\n', imageFilenames: [] },
      { filename: 'FAQ.md', title: 'FAQ', rawMarkdown: 'x', imageFilenames: [] },
      { filename: 'Orphan.md', title: 'Orphan', rawMarkdown: 'x', imageFilenames: [] },
    ];
    const placements = buildPageTree(pages, 'Root.md');
    expect(placements.find((p) => p.filename === 'Orphan.md')).toEqual({ filename: 'Orphan.md', parentFilename: null, position: expect.any(Number) });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/wiki/import/build-tree.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `buildPageTree`**: extract the leading run of `- [Title](Filename.md)` lines from the top of a page's `rawMarkdown` (stop at the first line that isn't one of those, or at the first blank-line gap followed by non-link content — match the real export's shape: a page's nav links appear as the very first blocks, as confirmed in `Buildings.md`/`Alversjo-Land-Manual.md`); BFS from `rootFilename`, assigning `position` by link order within each parent; any `ParsedPage` never visited is appended at the top level in its original manifest order.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/wiki/import/build-tree.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki/import/build-tree.ts src/lib/wiki/import/build-tree.test.ts
git commit -m "feat(wiki-import): add buildPageTree"
```

## Task 5: Rewrite internal links

**Files:**
- Create: `src/lib/wiki/import/rewrite-links.ts`
- Test: `src/lib/wiki/import/rewrite-links.test.ts`

**Interfaces:**
- Produces: `export function rewriteInternalLinks(markdown: string, filenameToSlug: Map<string, string | null>): string` — replaces every `(SomeFile.md)` link target with `(/wiki/<slug>)` using the map; if the map has the filename but its value is `null` (a dropped page, e.g. `Events.md`), the link becomes plain text (the link markup is removed, the link text is kept); filenames not present in the map at all are left untouched (external/unknown links).

- [ ] **Step 1: Write the failing tests**

```ts
describe('rewriteInternalLinks', () => {
  it('rewrites a link to an imported page to its wiki URL', () => {
    const map = new Map([['Big-Barn.md', 'big-barn']]);
    expect(rewriteInternalLinks('See [Big Barn](Big-Barn.md) for details.', map)).toBe('See [Big Barn](/wiki/big-barn) for details.');
  });

  it('flattens a link to a dropped page into plain text', () => {
    const map = new Map<string, string | null>([['Events.md', null]]);
    expect(rewriteInternalLinks('See [Events](Events.md) for the calendar.', map)).toBe('See Events for the calendar.');
  });

  it('leaves external and unmapped links untouched', () => {
    const map = new Map<string, string | null>();
    const input = 'See [external](https://example.org) and [Big Barn](Big-Barn.md).';
    expect(rewriteInternalLinks(input, map)).toBe(input);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/wiki/import/rewrite-links.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `rewriteInternalLinks`**: regex-match `[text](target.md)` link syntax; for each match, if `filenameToSlug.has(target)`, either rewrite to `/wiki/<slug>` or (if the mapped value is `null`) replace the whole link with just `text`.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/wiki/import/rewrite-links.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki/import/rewrite-links.ts src/lib/wiki/import/rewrite-links.test.ts
git commit -m "feat(wiki-import): add rewriteInternalLinks"
```

## Task 6: Import images

**Files:**
- Create: `src/lib/wiki/import/import-images.ts`
- Test: `src/lib/wiki/import/import-images.test.ts`

**Interfaces:**
- Consumes: `ImageStorage`, `prepareImageUpload` from `@/lib/images` (task-entity plan).
- Produces: `export async function importPageImages(input: { exportDir: string; filename: string; imageFilenames: string[]; storage: ImageStorage }): Promise<Map<string, string>>` (reads each image file from `exportDir`, resizes it via `prepareImageUpload`, uploads via `storage.put` under a key like `wiki-import/<filename-without-extension>/<original-image-filename>.webp`, returns a map from original filename to the resulting URL); `export function rewriteImageReferences(markdown: string, imageUrls: Map<string, string>): string` (same substitution idea as Task 5, but for `![alt](Image.webp)` syntax).

- [ ] **Step 1: Write the failing tests**, using `LocalImageStorage` from the task-entity plan against a temp directory, and a tiny real-format image fixture (reuse the `sharp({create:...})` trick from the task-entity plan's own tests):

```ts
it('uploads every referenced image and returns a filename→URL map', async () => {
  const exportDir = /* temp dir with one Big-Barn-image-01.webp written via sharp({create:...}).webp().toBuffer() */;
  const storage = new LocalImageStorage(/* another temp dir */);
  const urls = await importPageImages({ exportDir, filename: 'Big-Barn.md', imageFilenames: ['Big-Barn-image-01.webp'], storage });
  expect(urls.get('Big-Barn-image-01.webp')).toContain('.webp');
});

describe('rewriteImageReferences', () => {
  it('rewrites an image reference to its uploaded URL', () => {
    const urls = new Map([['Big-Barn-image-01.webp', '/images/wiki-import/big-barn/x.webp']]);
    expect(rewriteImageReferences('![photo](Big-Barn-image-01.webp)', urls)).toBe('![photo](/images/wiki-import/big-barn/x.webp)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/lib/wiki/import/import-images.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement both functions**, reusing `prepareImageUpload`/`ImageStorage` exactly as the task-entity and wiki-core plans already defined them — no new storage logic here.

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/lib/wiki/import/import-images.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki/import/import-images.ts src/lib/wiki/import/import-images.test.ts
git commit -m "feat(wiki-import): add importPageImages and rewriteImageReferences"
```

## Task 7: Markdown to BlockNote blocks

**Files:**
- Create: `src/lib/wiki/import/markdown-to-blocks.ts`
- Test: `src/lib/wiki/import/markdown-to-blocks.test.ts`

**Interfaces:**
- Produces: `export async function markdownToBlocks(markdown: string): Promise<unknown[]>` (a BlockNote block array, same shape `createPage`/`updatePage` expect as `content`).

- [ ] **Step 1: Confirm the conversion API before writing any code.** BlockNote's Markdown↔blocks conversion (`tryParseMarkdownToBlocks`) is a method on a live editor instance, which normally needs a DOM. Check whether the installed (or installable) `@blocknote/server-util` package's `ServerBlockNoteEditor` (BlockNote's documented headless/Node-compatible editor, built for exactly this import/export use case) is available for the BlockNote version this repo ends up on (pinned by the wiki-core plan's Task 9). **This is the one real technical risk in this plan** — if it's unavailable or doesn't behave as documented, fall back to a hand-rolled converter covering only the Markdown constructs this specific export actually uses (headings, paragraphs, bullet/numbered lists, bold/italic, links, images, tables — confirmed by reading the real export; no exotic Markdown appears anywhere in it).

- [ ] **Step 2: Write the failing tests**

```ts
describe('markdownToBlocks', () => {
  it('converts a heading and a paragraph into blocks with the right text content', async () => {
    const blocks = await markdownToBlocks('# Big Barn\n\nSome content.\n');
    expect(extractPlainText(blocks)).toContain('Big Barn');
    expect(extractPlainText(blocks)).toContain('Some content.');
  });

  it('converts a bullet list into list-item blocks', async () => {
    const blocks = await markdownToBlocks('- one\n- two\n');
    expect(extractPlainText(blocks)).toContain('one');
    expect(extractPlainText(blocks)).toContain('two');
  });

  it('converts an image reference into an image block', async () => {
    const blocks = await markdownToBlocks('![alt text](/images/x.webp)');
    expect(JSON.stringify(blocks)).toContain('/images/x.webp');
  });
});
```

(Reuses `extractPlainText` from the wiki-core plan as the simplest way to assert on block *content* without pinning the exact block-shape output of whichever conversion approach Step 1 lands on.)

- [ ] **Step 3: Run tests to verify they fail.**

Run: `npx vitest run src/lib/wiki/import/markdown-to-blocks.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Implement `markdownToBlocks`** per whichever approach Step 1 confirmed.

- [ ] **Step 5: Run tests to verify they pass.**

Run: `npx vitest run src/lib/wiki/import/markdown-to-blocks.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/wiki/import/markdown-to-blocks.ts src/lib/wiki/import/markdown-to-blocks.test.ts package.json package-lock.json
git commit -m "feat(wiki-import): add markdownToBlocks"
```

## Task 8: Parse the wish-list table

**Files:**
- Create: `src/lib/wiki/import/parse-wishlist-table.ts`
- Test: `src/lib/wiki/import/parse-wishlist-table.test.ts`

**Interfaces:**
- Produces: `export type WishlistRow = { importSourceKey: string; title: string; summary: string }`; `export function parseWishlistTable(markdown: string): WishlistRow[]` (finds the Markdown table, skips the header/separator rows and any row whose first cell is blank, builds a one-line `summary` from the non-empty "what is it for"/price/note cells, skips the "Things we DONT want" section entirely).

- [ ] **Step 1: Write the failing test**, against the real table shape from `Stuff-Wish-List.md`:

```ts
it('parses each non-empty row into a wishlist item, skipping blank rows and the "DONT want" section', () => {
  const markdown = [
    '| What we need | What is it for | approx. price new |  |  |  |',
    '| --- | --- | --- | --- | --- | --- |',
    '| Long ladder 10m? |  |  |  |  |  |',
    '| Welder + mask + gloves |  |  |  | [link](https://example.org/welder) | There is 2 on site. |',
    '|  |  |  |  |  |  |',
    '',
    '### Things we DONT want',
    '',
    '- More domestic fridges',
  ].join('\n');
  const rows = parseWishlistTable(markdown);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ importSourceKey: 'wishlist-row-1', title: 'Long ladder 10m?', summary: '' });
  expect(rows[1].title).toBe('Welder + mask + gloves');
  expect(rows[1].summary).toContain('There is 2 on site.');
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run src/lib/wiki/import/parse-wishlist-table.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `parseWishlistTable`**: split into lines, find the table block (consecutive `|`-delimited lines), drop the header and `---` separator rows, drop any row whose first cell (trimmed) is empty, stop entirely at the first `###`/`##` heading after the table (so "Things we DONT want" is never reached); join the remaining non-empty cells (columns 2+) with a space for `summary`; number rows by their position among kept rows (`wishlist-row-1`, `wishlist-row-2`, ...).

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run src/lib/wiki/import/parse-wishlist-table.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki/import/parse-wishlist-table.ts src/lib/wiki/import/parse-wishlist-table.test.ts
git commit -m "feat(wiki-import): add parseWishlistTable"
```

## Task 9: Orchestrator and CLI

**Files:**
- Create: `src/lib/wiki/import/import-coda-export.ts`
- Test: `src/lib/wiki/import/import-coda-export.test.ts`
- Create: `src/lib/wiki/import/cli.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: every function from Tasks 2-8; `createPage`, `updatePage`, `getPageBySlug` (wiki-core); `createPurchaseProject` (purchase-wishlist-ui); `ImageStorage` (task-entity).
- Produces: `export type ImportSummary = { pagesCreated: number; pagesUpdated: number; wishlistItemsCreated: number; wishlistItemsSkipped: number }`; `export async function importCodaExport(db: Db, input: { exportDir: string; rootFilename: string; importedByUserId: string; storage: ImageStorage }): Promise<ImportSummary>`.

- [ ] **Step 1: Write the failing integration test**, against a tiny fixture export (4-5 pages including one dropped page and a tiny wish-list table — not the real 36-page export):

```ts
it('imports pages in tree order, skips dropped pages, diverts the wishlist, and is idempotent on a second run', async () => {
  const db = await createDb('pglite://memory');
  await db.insert(schema.user).values({ id: 'admin1', email: 'admin@example.org' });
  const exportDir = /* fixture dir with Root.md (links to Buildings.md, FAQ.md, Events.md, Stuff-Wish-List.md), Buildings.md (links to Big-Barn.md), Big-Barn.md, FAQ.md, Events.md, Stuff-Wish-List.md with 2 rows */;
  const storage = new LocalImageStorage(/* temp dir */);

  const first = await importCodaExport(db, { exportDir, rootFilename: 'Root.md', importedByUserId: 'admin1', storage });
  expect(first.pagesCreated).toBe(4); // Root, Buildings, Big-Barn, FAQ — not Events, not Stuff-Wish-List
  expect(first.wishlistItemsCreated).toBe(2);
  expect(await getPageBySlug(db, 'events')).toBeNull();

  const second = await importCodaExport(db, { exportDir, rootFilename: 'Root.md', importedByUserId: 'admin1', storage });
  expect(second.pagesCreated).toBe(0);
  expect(second.pagesUpdated).toBe(4);
  expect(second.wishlistItemsCreated).toBe(0);
  const allPages = await db.select().from(schema.wikiPage);
  expect(allPages).toHaveLength(4); // no duplicates
  const allWishlistItems = await db.select().from(schema.project).where(eq(schema.project.kind, 'purchase'));
  expect(allWishlistItems).toHaveLength(2); // no duplicates
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run src/lib/wiki/import/import-coda-export.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `importCodaExport`**:
  1. `parseExport`, filter out `Events.md`/`Calendar.md`/`Stuff-Wish-List.md` into a `wishlistFilename` held aside.
  2. `buildPageTree` over the remaining pages from `rootFilename`.
  3. Precompute `filenameToSlug: Map<string, string | null>` — `slugify(title)` for every kept page, `null` for the three dropped/diverted filenames.
  4. Walk the tree breadth-first from the root so parents are always created before children; for each page: `stripCodaBoilerplate` → `importPageImages` + `rewriteImageReferences` → `rewriteInternalLinks` (using `filenameToSlug`) → `markdownToBlocks`; look up an existing row by `importSourceFile`; if found, `updatePage` (reading its current `version` first) and record as updated; if not, `createPage` with the resolved parent's already-created DB id and the tree's `position`, then a follow-up `db.update(wikiPage).set({importSourceFile, importSourceUrl})`, recorded as created.
  5. `parseWishlistTable` on `Stuff-Wish-List.md`'s raw markdown; for each row, check `project.importSourceKey`; if absent, `createPurchaseProject` then `db.update(project).set({importSourceKey})`; if present, skip (counted as skipped, not updated — simpler idempotency for this one small, rarely-re-edited-before-migration-day slice).
  6. Return the tallied `ImportSummary`.

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run src/lib/wiki/import/import-coda-export.test.ts`
Expected: PASS

- [ ] **Step 5: Implement the CLI** `src/lib/wiki/import/cli.ts`: parse `--dir` and `--email` from `process.argv`, look up the user by email (fail with a clear message if not found), call `importCodaExport` with `getImageStorage()` as the storage, print the returned `ImportSummary`, exit.

- [ ] **Step 6: Add `"wiki:import": "tsx src/lib/wiki/import/cli.ts"` to `package.json` scripts.**

- [ ] **Step 7: Run the full test suite once more to confirm nothing else broke.**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 8: Commit**

```bash
git add src/lib/wiki/import/import-coda-export.ts src/lib/wiki/import/import-coda-export.test.ts src/lib/wiki/import/cli.ts package.json
git commit -m "feat(wiki-import): add importCodaExport orchestrator and CLI"
```

---

## Self-Review

**Spec coverage**: every bullet of spec §9 has a task — tree construction (Task 4), dropped pages (Task 9 Step 3.1), diverted wishlist (Task 8, Task 9 Step 3.5), content cleanup (Task 3), conversion (Task 7), link/image rewriting (Tasks 5-6), idempotency (Task 9's integration test, run-twice assertion).

**Step scan**: Task 7 Step 1 is the one place a real unresolved technical risk (BlockNote's server-side Markdown API) is flagged explicitly rather than assumed — everything downstream of it (the test in Step 2) is written against behavior, not against a specific unverified API, so it stays valid whichever path Step 1 lands on.

**Type consistency**: `ParsedPage`, `TreePlacement`, `WishlistRow`, `ImportSummary` are each defined once (Tasks 2/4/8/9) and used with the same shape everywhere they're consumed.

**Review Focus**: title-collision-safety (noted in Task 9 Step 3.3's precomputed map, not separately tested since no collision exists in the real data — would need a dedicated test only if the real export changes); missing-image-fails-loudly (**gap found during self-review**: Task 6 doesn't test the missing-file case — added below); double-run-no-duplicates (Task 9's integration test); dropped-page-link-flattening (Task 5 test 2); wishlist blank-cell handling (Task 8 test, `summary: ''` for the ladder row).

**Fix applied**: Task 6 Step 1's test list is missing a case. Add to Task 6 Step 1: `it('throws clearly if a manifest-listed image file is missing from disk', async () => { await expect(importPageImages({ exportDir, filename: 'X.md', imageFilenames: ['missing.webp'], storage })).rejects.toThrow(); });` — this is a one-line addition to Task 6's existing test block, not a new task.

**Proportion**: nine small, single-purpose files mirror the pipeline described in spec §9's prose almost one function per sentence — proportionate, not a transcript.
