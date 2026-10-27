'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { syncEndDateOnStartChange } from '@/lib/events/date-sync';

export function DateRangeFields({ defaultStartsDate = '', defaultEndsDate = '' }: { defaultStartsDate?: string; defaultEndsDate?: string }) {
  const [startsDate, setStartsDate] = useState(defaultStartsDate);
  const [endsDate, setEndsDate] = useState(defaultEndsDate);
  const [endTouched, setEndTouched] = useState(defaultEndsDate !== '' && defaultEndsDate !== defaultStartsDate);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="startsDate">Starts (Europe/Stockholm)</Label>
        <Input
          id="startsDate"
          name="startsDate"
          type="date"
          required
          value={startsDate}
          onChange={(e) => {
            setStartsDate(e.target.value);
            setEndsDate((prev) => syncEndDateOnStartChange(e.target.value, prev, endTouched));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="endsDate">Ends (Europe/Stockholm)</Label>
        <Input
          id="endsDate"
          name="endsDate"
          type="date"
          required
          value={endsDate}
          onChange={(e) => {
            setEndsDate(e.target.value);
            setEndTouched(true);
          }}
        />
      </div>
    </div>
  );
}
