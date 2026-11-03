type Node = { text?: unknown; content?: unknown; children?: unknown };

function collect(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const n = node as Node;
  if (typeof n.text === 'string' && n.text) out.push(n.text);
  if (Array.isArray(n.content)) collect(n.content, out);
  else if (n.content && typeof n.content === 'object') {
    // Table blocks: content is { type: 'tableContent', rows: [{ cells: [...] }] }.
    const rows = (n.content as { rows?: { cells?: unknown }[] }).rows;
    if (Array.isArray(rows)) for (const r of rows) collect(r.cells, out);
  }
  if (Array.isArray(n.children)) collect(n.children, out);
}

/** Plain text of a BlockNote document, space-joined, for the search index. */
export function extractPlainText(blocks: unknown): string {
  const out: string[] = [];
  collect(blocks, out);
  return out.join(' ');
}
