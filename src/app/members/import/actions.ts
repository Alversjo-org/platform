'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { importMembers } from '@/lib/members/import';
import { requireMemberAdmin } from '@/lib/session';

export async function importMembersAction(formData: FormData) {
  await requireMemberAdmin();
  const csv = String(formData.get('csv') ?? '');
  const results = await importMembers(await getDb(), csv);
  redirect(`/members/import?results=${encodeURIComponent(JSON.stringify(results))}`);
}
