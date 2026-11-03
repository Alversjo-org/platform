/**
 * What can be put on the map besides areas. Each kind belongs to one layer in the map's layer
 * switcher and has one shape family. Safe to import from client code.
 */
export type ShapeFamily = 'point' | 'line' | 'polygon';

export const MAP_LAYERS = [
  { id: 'borders', label: 'Property border', defaultOn: false },
  { id: 'places', label: 'Places (barns, water, toilets)', defaultOn: false },
  { id: 'buildings', label: 'Buildings', defaultOn: false },
  { id: 'water', label: 'Lakes & water protection zone', defaultOn: false },
  { id: 'paths', label: 'Paths', defaultOn: false },
  { id: 'biotopes', label: 'Protected biotopes', defaultOn: false },
  { id: 'flood', label: 'Flood-prone spots', defaultOn: false },
  { id: 'neighbours', label: 'Neighbours', defaultOn: false },
  { id: 'sound', label: 'Sound zones', defaultOn: false },
] as const;
export type MapLayerId = (typeof MAP_LAYERS)[number]['id'];

type KindInfo = { label: string; layer: MapLayerId; shape: ShapeFamily; color: string };

export const FEATURE_KINDS = {
  venue: { label: 'Building / venue', layer: 'places', shape: 'point', color: '#f97316' },
  water: { label: 'Drinking water', layer: 'places', shape: 'point', color: '#0ea5e9' },
  toilet: { label: 'Toilet', layer: 'places', shape: 'point', color: '#a855f7' },
  biotope: { label: 'Protected biotope', layer: 'biotopes', shape: 'point', color: '#16a34a' },
  flood: { label: 'Flood-prone spot', layer: 'flood', shape: 'point', color: '#2563eb' },
  neighbour: { label: 'Neighbour', layer: 'neighbours', shape: 'point', color: '#dc2626' },
  property: { label: 'Property border', layer: 'borders', shape: 'polygon', color: '#facc15' },
  'nature-reserve': { label: 'Nature reserve', layer: 'borders', shape: 'polygon', color: '#4ade80' },
  building: { label: 'Building outline', layer: 'buildings', shape: 'polygon', color: '#ef4444' },
  lake: { label: 'Lake', layer: 'water', shape: 'polygon', color: '#0284c7' },
  'water-protection': { label: 'Water protection zone', layer: 'water', shape: 'polygon', color: '#38bdf8' },
  path: { label: 'Path', layer: 'paths', shape: 'line', color: '#fde68a' },
  'sound-zone': { label: 'Sound zone', layer: 'sound', shape: 'polygon', color: '#e89422' },
} as const satisfies Record<string, KindInfo>;

export type FeatureKind = keyof typeof FEATURE_KINDS;

export function isFeatureKind(k: unknown): k is FeatureKind {
  return typeof k === 'string' && Object.hasOwn(FEATURE_KINDS, k);
}

/** Kinds a feature can be switched to without redrawing it (same shape family). */
export function kindsForShape(shape: ShapeFamily): FeatureKind[] {
  return (Object.keys(FEATURE_KINDS) as FeatureKind[]).filter((k) => FEATURE_KINDS[k].shape === shape);
}
