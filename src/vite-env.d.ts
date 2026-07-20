/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_META_E2E_MODE?: string;
  readonly VITE_MASTER_LOGIN_EMAIL?: string;
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_VERCEL_GIT_COMMIT_SHA?: string;
  readonly VITE_BUILD_TIME?: string;
  readonly VITE_DEPLOY_ENV?: string;
  readonly VITE_VERCEL_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
