import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the server at /player. For UI work with hot reload: `pnpm --filter @ogp/player dev:hmr`
// (http://localhost:5173/player/, everything else is proxied to the server on :8080).
const server = process.env.OGP_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  base: '/player/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome120', sourcemap: true },
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/ograf': server,
      '/packages': server,
      '/renderer': server,
      '/render': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
});
