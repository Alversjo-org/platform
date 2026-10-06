import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRenewalEmail } from './email';

describe('sendRenewalEmail', () => {
  const prevKey = process.env.RESEND_API_KEY;

  beforeEach(() => { delete process.env.RESEND_API_KEY; });
  afterEach(() => { if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey; });

  it('prints to the console instead of sending when RESEND_API_KEY is unset', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendRenewalEmail({ to: 'a@example.org', subject: 'Renew', body: 'Hi' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('to=a@example.org subject="Renew"'));
    logSpy.mockRestore();
  });
});
