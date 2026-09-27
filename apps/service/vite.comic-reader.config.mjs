import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const serviceRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  configFile: false,
  root: serviceRoot,
  build: {
    outDir: resolve(serviceRoot, 'dist/activities/comic-reader'),
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(serviceRoot, 'src/activities/comic-offline-reader.ts'),
      name: 'SthStartComicReader',
      formats: ['iife'],
      fileName: () => 'reader.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
