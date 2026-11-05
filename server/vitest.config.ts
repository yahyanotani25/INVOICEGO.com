import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
  },
});
