import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('node_modules')) {
      if (/[/\\]@lezer[/\\](common|lr|highlight)[/\\]/.test(id)) return 'editor';
      if (id.includes('@codemirror/lang-') || id.includes('@lezer/')) return 'language-support';
      if (id.includes('codemirror')) return 'editor';
      if (id.includes('@supabase')) return 'supabase';
    }
  } } } },
});
