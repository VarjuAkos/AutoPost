import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.AUTOPOST_BUILD_DIR || '.next',
  serverExternalPackages: ['better-sqlite3', 'sharp', 'archiver', 'exifr'],
  poweredByHeader: false,
  outputFileTracingExcludes: { '/*': ['./data/**/*', './.test-data/**/*', './.env*', './test-results/**/*', './.next-e2e/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};

export default config;
