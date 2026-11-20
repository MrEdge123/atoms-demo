import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'esbuild',
    '@electric-sql/pglite',
    'pg',
    'tailwindcss',
  ],
};

export default nextConfig;
