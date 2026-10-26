'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CapacityFieldset({ defaultHasLimit, defaultCapacity }: { defaultHasLimit: boolean; defaultCapacity: number | '' }) {
  const [hasLimit, setHasLimit] = useState(defaultHasLimit);
  return (
    <fieldset className="space-y-2">
      <Label>Capacity</Label>
      <div className="flex items-center gap-2">
        <input type="radio" id="capacityLimited" name="capacityMode" value="limited" checked={hasLimit} onChange={() => setHasLimit(true)} />
        <Label htmlFor="capacityLimited">Limited to</Label>
        <Input name="capacity" type="number" min={1} className="w-24" defaultValue={defaultCapacity} required={hasLimit} disabled={!hasLimit} />
      </div>
      <div className="flex items-center gap-2">
        <input type="radio" id="capacityUnlimited" name="capacityMode" value="unlimited" checked={!hasLimit} onChange={() => setHasLimit(false)} />
        <Label htmlFor="capacityUnlimited">No limit</Label>
      </div>
    </fieldset>
  );
}
