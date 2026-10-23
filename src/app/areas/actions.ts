'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { createArea, updateArea } from '@/lib/areas/service';
import { requireMemberAdmin } from '@/lib/session';

function parseAreaInput(formData: FormData) {
  const capacityRaw = String(formData.get('capacity') ?? '').trim();
  const mapRefRaw = String(formData.get('mapRef') ?? '').trim();
  return {
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    capacity: capacityRaw === '' ? null : Number(capacityRaw),
    bookable: formData.get('bookable') !== null,
    mapRef: mapRefRaw === '' ? null : mapRefRaw,
  };
}

export async function createAreaAction(formData: FormData) {
  await requireMemberAdmin();
  await createArea(await getDb(), parseAreaInput(formData));
  revalidatePath('/areas');
  redirect('/areas');
}

export async function updateAreaAction(formData: FormData) {
  await requireMemberAdmin();
  const id = String(formData.get('id'));
  await updateArea(await getDb(), { id, ...parseAreaInput(formData) });
  revalidatePath('/areas');
  redirect('/areas');
}
