import type { WikiPageTreeNode } from '@/lib/wiki/page-service';

function flatten(nodes: WikiPageTreeNode[], depth = 0, out: { id: string; label: string }[] = []) {
  for (const n of nodes) {
    out.push({ id: n.id, label: `${'— '.repeat(depth)}${n.title}` });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

/** `<select name=…>` of every page, indented by depth. `excludeId` hides a page (and so nothing offers itself as its own parent). */
export function ParentSelect({ tree, name = 'parentId', value = '', excludeId }: { tree: WikiPageTreeNode[]; name?: string; value?: string; excludeId?: string }) {
  return (
    <select name={name} defaultValue={value} className="h-8 rounded-md border bg-background px-2 text-sm">
      <option value="">— top level —</option>
      {flatten(tree).filter((o) => o.id !== excludeId).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}
