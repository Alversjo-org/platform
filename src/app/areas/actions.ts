'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { createArea, updateArea } from '@/lib/areas/service';
import { requireMapper } from '@/lib/session';

function parseAreaInput(formData: FormData) {
  const capacityRaw = String(formData.get('capacity') ?? '').trim();
  return {
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    capacity: capacityRaw === '' ? null : Number(capacityRaw),
    bookable: formData.get('bookable') !== null,
  };
}

export async function createAreaAction(formData: FormData) {
  await requireMapper();
  await createArea(await getDb(), parseAreaInput(formData));
  revalidatePath('/areas');
  redirect('/areas');
}

export async function updateAreaAction(formData: FormData) {
  await requireMapper();
  const id = String(formData.get('id'));
  await updateArea(await getDb(), { id, ...parseAreaInput(formData) });
  revalidatePath('/areas');
  redirect('/areas');
}
