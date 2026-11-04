'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import type { TaskStatus } from '@/db/schema';
import { getImageStorage } from '@/lib/images/storage';
import { prepareImageUpload } from '@/lib/images/resize';
import { requireUser } from '@/lib/session';
import { assignTask, createTask, deleteTask, updateTaskStatus } from '@/lib/tasks/service';

const STATUSES: TaskStatus[] = ['backlog', 'doing', 'done'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function createTaskAction(formData: FormData) {
  const user = await requireUser();
  const description = String(formData.get('description') ?? '').trim();
  if (!description) return;
  const assignee = String(formData.get('assigneeUserId') ?? '');

  let imageUrl: string | null = null;
  const file = formData.get('image');
  if (file instanceof File && file.size > 0 && file.size <= MAX_IMAGE_BYTES) {
    const { buffer, contentType } = await prepareImageUpload(Buffer.from(await file.arrayBuffer()));
    imageUrl = await getImageStorage().put(`tasks/${randomUUID()}.webp`, buffer, contentType);
  }

  await createTask(await getDb(), {
    description,
    createdByUserId: user.id,
    assigneeUserId: assignee || null,
    imageUrl,
  });
  revalidatePath('/tasks');
}

export async function updateTaskStatusAction(formData: FormData) {
  await requireUser();
  const status = String(formData.get('status')) as TaskStatus;
  if (!STATUSES.includes(status)) return;
  await updateTaskStatus(await getDb(), { taskId: String(formData.get('taskId')), status });
  revalidatePath('/tasks');
}

export async function assignTaskAction(formData: FormData) {
  await requireUser();
  const assignee = String(formData.get('assigneeUserId') ?? '');
  await assignTask(await getDb(), { taskId: String(formData.get('taskId')), assigneeUserId: assignee || null });
  revalidatePath('/tasks');
}

export async function deleteTaskAction(formData: FormData) {
  await requireUser();
  await deleteTask(await getDb(), String(formData.get('taskId')));
  revalidatePath('/tasks');
}
