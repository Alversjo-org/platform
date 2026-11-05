'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { membersSearchHref } from '@/lib/members/filter';

const DEBOUNCE_MS = 250;

/** Search box that filters the members list as you type; Enter applies it immediately. */
export function MemberSearch({ status, initialQuery }: { status: string; initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastApplied = useRef(initialQuery);

  const apply = (value: string) => {
    clearTimeout(timer.current);
    if (value.trim() === lastApplied.current.trim()) return;
    lastApplied.current = value;
    startTransition(() => router.replace(membersSearchHref(status, value), { scroll: false }));
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <form className="flex-1" role="search" onSubmit={(e) => { e.preventDefault(); apply(query); }}>
      <input
        type="search" name="q" value={query} autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(e.target.value), DEBOUNCE_MS);
        }}
        placeholder="Search by name, nickname or email" aria-label="Search members"
        className="h-12 w-full rounded-full border border-white/60 bg-white/70 px-5 text-base shadow-[0_4px_24px_rgb(0_0_0/0.06)] backdrop-blur-md outline-none placeholder:text-ink-soft/80" />
    </form>
  );
}
