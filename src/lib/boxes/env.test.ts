import { describe, expect, it } from 'vitest';
import { boxEnv, type BoxSecrets } from './env';

const secrets: BoxSecrets = {
  claudeToken: 'claude', ghTokenAdmin: 'gh-admin', ghTokenContributor: 'gh-contrib',
  flyToken: 'fly', resendKey: 'resend', cloudflareToken: 'cf',
};

describe('boxEnv', () => {
  it('admin gets every token', () => {
    expect(boxEnv('admin', secrets, 'jwt', 'owner@example.org')).toEqual({
      BOX_PROFILE: 'admin', JWT_SECRET: 'jwt', CLAUDE_CODE_OAUTH_TOKEN: 'claude', GH_TOKEN: 'gh-admin',
      FLY_API_TOKEN: 'fly', RESEND_API_KEY: 'resend', CLOUDFLARE_API_TOKEN: 'cf', OWNER_EMAIL: 'owner@example.org',
    });
  });

  it('contributor gets only Claude, the bot GitHub token, the JWT secret and the owner email', () => {
    expect(boxEnv('contributor', secrets, 'jwt', 'owner@example.org')).toEqual({
      BOX_PROFILE: 'contributor', JWT_SECRET: 'jwt', CLAUDE_CODE_OAUTH_TOKEN: 'claude', GH_TOKEN: 'gh-contrib',
      OWNER_EMAIL: 'owner@example.org',
    });
  });
});
