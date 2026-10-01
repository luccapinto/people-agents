/** Static demo build: no back-end, served from any sub-path (`VITE_BASE=/x/`). */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { brandingMeta } from './vite.meta';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.VITE_BASE ?? '/atrium-demo/';

export default defineConfig({
  base,
  plugins: [react(), brandingMeta({ demo: true })],
  define: {
    'import.meta.env.VITE_DEMO': JSON.stringify(process.env.VITE_DEMO ?? '1'),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    // The fictional dataset is large; it is loaded lazily and must stay out of the entry chunk.
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: 0,
  },
  server: {
    fs: { allow: [repoRoot] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
});
