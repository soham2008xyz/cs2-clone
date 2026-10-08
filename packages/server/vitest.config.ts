import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // lcov paths relative to the repo root so SonarCloud can map them
      reporter: ['text-summary', ['lcov', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }]],
      reportsDirectory: 'coverage',
    },
  },
});
