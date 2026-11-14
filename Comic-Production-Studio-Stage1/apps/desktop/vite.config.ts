import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import path from 'node:path';
export default defineConfig({root:__dirname,base:'./',plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true},build:{outDir:'dist',emptyOutDir:true},resolve:{alias:{'@contracts':path.resolve(__dirname,'../../packages/contracts/src')}}});
