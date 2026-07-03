import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('../supabase', () => ({ supabaseData: { rpc: rpcMock } }));
vi.mock('../meta/metaE2ERuntime', () => ({ isMetaE2EMode: false }));

import { defaultAnalysisProfile, saveAnalysisTemplate, suggestedGoalsForObjective } from './clientAnalysisProfile';

describe('custom analysis profile templates', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: {
        id: 'template-1', name: 'Meu modelo', vertical: 'Saúde', subsegment: 'Odontologia',
        primary_objective: 'whatsapp_messages', selected_metrics: ['cost_per_messaging_conversation'],
        target_defaults: suggestedGoalsForObjective('whatsapp_messages'),
        budget_period_default: 'weekly', budget_platform_default: 'meta',
      },
      error: null,
    });
  });

  const profile = () => ({
    ...defaultAnalysisProfile('client-1'), vertical: 'Saúde', subsegment: 'Odontologia',
    primaryObjective: 'whatsapp_messages' as const,
    performanceGoals: suggestedGoalsForObjective('whatsapp_messages'),
    budgetPeriod: 'weekly' as const,
  });

  it('creates a reusable custom template from the current profile', async () => {
    const result = await saveAnalysisTemplate('Meu modelo', profile());
    expect(result).toMatchObject({ id: 'template-1', custom: true, primaryObjective: 'whatsapp_messages' });
    expect(rpcMock).toHaveBeenCalledWith('save_analysis_profile_template', expect.objectContaining({ p_template_id: null, p_name: 'Meu modelo' }));
  });

  it('edits an owned template by sending its id to the secured RPC', async () => {
    await saveAnalysisTemplate('Meu modelo atualizado', profile(), 'template-1');
    expect(rpcMock).toHaveBeenCalledWith('save_analysis_profile_template', expect.objectContaining({ p_template_id: 'template-1', p_name: 'Meu modelo atualizado' }));
  });
});
