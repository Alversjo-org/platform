/**
 * Validation and formatting of members' payout accounts. Two shapes:
 * - an IBAN (any country; BIC optional), or
 * - a Swedish clearing number + account number (domestic SEK payments).
 * Pure functions only: no database, no encryption (see bank-account-service.ts).
 */

export type BankDetails =
  | { kind: 'iban'; holderName: string; iban: string; bic: string }
  | { kind: 'se'; holderName: string; clearing: string; account: string };

export class InvalidBankDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBankDetailsError';
  }
}

// IBAN lengths per country (SWIFT IBAN registry), for the countries members are likely to use.
// Other countries are accepted on the checksum alone.
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19,
  SK: 24, SM: 27, UA: 29,
};

export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** ISO 13616 check: country code, check digits, length, and mod-97 == 1. */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export function isValidBic(raw: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/\s/g, '').toUpperCase());
}

/** Groups an IBAN in fours, as printed by banks. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

export function parseBankDetails(input: {
  kind: string; holderName: string; iban?: string; bic?: string; clearing?: string; account?: string;
}): BankDetails {
  const holderName = input.holderName.trim().replace(/\s+/g, ' ');
  if (!holderName) throw new InvalidBankDetailsError('Enter the account holder’s name.');
  if (holderName.length > 70) throw new InvalidBankDetailsError('The account holder’s name can be at most 70 characters.');

  if (input.kind === 'iban') {
    const iban = normalizeIban(input.iban ?? '');
    if (!isValidIban(iban)) throw new InvalidBankDetailsError('That IBAN is not valid. Check it against your bank’s app.');
    const bic = (input.bic ?? '').replace(/\s/g, '').toUpperCase();
    if (bic && !isValidBic(bic)) throw new InvalidBankDetailsError('That BIC/SWIFT code is not valid (8 or 11 characters).');
    if (!iban.startsWith('SE') && !bic) {
      throw new InvalidBankDetailsError('For an account outside Sweden, also enter the bank’s BIC/SWIFT code.');
    }
    return { kind: 'iban', holderName, iban, bic };
  }

  if (input.kind === 'se') {
    const clearing = (input.clearing ?? '').replace(/\D/g, '');
    const account = (input.account ?? '').replace(/\D/g, '');
    // Clearing numbers are 4 digits; Swedbank's 8xxx-x series has a fifth check digit.
    if (!/^\d{4}$/.test(clearing) && !/^8\d{4}$/.test(clearing)) {
      throw new InvalidBankDetailsError('A clearing number has 4 digits (5 for Swedbank, starting with 8).');
    }
    if (!/^\d{5,10}$/.test(account)) throw new InvalidBankDetailsError('An account number has 5–10 digits (without the clearing number).');
    return { kind: 'se', holderName, clearing, account };
  }

  throw new InvalidBankDetailsError('Choose IBAN or Swedish account.');
}

/** The last four characters of the account number, the only part ever shown after saving. */
export function last4(details: BankDetails): string {
  return (details.kind === 'iban' ? details.iban : details.account).slice(-4);
}

/** "IBAN •••• 1234" / "Swedish account •••• 1234". */
export function maskedLabel(kind: 'iban' | 'se', lastFour: string): string {
  return `${kind === 'iban' ? 'IBAN' : 'Swedish account'} •••• ${lastFour}`;
}
