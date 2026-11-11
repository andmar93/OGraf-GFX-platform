import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The renderer is served by the server at /renderer/* (assets) and /render/:channelId (page).
export default defineConfig({
  base: '/renderer/',
  build: {
    outDir: 'dist',
    // keep files during watch rebuilds, so pages loading meanwhile never miss an asset
    emptyOutDir: !process.argv.includes('--watch'),
    // Chromium-based hosts only (CasparCG 2.5 CEF, vMix, OBS browser source, Chrome/Edge).
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        layer: resolve(import.meta.dirname, 'layer.html'),
      },
    },
  },
});
