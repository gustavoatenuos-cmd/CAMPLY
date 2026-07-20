import packageInfo from '../../../package.json';

export interface CamplyBuildInfo {
  commitSha: string;
  buildTime: string;
  deployEnv: string;
  appVersion: string;
}

export function getCamplyBuildInfo(): CamplyBuildInfo {
  return {
    commitSha: import.meta.env.VITE_COMMIT_SHA
      || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA
      || 'unknown',
    buildTime: import.meta.env.VITE_BUILD_TIME || 'unknown',
    deployEnv: import.meta.env.VITE_DEPLOY_ENV
      || import.meta.env.VITE_VERCEL_ENV
      || import.meta.env.MODE
      || 'unknown',
    appVersion: packageInfo.version,
  };
}

declare global {
  interface Window {
    CAMPLY_DIAGNOSTICS?: {
      build: CamplyBuildInfo;
      session: {
        userId: string | null;
        email: string | null;
        supabaseSessionExpiresAt: string | null;
      };
      selectedPeriod: string;
    };
  }
}
