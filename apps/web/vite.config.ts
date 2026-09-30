import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { thirdPartyNotices } from './third-party-notices.ts';

export default defineConfig({
  plugins: [react(), thirdPartyNotices()],
  build: {
    rolldownOptions: {
      output: {
        // The icon catalogue (Tabler artwork the registry imports, the generated labels and search words,
        // the drawn icons) in its own chunk: it changes rarely, so browsers keep it cached across app updates.
        codeSplitting: {
          groups: [{ name: 'icons', test: /[\\/]node_modules[\\/]@tabler[\\/]|[\\/]src[\\/](icon-catalog\.generated\.ts|icon-art\.tsx)$/ }],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    // In development the API runs as a separate process; production serves both from one origin.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
