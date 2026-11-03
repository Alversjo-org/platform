import { AppShell } from '@/components/app-shell';
import { FeatureEditor } from '@/components/map/feature-editor';
import { getDb } from '@/db';
import type { ShapeFamily } from '@/lib/map/feature-kinds';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function NewMapFeaturePage({ searchParams }: { searchParams: Promise<{ shape?: string }> }) {
  const user = await requireMapper();
  const { shape: raw } = await searchParams;
  const shape: ShapeFamily = raw === 'line' || raw === 'polygon' ? raw : 'point';
  const all = toMapFeatureData(await listMapFeatures(await getDb()));
  return (
    <AppShell user={user} theme="dark">
      <FeatureEditor key={shape} feature={null} newShape={shape} all={all} />
    </AppShell>
  );
}
