'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MapFeatureData } from '@/lib/map/features';
import type { MapAreaData } from '@/lib/map/view-model';

// Leaflet needs `window`, and keeping it out of the server bundle means only map pages download it.
const MapViewLeaflet = dynamic(() => import('./map-view-leaflet'), {
  ssr: false,
  loading: () => <div className="h-[70vh] min-h-[400px] w-full animate-pulse rounded-md border bg-muted" />,
});

export function MapView({ areas, features, canEditFeatures }: { areas: MapAreaData[]; features: MapFeatureData[]; canEditFeatures: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = areas.find((a) => a.id === selectedId) ?? null;

  return (
    <div>
      {areas.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          No sections have been mapped yet — check back soon, or ask a mapper to draw an area under &quot;Areas&quot;.
        </p>
      )}
      <MapViewLeaflet areas={areas} features={features} canEditFeatures={canEditFeatures} selectedId={selectedId} onSelect={setSelectedId} />
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
      <p className="mt-2 text-xs text-muted-foreground">
        Map data as GeoJSON (for QGIS, Google Earth, …): <a href="/map/areas.geojson" className="underline">areas</a>,{' '}
        <a href="/map/features.geojson" className="underline">places, borders and other features</a>
        {canEditFeatures && <> · <Link href="/map/features" className="underline">Edit map features</Link></>}
      </p>
    </div>
  );
}
