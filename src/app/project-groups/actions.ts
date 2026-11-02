'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { CostCentreAlreadyMappedError, createProjectGroup, UnknownCostCentreError, updateProjectGroup } from '@/lib/project-groups/service';
import { requireTreasurer } from '@/lib/session';

function parseProjectGroupInput(formData: FormData) {
  const costCentreCodeRaw = String(formData.get('costCentreCode') ?? '').trim();
  const parentIdRaw = String(formData.get('parentId') ?? '').trim();
  return {
    name: String(formData.get('name') ?? '').trim(),
    costCentreCode: costCentreCodeRaw === '' ? null : costCentreCodeRaw,
    parentId: parentIdRaw === '' ? null : parentIdRaw,
  };
}

export async function createProjectGroupAction(formData: FormData) {
  await requireTreasurer();
  try {
    await createProjectGroup(await getDb(), parseProjectGroupInput(formData));
  } catch (e) {
    if (e instanceof CostCentreAlreadyMappedError || e instanceof UnknownCostCentreError) redirect(`/project-groups?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath('/project-groups');
  redirect('/project-groups');
}

export async function updateProjectGroupAction(formData: FormData) {
  await requireTreasurer();
  const id = String(formData.get('id'));
  try {
    await updateProjectGroup(await getDb(), { id, ...parseProjectGroupInput(formData) });
  } catch (e) {
    if (e instanceof CostCentreAlreadyMappedError || e instanceof UnknownCostCentreError) redirect(`/project-groups?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath('/project-groups');
  redirect('/project-groups');
}
