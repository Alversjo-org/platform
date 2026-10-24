export function areaColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  // Ids that differ only in their last character (e.g. "section-a" vs
  // "section-b") would otherwise hash to adjacent, visually indistinguishable
  // hues. Run the raw hash through a murmur3-style finalizer so a
  // one-character difference in the id scatters across the hue circle
  // instead of landing next to it.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
