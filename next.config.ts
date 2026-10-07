import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the pg/PGlite drivers as plain Node requires instead of letting the
  // Server Components bundler rewrite them: bundling triggers a Turbopack
  // dev-time instrumentation of process.cwd()/path.resolve() (for filesystem
  // access tracing) that breaks PGlite's file-backed migration path when a
  // Server Component (as opposed to a Route Handler) calls getDb() first.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],

  // Nothing here is ever meant to be framed. Both headers are sent: the CSP
  // directive is what modern browsers honour, X-Frame-Options is the fallback.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },

  // Must stay above the profile action's own MAX_AVATAR_BYTES (5MB) — the multipart
  // request also carries the other form fields and boundaries, and if this limit is
  // ever at or below that constant, the framework rejects the upload first and the
  // action's own friendlier "too large" error never gets a chance to fire.
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
