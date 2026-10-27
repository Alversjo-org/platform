'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { CalendarEvent } from '@/lib/events/calendar-view';
import './events-calendar.css';

export function EventsCalendar({ events }: { events: CalendarEvent[] }) {
  return (
    <div className="events-calendar rounded-xl border bg-card p-3 sm:p-4">
      <FullCalendar plugins={[dayGridPlugin]} initialView="dayGridMonth" firstDay={1} events={events} height="auto" />
    </div>
  );
}
