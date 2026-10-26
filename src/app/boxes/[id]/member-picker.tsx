'use client';

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import type { ShareCandidate } from '@/lib/boxes/access';

const label = (m: ShareCandidate) => m.name || m.email;

/** Matches on name, nickname or email, so a member can be found without knowing their address. */
export function matchesQuery(m: ShareCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.name, m.nickname ?? '', m.email].some((s) => s.toLowerCase().includes(q));
}

/** Submits the chosen member's email as `name`, which is what shareBoxAction reads. */
export function MemberPicker({ id, name, candidates }: { id: string; name: string; candidates: ShareCandidate[] }) {
  return (
    <Combobox
      items={candidates}
      name={name}
      required
      itemToStringLabel={label}
      itemToStringValue={(m: ShareCandidate) => m.email}
      isItemEqualToValue={(a: ShareCandidate, b: ShareCandidate) => a.id === b.id}
      filter={matchesQuery}
    >
      <ComboboxInput id={id} placeholder="Search by name or email" className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>No member matches.</ComboboxEmpty>
        <ComboboxList>
          {(m: ShareCandidate) => (
            <ComboboxItem key={m.id} value={m}>
              <span className="flex flex-col">
                <span>{label(m)}{m.nickname && <span className="text-muted-foreground"> ({m.nickname})</span>}</span>
                {m.name && <span className="text-xs text-muted-foreground">{m.email}</span>}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
