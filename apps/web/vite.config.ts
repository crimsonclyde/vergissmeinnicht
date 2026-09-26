import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // In development the API runs as a separate process; production serves both from one origin.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
