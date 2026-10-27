'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { CalendarEvent } from '@/lib/events/calendar-view';

export function EventsCalendar({ events }: { events: CalendarEvent[] }) {
  return (
    <div className="rounded-lg border p-2">
      <FullCalendar plugins={[dayGridPlugin]} initialView="dayGridMonth" events={events} height="auto" />
    </div>
  );
}
