import type { BoxProfile } from '@/db/schema';

export interface BoxSecrets {
  claudeToken: string; ghTokenAdmin: string; ghTokenContributor: string;
  flyToken: string; resendKey: string; cloudflareToken: string;
}

/** Exactly the env a box of the given profile receives. Spec §3 table. */
export function boxEnv(profile: BoxProfile, s: BoxSecrets, jwtSecret: string): Record<string, string> {
  const base = { BOX_PROFILE: profile, JWT_SECRET: jwtSecret, CLAUDE_CODE_OAUTH_TOKEN: s.claudeToken };
  if (profile === 'contributor') return { ...base, GH_TOKEN: s.ghTokenContributor };
  return { ...base, GH_TOKEN: s.ghTokenAdmin, FLY_API_TOKEN: s.flyToken, RESEND_API_KEY: s.resendKey, CLOUDFLARE_API_TOKEN: s.cloudflareToken };
}
