import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['.sg2.manus.computer'] },
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: { input: { main: resolve(process.cwd(), 'index.html'), voiceClone: resolve(process.cwd(), 'voice-clone.html') } },
  },
});
