import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption for bank account numbers and payment files at rest: AES-256-GCM with the key in
 * BANK_DATA_KEY (32 random bytes, base64). Stored as "v1:<iv>:<tag>:<ciphertext>" (base64 parts).
 *
 * Production refuses to run without the key. Dev and tests fall back to a fixed, public key so
 * a laptop or a box can be used without setup; never put real bank details into such a database.
 */
const VERSION = 'v1';
const DEV_KEY = createHash('sha256').update('alversjo-dev-only-bank-data-key').digest();

export class BankDataKeyMissingError extends Error {
  constructor() {
    super('BANK_DATA_KEY is not set: bank details cannot be stored or read');
    this.name = 'BankDataKeyMissingError';
  }
}

function key(): Buffer {
  const raw = process.env.BANK_DATA_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') throw new BankDataKeyMissingError();
    return DEV_KEY;
  }
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('BANK_DATA_KEY must be 32 bytes, base64-encoded');
  return k;
}

export function encryptText(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptText(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Unrecognised encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
