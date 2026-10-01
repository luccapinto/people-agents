/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { brandingMeta } from './vite.meta';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), brandingMeta()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
