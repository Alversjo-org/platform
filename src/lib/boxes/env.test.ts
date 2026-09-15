import { describe, expect, it } from 'vitest';
import { boxEnv, type BoxSecrets } from './env';

const secrets: BoxSecrets = {
  claudeToken: 'claude', ghTokenAdmin: 'gh-admin', ghTokenContributor: 'gh-contrib',
  flyToken: 'fly', resendKey: 'resend', cloudflareToken: 'cf',
};

describe('boxEnv', () => {
  it('admin gets every token', () => {
    expect(boxEnv('admin', secrets, 'jwt')).toEqual({
      BOX_PROFILE: 'admin', JWT_SECRET: 'jwt', CLAUDE_CODE_OAUTH_TOKEN: 'claude', GH_TOKEN: 'gh-admin',
      FLY_API_TOKEN: 'fly', RESEND_API_KEY: 'resend', CLOUDFLARE_API_TOKEN: 'cf',
    });
  });

  it('contributor gets only Claude, the bot GitHub token and the JWT secret', () => {
    expect(boxEnv('contributor', secrets, 'jwt')).toEqual({
      BOX_PROFILE: 'contributor', JWT_SECRET: 'jwt', CLAUDE_CODE_OAUTH_TOKEN: 'claude', GH_TOKEN: 'gh-contrib',
    });
  });
});
