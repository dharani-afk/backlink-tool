/** @type {import('next').NextConfig} */
module.exports = {
  // The embedded local-development database is never bundled; Vercel uses DATABASE_URL instead.
  serverExternalPackages: ['@electric-sql/pglite'],
  // The runner is a separate program for team PCs, not part of the website build.
  outputFileTracingExcludes: { '*': ['./runner/**'] },
  // The Windows runner installer is fetched by PowerShell (irm), which needs it as text.
  async headers() {
    return [{ source: '/install.ps1', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }, { key: 'Cache-Control', value: 'no-cache' }] }];
  },
};
