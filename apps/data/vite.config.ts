import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the server at /data. Hot reload: `pnpm --filter @ogp/data dev:hmr` (http://localhost:5174/data/).
const server = process.env.OGP_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  base: '/data/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // keep files during watch rebuilds, so pages loading meanwhile never miss an asset
    emptyOutDir: !process.argv.includes('--watch'),
    target: 'chrome120',
    sourcemap: true,
  },
  server: {
    port: 5174,
    proxy: { '/api': server, '/assets': server, '/ws': { target: server.replace(/^http/, 'ws'), ws: true } },
  },
});
