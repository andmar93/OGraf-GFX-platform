import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the server at /editor. Hot reload: `pnpm --filter @ogp/editor dev:hmr` (http://localhost:5175/editor/).
const server = process.env.OGP_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  base: '/editor/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // keep files during watch rebuilds, so pages loading meanwhile never miss an asset
    emptyOutDir: !process.argv.includes('--watch'),
    target: 'chrome120',
    sourcemap: true,
  },
  server: {
    port: 5175,
    proxy: { '/api': server, '/assets': server, '/renderer': server, '/packages': server, '/ws': { target: server.replace(/^http/, 'ws'), ws: true } },
  },
});
