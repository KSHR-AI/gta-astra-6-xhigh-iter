import { defineConfig } from 'vite';
import { compactCharacterModels } from './scripts/compact-character-models.js';

export default defineConfig({
  plugins: [compactCharacterModels()],
  server: { host: '0.0.0.0', port: 3000, allowedHosts: ['.preview.niteshift.dev'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
