import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { requireBuildEnv } from '../../deploy/require-env.mjs';
import { cspMetaPlugin } from '../../deploy/security-headers.mjs';

export default defineConfig({
  // A production build without VITE_API_URL fails instead of shipping the localhost fallback.
  plugins: [react(), tailwindcss(), cspMetaPlugin('console'), requireBuildEnv()],
  server: { port: 5174 },
  build: {
    // Fonts stay files (never data: URIs), so the CSP's font-src 'self' needs no data:.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          query: ['@tanstack/react-query'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
