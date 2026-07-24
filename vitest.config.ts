import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Minimal vitest config. Tests live under test/ (excluded from the Next
// build/tsc via tsconfig) and resolve the '@' alias to src/ like the app does.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});
