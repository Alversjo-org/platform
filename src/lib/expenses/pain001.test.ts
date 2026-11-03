import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBankDetails } from './bank-details';
import { buildPain001, InvalidPaymentFileError, type Pain001Batch } from './pain001';

const debtor = { name: 'Föreningen Alversjö', orgNumber: '802000-0000', iban: 'SE45 5000 0000 0583 9825 7466', bic: 'ESSESESS', bankCustomerId: '' };

function batch(overrides: Partial<Pain001Batch> = {}): Pain001Batch {
  return {
    messageId: 'UB-20261103-1',
    createdAt: new Date('2026-11-03T10:15:30.123Z'),
    executionDate: '2026-11-04',
    debtor,
    payments: [
      {
        endToEndId: 'U-AAA111', amountOre: 12345, remittance: 'Utlägg U-AAA111 <färg & penslar>',
        creditor: parseBankDetails({ kind: 'iban', holderName: 'Anna Svensson', iban: 'SE45 5000 0000 0583 9825 7466' }),
      },
      {
        endToEndId: 'U-BBB222', amountOre: 5000, remittance: 'Utlägg U-BBB222',
        creditor: parseBankDetails({ kind: 'se', holderName: 'Bo Ek', clearing: '6123', account: '123456789' }),
      },
      {
        endToEndId: 'U-CCC333', amountOre: 100, remittance: 'Utlägg U-CCC333',
        creditor: parseBankDetails({ kind: 'iban', holderName: 'Max Muster', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX' }),
      },
    ],
    ...overrides,
  };
}

describe('buildPain001', () => {
  const xml = buildPain001(batch());

  it('writes the header totals and the batch debit', () => {
    expect(xml).toContain('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"');
    expect(xml).toContain('<MsgId>UB-20261103-1</MsgId>');
    expect(xml).toContain('<CreDtTm>2026-11-03T10:15:30Z</CreDtTm>');
    expect(xml.match(/<NbOfTxs>3<\/NbOfTxs>/g)).toHaveLength(2);
    expect(xml.match(/<CtrlSum>174.45<\/CtrlSum>/g)).toHaveLength(2);
    expect(xml).toContain('<ReqdExctnDt>2026-11-04</ReqdExctnDt>');
    expect(xml).toContain('<DbtrAcct><Id><IBAN>SE4550000000058398257466</IBAN></Id><Ccy>SEK</Ccy></DbtrAcct>');
    expect(xml).toContain('<Id>8020000000</Id>');
  });

  it('pays an IBAN, a Swedish account (BBAN + SESBA clearing) and a foreign IBAN with shared charges', () => {
    expect(xml).toContain('<InstdAmt Ccy="SEK">123.45</InstdAmt>');
    expect(xml).toContain('<CdtrAcct><Id><IBAN>SE4550000000058398257466</IBAN></Id></CdtrAcct>');
    expect(xml).toContain('<ClrSysId><Cd>SESBA</Cd></ClrSysId><MmbId>6123</MmbId>');
    expect(xml).toContain('<Othr><Id>6123123456789</Id><SchmeNm><Cd>BBAN</Cd></SchmeNm></Othr>');
    expect(xml).toContain('<ChrgBr>SHAR</ChrgBr><CdtrAgt><FinInstnId><BIC>COBADEFFXXX</BIC>');
    expect(xml.match(/<ChrgBr>/g)).toHaveLength(1);
  });

  it('escapes text and keeps Swedish letters', () => {
    expect(xml).toContain('<Ustrd>Utlägg U-AAA111 &lt;färg &amp; penslar&gt;</Ustrd>');
    expect(xml).toContain('<Nm>Föreningen Alversjö</Nm>');
  });

  it('is well-formed XML', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pain001-'));
    const file = path.join(dir, 'p.xml');
    writeFileSync(file, xml);
    try {
      execFileSync('xmllint', ['--noout', file], { stdio: 'pipe' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; // xmllint not installed
      throw e;
    }
  });

  it('refuses an empty batch or missing debtor details', () => {
    expect(() => buildPain001(batch({ payments: [] }))).toThrow(InvalidPaymentFileError);
    expect(() => buildPain001(batch({ debtor: { ...debtor, iban: '' } }))).toThrow(/settings/);
  });
});
