import { describe, expect, it } from 'vitest';
import { parseEventDetailsForm } from './parse-details-form';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('parseEventDetailsForm', () => {
  const base = { startsDate: '2027-06-20', endsDate: '2027-06-21', capacityMode: 'unlimited' };

  it('defaults start/end to midnight when no time is given (date-only event)', () => {
    const input = parseEventDetailsForm(form(base));
    expect(input.startsAt.toISOString()).toBe('2027-06-19T22:00:00.000Z'); // 00:00 CEST
    expect(input.endsAt.toISOString()).toBe('2027-06-20T22:00:00.000Z');
  });

  it('uses the optional time fields when provided', () => {
    const input = parseEventDetailsForm(form({ ...base, startsTime: '09:00', endsTime: '17:00' }));
    expect(input.startsAt.toISOString()).toBe('2027-06-20T07:00:00.000Z');
    expect(input.endsAt.toISOString()).toBe('2027-06-21T15:00:00.000Z');
  });

  it('maps capacityMode=unlimited to hasCapacityLimit=false, capacity=null', () => {
    const input = parseEventDetailsForm(form(base));
    expect(input.hasCapacityLimit).toBe(false);
    expect(input.capacity).toBeNull();
  });

  it('maps capacityMode=limited with a capacity number', () => {
    const input = parseEventDetailsForm(form({ ...base, capacityMode: 'limited', capacity: '40' }));
    expect(input.hasCapacityLimit).toBe(true);
    expect(input.capacity).toBe(40);
  });

  it('converts priceKr (SEK) to priceSek (öre)', () => {
    const input = parseEventDetailsForm(form({ ...base, priceKr: '19.99' }));
    expect(input.priceSek).toBe(1999);
  });

  it('defaults priceKr to 0 when blank', () => {
    const input = parseEventDetailsForm(form(base));
    expect(input.priceSek).toBe(0);
  });

  it('leaves optional text fields null when blank, trimmed otherwise', () => {
    const input = parseEventDetailsForm(form({ ...base, priceNote: '  door  ', contactNote: '' }));
    expect(input.priceNote).toBe('door');
    expect(input.contactNote).toBeNull();
  });

  it('reads showSignupsToParticipants from presence of the checkbox field', () => {
    expect(parseEventDetailsForm(form(base)).showSignupsToParticipants).toBe(false);
    expect(parseEventDetailsForm(form({ ...base, showSignupsToParticipants: 'on' })).showSignupsToParticipants).toBe(true);
  });
});
