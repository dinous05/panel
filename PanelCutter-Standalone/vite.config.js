import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const ortRuntimeAssets = {
  name: 'panel-cutter-ort-assets',
  apply: 'build',
  closeBundle() {
    const destination = path.resolve('dist/assets');
    mkdirSync(destination, { recursive: true });
    copyFileSync(
      path.resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'),
      path.join(destination, 'ort-wasm-simd-threaded.mjs'),
    );
  },
};

export default defineConfig({
  plugins: [ortRuntimeAssets],
  base: './',
  optimizeDeps: { exclude: ['onnxruntime-web/wasm'] },
  build: { outDir: 'dist', emptyOutDir: true },
});
