import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const conditions = ['preflop-source', ...defaultServerConditions];
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: ['preflop-source'] } },
  test: { testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
