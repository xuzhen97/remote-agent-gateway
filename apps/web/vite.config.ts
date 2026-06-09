import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000', '/admin': 'http://localhost:3000', '/updates': 'http://localhost:3000' } },
});
