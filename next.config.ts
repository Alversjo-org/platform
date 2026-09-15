import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the pg/PGlite drivers as plain Node requires instead of letting the
  // Server Components bundler rewrite them: bundling triggers a Turbopack
  // dev-time instrumentation of process.cwd()/path.resolve() (for filesystem
  // access tracing) that breaks PGlite's file-backed migration path when a
  // Server Component (as opposed to a Route Handler) calls getDb() first.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
};

export default nextConfig;
