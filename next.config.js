/** @type {import('next').NextConfig} */
module.exports = {
  // The embedded local-development database is never bundled; Vercel uses DATABASE_URL instead.
  serverExternalPackages: ['@electric-sql/pglite'],
  // The runner is a separate program for team PCs, not part of the website build.
  outputFileTracingExcludes: { '*': ['./runner/**'] },
};
