import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { cspMetaPlugin } from '../../deploy/security-headers.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMetaPlugin('table')],
  server: { port: 5175, host: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Fonts stay files (never data: URIs), so the CSP's font-src 'self' needs no data:.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  resolve: { conditions: ['preflop-source'] },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
