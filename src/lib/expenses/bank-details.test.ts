import { describe, expect, it } from 'vitest';
import { formatIban, InvalidBankDetailsError, isValidBic, isValidIban, last4, maskedLabel, parseBankDetails } from './bank-details';

// Example IBANs published by the SWIFT IBAN registry.
const SE_IBAN = 'SE45 5000 0000 0583 9825 7466';
const DE_IBAN = 'DE89 3704 0044 0532 0130 00';

describe('isValidIban', () => {
  it('accepts valid IBANs with or without spaces, any case', () => {
    expect(isValidIban(SE_IBAN)).toBe(true);
    expect(isValidIban(DE_IBAN.replace(/ /g, '').toLowerCase())).toBe(true);
  });

  it('rejects a wrong check digit, a wrong length and junk', () => {
    expect(isValidIban('SE46 5000 0000 0583 9825 7466')).toBe(false);
    expect(isValidIban('SE45 5000 0000 0583 9825 746')).toBe(false);
    expect(isValidIban('hello')).toBe(false);
  });
});

describe('isValidBic', () => {
  it('accepts 8 and 11 character codes', () => {
    expect(isValidBic('ESSESESS')).toBe(true);
    expect(isValidBic('DEUTDEFF500')).toBe(true);
    expect(isValidBic('ESSE')).toBe(false);
  });
});

describe('parseBankDetails', () => {
  it('normalises a Swedish IBAN and allows it without a BIC', () => {
    expect(parseBankDetails({ kind: 'iban', holderName: '  Anna   Svensson ', iban: SE_IBAN })).toEqual({
      kind: 'iban', holderName: 'Anna Svensson', iban: 'SE4550000000058398257466', bic: '',
    });
  });

  it('requires a BIC for a foreign IBAN', () => {
    expect(() => parseBankDetails({ kind: 'iban', holderName: 'Max', iban: DE_IBAN })).toThrow(InvalidBankDetailsError);
    expect(parseBankDetails({ kind: 'iban', holderName: 'Max', iban: DE_IBAN, bic: 'deutdeff' }).kind).toBe('iban');
  });

  it('accepts a Swedish clearing + account number, stripping separators', () => {
    expect(parseBankDetails({ kind: 'se', holderName: 'Anna', clearing: '8327-9', account: '123 456 789-0' })).toEqual({
      kind: 'se', holderName: 'Anna', clearing: '83279', account: '1234567890',
    });
  });

  it('rejects bad clearing numbers and accounts', () => {
    expect(() => parseBankDetails({ kind: 'se', holderName: 'A', clearing: '123', account: '1234567' })).toThrow(InvalidBankDetailsError);
    expect(() => parseBankDetails({ kind: 'se', holderName: 'A', clearing: '61234', account: '1234567' })).toThrow(InvalidBankDetailsError);
    expect(() => parseBankDetails({ kind: 'se', holderName: 'A', clearing: '6123', account: '12' })).toThrow(InvalidBankDetailsError);
  });

  it('requires a holder name', () => {
    expect(() => parseBankDetails({ kind: 'iban', holderName: ' ', iban: SE_IBAN })).toThrow(/holder/);
  });
});

describe('display helpers', () => {
  it('shows only the last four characters', () => {
    const d = parseBankDetails({ kind: 'iban', holderName: 'A', iban: SE_IBAN });
    expect(last4(d)).toBe('7466');
    expect(maskedLabel('iban', '7466')).toBe('IBAN •••• 7466');
    expect(formatIban('SE4550000000058398257466')).toBe('SE45 5000 0000 0583 9825 7466');
  });
});
