import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5175, host: true },
  build: { target: 'es2022', sourcemap: true },
  resolve: { conditions: ['preflop-source'] },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
