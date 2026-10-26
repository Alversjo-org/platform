'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { replaceAreaCells } from '@/lib/map/area-cells';
import { requireMapper } from '@/lib/session';

export async function replaceAreaCellsAction(areaId: string, cells: Array<{ col: number; row: number }>): Promise<void> {
  await requireMapper();
  await replaceAreaCells(await getDb(), areaId, cells);
  revalidatePath('/map');
  revalidatePath(`/areas/${areaId}/cells`);
}
