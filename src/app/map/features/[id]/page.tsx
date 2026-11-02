import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { FeatureEditor } from '@/components/map/feature-editor';
import { getDb } from '@/db';
import { FEATURE_KINDS } from '@/lib/map/feature-kinds';
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
    <AppShell user={user}>
      <h1 className="mb-4 text-xl font-semibold">Edit: {feature.name || FEATURE_KINDS[feature.kind].label}</h1>
      <FeatureEditor
        // A fresh editor per feature, so state never carries over after "Add" redirects here.
        key={feature.id}
        feature={feature}
        shape={FEATURE_KINDS[feature.kind].shape}
        others={all.filter((f) => f.id !== id)}
      />
    </AppShell>
  );
}
