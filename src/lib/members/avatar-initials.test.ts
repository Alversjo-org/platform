import { describe, expect, it } from 'vitest';
import { avatarFallbackText } from './avatar-initials';

describe('avatarFallbackText', () => {
  it('returns initials from the first two words of a full name', () => {
    expect(avatarFallbackText('Viktor Zaunders', 'zaunders@example.org')).toBe('VZ');
  });

  it('returns a single initial for a one-word name', () => {
    expect(avatarFallbackText('Madonna', 'madonna@example.org')).toBe('M');
  });

  it('ignores extra whitespace between words', () => {
    expect(avatarFallbackText('  Viktor   Zaunders  ', 'zaunders@example.org')).toBe('VZ');
  });

  it('falls back to the first letter of the email when name is empty', () => {
    expect(avatarFallbackText('', 'zaunders@example.org')).toBe('Z');
  });

  it('falls back to the first letter of the email when name is only whitespace', () => {
    expect(avatarFallbackText('   ', 'zaunders@example.org')).toBe('Z');
  });

  it('uppercases the fallback letter', () => {
    expect(avatarFallbackText('', 'lowercase@example.org')).toBe('L');
  });
});
