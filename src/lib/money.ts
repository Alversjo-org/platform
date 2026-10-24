/** Converts kronor (SEK) to whole öre, rounding to the nearest öre to avoid float drift. */
export function sekToOre(sek: number): number {
  return Math.round(sek * 100);
}

/** Converts whole öre to kronor (SEK). */
export function oreToSek(ore: number): number {
  return ore / 100;
}
