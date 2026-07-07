/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './supabase/functions/_shared'),
    },
  },
  test: {
    // Ferramentas locais clonadas em .agents/ trazem suítes próprias que não
    // pertencem ao projeto — sem este exclude o vitest as executa junto.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.agents/**',
      '**/scratch/**',
      '**/supabase/.temp/**',
    ],
  },
});
