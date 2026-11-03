import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { FeatureEditor } from '@/components/map/feature-editor';
import { getDb } from '@/db';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function EditMapFeaturePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireMapper();
  const { id } = await params;
  const all = toMapFeatureData(await listMapFeatures(await getDb()));
  const feature = all.find((f) => f.id === id);
  if (!feature) notFound();
  return (
    <AppShell user={user} theme="dark">
      {/* A fresh editor per feature, so state never carries over after "Add" redirects here. */}
      <FeatureEditor key={feature.id} feature={feature} all={all} />
    </AppShell>
  );
}
