'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cellRect } from '@/lib/map/grid';
import { GRID_COLS, GRID_ROWS, MAP_IMAGE_SRC } from '@/lib/map/constants';
import type { MapAreaData } from '@/lib/map/view-model';

function centroid(cells: Array<{ col: number; row: number }>): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  for (const { col, row } of cells) {
    const r = cellRect(col, row);
    sumX += (r.x0 + r.x1) / 2;
    sumY += (r.y0 + r.y1) / 2;
  }
  return { x: sumX / cells.length, y: sumY / cells.length };
}

export function MapView({ areas }: { areas: MapAreaData[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = areas.find((a) => a.id === selectedId) ?? null;
  const cellWidth = 1 / GRID_COLS;
  const cellHeight = 1 / GRID_ROWS;

  return (
    <div>
      {areas.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          No sections have been mapped yet — check back soon, or ask an admin to assign grid cells to an area under &quot;Areas&quot;.
        </p>
      )}
      <div className="relative w-full">
        <img src={MAP_IMAGE_SRC} alt="Alversjö map" className="w-full" />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <pattern id="map-grid" width={cellWidth} height={cellHeight} patternUnits="userSpaceOnUse">
              <rect width={cellWidth} height={cellHeight} fill="none" stroke="white" strokeOpacity={0.3} strokeWidth={0.0005} />
            </pattern>
          </defs>
          <rect width="1" height="1" fill="url(#map-grid)" />
          {areas.map((area) => {
            const { x, y } = centroid(area.cells);
            return (
              <g key={area.id} onClick={() => setSelectedId(area.id)} style={{ cursor: 'pointer' }}>
                {area.cells.map((cell) => {
                  const r = cellRect(cell.col, cell.row);
                  return (
                    <rect
                      key={`${cell.col},${cell.row}`}
                      x={r.x0}
                      y={r.y0}
                      width={r.x1 - r.x0}
                      height={r.y1 - r.y0}
                      fill={area.color}
                      fillOpacity={selectedId === area.id ? 0.55 : 0.35}
                    />
                  );
                })}
                <text x={x} y={y} fontSize={0.012} textAnchor="middle" fill="white" stroke="black" strokeWidth={0.0015} paintOrder="stroke">
                  {area.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {selected && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{selected.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {selected.description && <p>{selected.description}</p>}
            <p className="text-sm text-muted-foreground">
              {selected.capacity != null ? `Capacity: ${selected.capacity}` : 'Capacity: not set'} ·{' '}
              {selected.bookable ? 'Bookable' : 'Not bookable'}
            </p>
            {selected.bookings.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {selected.bookings.map((b, i) => (
                  <li key={i}>
                    <Link href={`/events/${b.eventSlug}`} className="underline">{b.eventTitle}</Link>{' '}
                    ({b.from} – {b.to}, Europe/Stockholm)
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming bookings.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
