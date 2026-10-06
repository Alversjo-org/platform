'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { importMembers } from '@/lib/members/import';
import { requireMemberAdmin } from '@/lib/session';

const MAX_ERROR_EMAILS_IN_REDIRECT = 20;

export async function importMembersAction(formData: FormData) {
  await requireMemberAdmin();
  const csv = String(formData.get('csv') ?? '');
  const results = await importMembers(await getDb(), csv);

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errored = results.filter((r) => r.status === 'error');

  const params = new URLSearchParams({
    created: String(created),
    skipped: String(skipped),
    error: String(errored.length),
  });
  // Cap the per-row detail we round-trip through the query string (and therefore access logs
  // and browser history) to a short, actionable list of the emails that failed, not the full
  // roster.
  for (const row of errored.slice(0, MAX_ERROR_EMAILS_IN_REDIRECT)) {
    params.append('errorEmail', row.email);
  }

  redirect(`/members/import?${params.toString()}`);
}
