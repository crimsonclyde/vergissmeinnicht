import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    // The contrast test reads the real theme tokens (`styles.css?raw`) and the surfaces the presets paint
    // themselves (`tokyo-nights.css?raw`, `witch-forest.css?raw`); including the everyday theme tint; other CSS stays unprocessed.
    css: { include: [/apps\/web\/src\/everyday-themes\.css/, /apps\/web\/src\/styles\.css/, /apps\/web\/src\/tokyo-nights\.css/, /apps\/web\/src\/witch-forest\.css/, /apps\/web\/src\/places\.css/, /apps\/web\/src\/celestial\.css/] },
  },
});
