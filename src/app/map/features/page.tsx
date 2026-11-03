import { AppShell } from '@/components/app-shell';
import { FeatureEditor } from '@/components/map/feature-editor';
import { getDb } from '@/db';
import { listMapFeatures, toMapFeatureData } from '@/lib/map/features';
import { requireMapper } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MapFeaturesPage() {
  const user = await requireMapper();
  const all = toMapFeatureData(await listMapFeatures(await getDb()));
  return (
    <AppShell user={user} theme="dark">
      <FeatureEditor feature={null} all={all} />
    </AppShell>
  );
}
