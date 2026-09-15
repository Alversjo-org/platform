import { beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '@/db';
import { buildAuth } from './auth';

async function loginWithCode(auth: ReturnType<typeof buildAuth>, sent: string[], email: string) {
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const otp = sent.at(-1)!;
  return auth.api.signInEmailOTP({ body: { email, otp } });
}

describe('auth', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret';
    process.env.ADMIN_EMAILS = 'Admin@Example.org';
  });

  it('creates admins from ADMIN_EMAILS (case-insensitive) and members otherwise', async () => {
    const db = await createDb('pglite://memory');
    const sent: string[] = [];
    const auth = buildAuth(db, { sendOtp: async ({ otp }) => void sent.push(otp) });

    const admin = await loginWithCode(auth, sent, 'admin@example.org');
    // better-auth 1.7.5's static type for signInEmailOTP's response omits additionalFields
    // (unlike its sibling endpoints, which return `user: {...} & Record<string, any>`);
    // `role` is present at runtime (set by databaseHooks.user.create).
    // @ts-expect-error -- role is an additionalField not in signInEmailOTP's declared return type
    expect(admin.user.role).toBe('admin');

    const member = await loginWithCode(auth, sent, 'someone@example.org');
    // @ts-expect-error -- role is an additionalField not in signInEmailOTP's declared return type
    expect(member.user.role).toBe('member');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(/^\d{6}$/);
  });

  it('rejects a wrong code', async () => {
    const db = await createDb('pglite://memory');
    const sent: string[] = [];
    const auth = buildAuth(db, { sendOtp: async ({ otp }) => void sent.push(otp) });
    await auth.api.sendVerificationOTP({ body: { email: 'x@example.org', type: 'sign-in' } });
    await expect(auth.api.signInEmailOTP({ body: { email: 'x@example.org', otp: '000000' } })).rejects.toThrow();
  });
});
