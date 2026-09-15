import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';
import { getDb, schema, type Db } from '@/db';
import { sendOtpEmail, type OtpMail } from '@/lib/email';

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function buildAuth(db: Db, opts: { sendOtp?: (mail: OtpMail) => Promise<void> } = {}) {
  const sendOtp = opts.sendOtp ?? sendOtpEmail;
  const baseURL = process.env.PLATFORM_URL ?? 'http://localhost:3000';
  const cookieDomain = process.env.COOKIE_DOMAIN;
  return betterAuth({
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    user: {
      additionalFields: {
        role: { type: ['member', 'admin'], required: false, defaultValue: 'member', input: false },
      },
      changeEmail: { enabled: true },
    },
    databaseHooks: {
      user: {
        create: {
          // Role is decided once, at first login, from ADMIN_EMAILS. It lives on
          // the user id afterwards, so changing the email keeps it.
          before: async (u) => ({
            data: { ...u, role: adminEmails().includes(u.email.toLowerCase()) ? 'admin' : 'member' },
          }),
        },
      },
    },
    advanced: {
      crossSubDomainCookies: cookieDomain ? { enabled: true, domain: cookieDomain } : { enabled: false },
    },
    trustedOrigins: [baseURL],
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtp({ to: email, otp, type });
        },
      }),
      nextCookies(), // must stay last
    ],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let authPromise: Promise<Auth> | undefined;
export function getAuth(): Promise<Auth> {
  // Same as getDb(): a failed build (usually an unreachable database) must not be
  // cached, or every later request in this process inherits it.
  authPromise ??= getDb()
    .then((db) => buildAuth(db))
    .catch((e) => {
      authPromise = undefined;
      throw e;
    });
  return authPromise;
}
