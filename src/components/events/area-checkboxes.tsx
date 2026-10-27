import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { Area } from '@/db/schema';

export function AreaCheckboxes({ areas, defaultCheckedAreaIds = [] }: { areas: Area[]; defaultCheckedAreaIds?: string[] }) {
  return (
    <fieldset className="space-y-2">
      <Label>Areas</Label>
      {areas.map((area) => (
        <div key={area.id} className="flex items-center gap-2">
          <Checkbox id={`area-${area.id}`} name="areaIds" value={area.id} defaultChecked={defaultCheckedAreaIds.includes(area.id)} />
          <Label htmlFor={`area-${area.id}`}>{area.name}</Label>
        </div>
      ))}
    </fieldset>
  );
}
