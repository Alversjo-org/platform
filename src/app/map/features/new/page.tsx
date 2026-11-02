import { AppShell } from '@/components/app-shell';
import { FeatureEditor } from '@/components/map/feature-editor';
import { getDb } from '@/db';
import type { ShapeFamily } from '@/lib/map/feature-kinds';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

const TITLES: Record<ShapeFamily, string> = { point: 'Add a point', line: 'Add a line', polygon: 'Add a shape' };

export default async function NewMapFeaturePage({ searchParams }: { searchParams: Promise<{ shape?: string }> }) {
  const user = await requireMapper();
  const { shape: raw } = await searchParams;
  const shape: ShapeFamily = raw === 'line' || raw === 'polygon' ? raw : 'point';
  const others = toMapFeatureData(await listMapFeatures(await getDb()));
  return (
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">{TITLES[shape]}</h1>
      <FeatureEditor feature={null} shape={shape} others={others} />
    </AppShell>
  );
}
