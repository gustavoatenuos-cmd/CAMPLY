import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseData: null }));
vi.mock('../meta/metaE2ERuntime', () => ({ isMetaE2EMode: false }));

import { defaultAnalysisProfile, upsertClientAnalysisProfile } from './clientAnalysisProfile';

describe('client analysis profile persistence', () => {
  it('does not claim a profile was saved when the backend is unavailable', async () => {
    await expect(upsertClientAnalysisProfile(defaultAnalysisProfile('client-1')))
      .rejects.toThrow('O perfil não foi salvo');
  });
});
