import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
        env.VITE_SUPABASE_URL ||
        env.Supabase_project_url ||
        env.SUPABASE_PROJECT_URL ||
        'https://kunabampibfcmnbyjads.supabase.co'
      ),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
        env.VITE_SUPABASE_ANON_KEY ||
        env.Supabase_anon_key ||
        env.SUPABASE_ANON_KEY ||
        env.Supabase_publishable_key ||
        ''
      ),
      'import.meta.env.VITE_SUPABASE_PROJECT_ID': JSON.stringify(
        env.VITE_SUPABASE_PROJECT_ID ||
        env.Supabase_project_id ||
        'kunabampibfcmnbyjads'
      ),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
        env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        env.Supabase_publishable_key ||
        ''
      ),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
