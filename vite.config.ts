import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  optimizeDeps: {
    include: [
      '@base-ui/react/select',
      '@base-ui/react/slider',
      '@base-ui/react/switch',
      '@base-ui/react/radio',
      '@base-ui/react/radio-group',
    ],
  },
  plugins: [react(), cloudflare()],
});
