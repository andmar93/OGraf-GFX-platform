import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The renderer is served by the server at /renderer/* (assets) and /render/:channelId (page).
export default defineConfig({
  base: '/renderer/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
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
