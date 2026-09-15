import { getDb } from '@/db';
import { FlyClient } from '@/lib/fly';
import type { BoxDeps } from './service';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function boxDeps(): Promise<BoxDeps> {
  return {
    db: await getDb(),
    fly: new FlyClient({ token: env('FLY_API_TOKEN'), app: process.env.FLY_BOXES_APP ?? 'alversjo-boxes', region: 'arn' }),
    image: process.env.BOX_IMAGE ?? 'registry.fly.io/alversjo-boxes:latest',
    secrets: {
      claudeToken: env('BOX_CLAUDE_TOKEN'),
      ghTokenAdmin: env('BOX_GH_TOKEN_ADMIN'),
      ghTokenContributor: env('BOX_GH_TOKEN_CONTRIBUTOR'),
      flyToken: env('FLY_API_TOKEN'),
      resendKey: process.env.RESEND_API_KEY ?? '',
      cloudflareToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
    },
  };
}
