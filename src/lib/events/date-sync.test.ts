import { describe, expect, it } from 'vitest';
import { syncEndDateOnStartChange } from './date-sync';

describe('syncEndDateOnStartChange', () => {
  it('mirrors the new start date onto the end date when the end date has not been touched', () => {
    expect(syncEndDateOnStartChange('2027-06-21', '2027-06-20', false)).toBe('2027-06-21');
  });

  it('leaves the end date alone once the organiser has edited it directly', () => {
    expect(syncEndDateOnStartChange('2027-06-21', '2027-06-25', true)).toBe('2027-06-25');
  });
});
