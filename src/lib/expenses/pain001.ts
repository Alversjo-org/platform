import type { BankDetails } from './bank-details';

/**
 * ISO 20022 customer credit transfer initiation, pain.001.001.03: the payment file Swedish banks
 * (SEB, Handelsbanken, Swedbank, Nordea, Danske Bank, …) accept in their corporate internet bank
 * after the LB/Bankgirot formats were retired. One file = one batch debit from the association's
 * account, paid in SEK.
 *
 * Creditor accounts:
 * - IBAN → CdtrAcct/Id/IBAN (+ BIC in CdtrAgt when known; foreign IBANs share charges).
 * - Swedish clearing + account → CdtrAcct/Id/Othr with scheme BBAN, and the clearing number as
 *   ClrSysMmbId with clearing system SESBA (the Swedish convention in the banks' guides).
 *
 * Banks differ in small ways (initiating-party id, which elements they want); always send a
 * test file to the bank first. Element order follows the pain.001.001.03 XSD.
 */

export type Pain001Debtor = {
  name: string;
  orgNumber: string; // organisationsnummer, digits
  iban: string;
  bic: string;
  bankCustomerId: string; // agreement / customer id from the bank; falls back to the org number
};

export type Pain001Payment = {
  endToEndId: string; // max 35, shown to the payee's bank
  amountOre: number;
  creditor: BankDetails;
  remittance: string; // max 140, the text on the payee's statement
};

export type Pain001Batch = {
  messageId: string; // max 35, unique per file
  createdAt: Date;
  executionDate: string; // YYYY-MM-DD
  debtor: Pain001Debtor;
  payments: Pain001Payment[];
};

export class InvalidPaymentFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPaymentFileError';
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Free text limited to `max` characters, without control characters. */
function txt(text: string, max: number): string {
  return esc(text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
}

function amount(ore: number): string {
  return (ore / 100).toFixed(2);
}

/** ISO date-time without milliseconds, as the banks' validators expect. */
function isoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function orgId(id: string, scheme: 'BANK' | 'CUST'): string {
  return `<Id><OrgId><Othr><Id>${txt(id, 35)}</Id><SchmeNm><Cd>${scheme}</Cd></SchmeNm></Othr></OrgId></Id>`;
}

function creditorParts(c: BankDetails): { agent: string; account: string; chargeBearer: string } {
  if (c.kind === 'iban') {
    const foreign = !c.iban.startsWith('SE');
    return {
      agent: c.bic ? `<CdtrAgt><FinInstnId><BIC>${esc(c.bic)}</BIC></FinInstnId></CdtrAgt>` : '',
      account: `<CdtrAcct><Id><IBAN>${esc(c.iban)}</IBAN></Id></CdtrAcct>`,
      chargeBearer: foreign ? '<ChrgBr>SHAR</ChrgBr>' : '',
    };
  }
  return {
    agent: `<CdtrAgt><FinInstnId><ClrSysMmbId><ClrSysId><Cd>SESBA</Cd></ClrSysId><MmbId>${esc(c.clearing)}</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt>`,
    account: `<CdtrAcct><Id><Othr><Id>${esc(c.clearing + c.account)}</Id><SchmeNm><Cd>BBAN</Cd></SchmeNm></Othr></Id></CdtrAcct>`,
    chargeBearer: '',
  };
}

export function buildPain001(batch: Pain001Batch): string {
  const { debtor, payments } = batch;
  if (payments.length === 0) throw new InvalidPaymentFileError('A payment file needs at least one payment.');
  if (!debtor.name || !debtor.iban || !debtor.orgNumber) {
    throw new InvalidPaymentFileError('Fill in the association’s name, organisation number and IBAN in the outlay settings first.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batch.executionDate)) throw new InvalidPaymentFileError('Invalid execution date.');
  for (const p of payments) {
    if (!Number.isInteger(p.amountOre) || p.amountOre <= 0) throw new InvalidPaymentFileError(`Payment ${p.endToEndId} has no amount.`);
  }

  const total = payments.reduce((sum, p) => sum + p.amountOre, 0);
  const initiatorId = debtor.bankCustomerId || debtor.orgNumber;

  const transactions = payments.map((p) => {
    const c = creditorParts(p.creditor);
    return [
      '<CdtTrfTxInf>',
      `<PmtId><InstrId>${txt(p.endToEndId, 35)}</InstrId><EndToEndId>${txt(p.endToEndId, 35)}</EndToEndId></PmtId>`,
      `<Amt><InstdAmt Ccy="SEK">${amount(p.amountOre)}</InstdAmt></Amt>`,
      c.chargeBearer,
      c.agent,
      `<Cdtr><Nm>${txt(p.creditor.holderName, 70)}</Nm></Cdtr>`,
      c.account,
      `<RmtInf><Ustrd>${txt(p.remittance, 140)}</Ustrd></RmtInf>`,
      '</CdtTrfTxInf>',
    ].join('');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<CstmrCdtTrfInitn>',
    '<GrpHdr>',
    `<MsgId>${txt(batch.messageId, 35)}</MsgId>`,
    `<CreDtTm>${isoDateTime(batch.createdAt)}</CreDtTm>`,
    `<NbOfTxs>${payments.length}</NbOfTxs>`,
    `<CtrlSum>${amount(total)}</CtrlSum>`,
    `<InitgPty><Nm>${txt(debtor.name, 70)}</Nm>${orgId(initiatorId, debtor.bankCustomerId ? 'BANK' : 'CUST')}</InitgPty>`,
    '</GrpHdr>',
    '<PmtInf>',
    `<PmtInfId>${txt(batch.messageId, 35)}</PmtInfId>`,
    '<PmtMtd>TRF</PmtMtd>',
    '<BtchBookg>true</BtchBookg>',
    `<NbOfTxs>${payments.length}</NbOfTxs>`,
    `<CtrlSum>${amount(total)}</CtrlSum>`,
    '<PmtTpInf><SvcLvl><Cd>NURG</Cd></SvcLvl></PmtTpInf>',
    `<ReqdExctnDt>${batch.executionDate}</ReqdExctnDt>`,
    `<Dbtr><Nm>${txt(debtor.name, 70)}</Nm>${orgId(debtor.orgNumber.replace(/\D/g, ''), 'CUST')}</Dbtr>`,
    `<DbtrAcct><Id><IBAN>${esc(debtor.iban.replace(/\s/g, '').toUpperCase())}</IBAN></Id><Ccy>SEK</Ccy></DbtrAcct>`,
    debtor.bic
      ? `<DbtrAgt><FinInstnId><BIC>${esc(debtor.bic.replace(/\s/g, '').toUpperCase())}</BIC></FinInstnId></DbtrAgt>`
      : '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>',
    ...transactions,
    '</PmtInf>',
    '</CstmrCdtTrfInitn>',
    '</Document>',
    '',
  ].join('\n');
}
