import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cspMetaPlugin } from '../../deploy/security-headers.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMetaPlugin('console')],
  server: { port: 5174 },
  build: {
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
