import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@/db';
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
    const [adminRole] = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, admin.user.id));
    expect(adminRole).toMatchObject({ role: 'admin', grantedByUserId: null });

    const member = await loginWithCode(auth, sent, 'someone@example.org');
    const memberRoles = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, member.user.id));
    expect(memberRoles).toEqual([]);
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
