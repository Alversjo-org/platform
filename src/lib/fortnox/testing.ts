import type { FortnoxClient } from './client';

/** For fake clients in tests that only read: every write fails loudly if called. */
export const unusedWrites: Pick<FortnoxClient, 'ensureVoucherSeries' | 'createVoucher' | 'findVoucherByComment' | 'uploadInboxFile' | 'connectFileToVoucher'> = {
  ensureVoucherSeries: async () => { throw new Error('not used'); },
  createVoucher: async () => { throw new Error('not used'); },
  findVoucherByComment: async () => { throw new Error('not used'); },
  uploadInboxFile: async () => { throw new Error('not used'); },
  connectFileToVoucher: async () => { throw new Error('not used'); },
};
