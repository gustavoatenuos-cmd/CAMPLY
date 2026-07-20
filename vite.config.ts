/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const commitSha = process.env.VITE_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
const buildTime = process.env.VITE_BUILD_TIME || new Date().toISOString();
const deployEnv = process.env.VITE_DEPLOY_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown';

export default defineConfig({
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
    'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(deployEnv),
  },
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
