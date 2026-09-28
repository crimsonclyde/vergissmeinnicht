import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    // The contrast test reads the real theme tokens (`styles.css?raw`); other CSS stays unprocessed.
    css: { include: [/apps\/web\/src\/styles\.css/] },
  },
});
