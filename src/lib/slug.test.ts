import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and dashes words', () => {
    expect(slugify('Midsommar Work Weekend')).toBe('midsommar-work-weekend');
  });
  it('keeps non-ASCII letters', () => {
    expect(slugify('Midsommarfest på Alversjö!')).toBe('midsommarfest-på-alversjö');
  });
  it('collapses repeated punctuation and trims leading/trailing dashes', () => {
    expect(slugify('  -- Build day: kitchen & sauna --  ')).toBe('build-day-kitchen-sauna');
  });
});
