import { defineConfig } from 'vite';

// root: 'src' keeps the source index.html out of the deploy path.
// The built output (dist/) gets copied to the repo root for GH Pages.
export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
