import { sekToOre } from '@/lib/money';
import { combineStockholmDateAndTime, stockholmWallClockToUtc } from '@/lib/timezone';
import type { UpsertEventDetailsInput } from './details-service';

export function parseEventDetailsForm(formData: FormData): Omit<UpsertEventDetailsInput, 'projectId'> {
  const hasCapacityLimit = formData.get('capacityMode') === 'limited';
  const capacityRaw = String(formData.get('capacity') ?? '').trim();
  const signupOpensRaw = String(formData.get('signupOpensAt') ?? '').trim();
  const signupClosesRaw = String(formData.get('signupClosesAt') ?? '').trim();
  const priceNoteRaw = String(formData.get('priceNote') ?? '').trim();
  const contactNoteRaw = String(formData.get('contactNote') ?? '').trim();
  const priceKrRaw = String(formData.get('priceKr') ?? '').trim();
  const startsTimeRaw = String(formData.get('startsTime') ?? '').trim();
  const endsTimeRaw = String(formData.get('endsTime') ?? '').trim();

  return {
    startsAt: combineStockholmDateAndTime(String(formData.get('startsDate')), startsTimeRaw || null),
    endsAt: combineStockholmDateAndTime(String(formData.get('endsDate')), endsTimeRaw || null),
    hasCapacityLimit,
    capacity: hasCapacityLimit ? Number(capacityRaw) : null,
    signupOpensAt: signupOpensRaw === '' ? null : stockholmWallClockToUtc(signupOpensRaw),
    signupClosesAt: signupClosesRaw === '' ? null : stockholmWallClockToUtc(signupClosesRaw),
    priceSek: priceKrRaw === '' ? 0 : sekToOre(Number(priceKrRaw)),
    priceNote: priceNoteRaw === '' ? null : priceNoteRaw,
    contactNote: contactNoteRaw === '' ? null : contactNoteRaw,
    showSignupsToParticipants: formData.get('showSignupsToParticipants') !== null,
  };
}
