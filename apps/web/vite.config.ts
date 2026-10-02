import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { cspMetaPlugin } from '../../deploy/security-headers.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMetaPlugin('web')],
  server: { port: 5173 },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
