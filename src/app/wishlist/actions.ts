'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { createPurchaseProject } from '@/lib/projects/purchase-service';
import { transitionStatus } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

export async function createPurchaseProjectAction(formData: FormData) {
  const actor = await requireUser();
  const title = String(formData.get('title') ?? '').trim();
  if (!title) redirect('/wishlist/new');
  await createPurchaseProject(await getDb(), {
    title,
    summary: String(formData.get('summary') ?? '').trim(),
    body: String(formData.get('body') ?? ''),
    ownerUserId: actor.id,
  });
  redirect('/wishlist');
}

export async function markFulfilledAction(formData: FormData) {
  const actor = await requireUser();
  await transitionStatus(await getDb(), { projectId: String(formData.get('projectId')), to: 'closed', actorUserId: actor.id });
  revalidatePath('/wishlist');
}
