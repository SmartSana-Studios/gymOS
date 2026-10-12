import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Story 19.11: test runner for apps/mobile, scoped to pure modules and
// services (react-native / expo modules are vi.mock'd in the tests).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
