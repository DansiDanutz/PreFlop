import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';
import { requireBuildEnv } from '../../deploy/require-env.mjs';
import { cspMetaPlugin } from '../../deploy/security-headers.mjs';

export default defineConfig({
  // A production build without VITE_API_URL fails instead of shipping the localhost fallback.
  plugins: [react(), tailwindcss(), cspMetaPlugin('web'), requireBuildEnv()],
  // Workspace packages (the odds engine) are bundled from their TypeScript source.
  resolve: { conditions: ['preflop-source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['preflop-source', ...defaultServerConditions], externalConditions: ['preflop-source'] } },
  server: { port: 5173 },
  build: {
    // Fonts stay files (never data: URIs), so the CSP's font-src 'self' needs no data:.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
