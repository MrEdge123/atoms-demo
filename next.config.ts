import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'esbuild',
    '@electric-sql/pglite',
    'pg',
    'tailwindcss',
  ],
};

export default nextConfig;
