import { describe, expect, it } from 'vitest';
import type { Client } from '../../types';
import type { ClientMetaAccount } from './clientMetaAssetService';
import type { HierarchicalMetricNode } from '../performance/metaPerformanceHierarchy';
import { buildMetaBoard } from './metaCampaignBoard';
import { objectiveDetailLabel, objectiveGroupFor } from './campaignObjectiveGroups';
import { compareCellWithBenchmark } from './campaignBenchmarks';
import { CLIENT_COLOR_PALETTE, clientColor } from '../clientColors';
import { getCampaignMetricCellsByObjective } from '../performance/campaignMetricCells';

const client = (id: string, extra: Partial<Client> = {}): Client => ({
  id, projectId: 'p', name: id, company: `Empresa ${id}`, segment: '', structure: '', hasProject: false,
  contact: '', monthlyFee: 0, managementFeeType: 'recurring', dueDay: 10, adInvestmentPeriod: 'monthly',
  adInvestmentMeta: 0, adInvestmentGoogle: 0, adInvestmentYoutube: 0, adInvestmentTikTok: 0, status: 'active',
  ...extra,
} as Client);

const account = (link: string): ClientMetaAccount => ({
  clientMetaAssetId: link, metaAssetId: `asset-${link}`, integrationId: 'i', adAccountId: `act_${link}`,
  accountName: `Conta ${link}`, currency: 'BRL', timezone: 'America/Sao_Paulo', assetStatus: 'ACTIVE',
  linkedAt: '2026-09-01T00:00:00Z', availablePeriods: ['last_90d'], lastAttempt: null, lastSuccess: null,
});

const metric = (value: number) => ({ value, available: true, completenessStatus: 'complete' }) as never;

const node = (id: string, spend: number, extra: Partial<HierarchicalMetricNode> = {}): HierarchicalMetricNode => ({
  id, name: id, status: 'ACTIVE', effectiveStatus: 'ACTIVE', objective: 'OUTCOME_SALES', classifiedObjective: 'SALES',
  destinationType: null, attributionSetting: null, creativeId: null,
  metrics: { spend: metric(spend) },
  ...extra,
});

describe('objectiveGroupFor', () => {
  it('uses the Meta (ODAX) objective to pick the column', () => {
    expect(objectiveGroupFor('OUTCOME_SALES', 'SALES')).toBe('sales');
    expect(objectiveGroupFor('OUTCOME_ENGAGEMENT', 'WHATSAPP')).toBe('engagement');
    expect(objectiveGroupFor('OUTCOME_LEADS', 'WHATSAPP')).toBe('leads');
    expect(objectiveGroupFor('OUTCOME_TRAFFIC', 'PROFILE_VISITS')).toBe('traffic');
    expect(objectiveGroupFor('outcome_awareness', null)).toBe('awareness');
  });

  it('maps legacy objectives and falls back to the classified objective', () => {
    expect(objectiveGroupFor('CONVERSIONS', null)).toBe('sales');
    expect(objectiveGroupFor('LINK_CLICKS', null)).toBe('traffic');
    expect(objectiveGroupFor('MESSAGES', null)).toBe('engagement');
    expect(objectiveGroupFor(null, 'LEADS')).toBe('leads');
    expect(objectiveGroupFor(null, 'UNCLASSIFIED')).toBe('other');
    expect(objectiveGroupFor('', null)).toBe('other');
  });

  it('only shows a detail label when it adds information to the column', () => {
    expect(objectiveDetailLabel('WHATSAPP', 'engagement')).toBe('WhatsApp');
    expect(objectiveDetailLabel('SALES', 'sales')).toBeNull();
    expect(objectiveDetailLabel('LEADS', 'leads')).toBeNull();
    expect(objectiveDetailLabel('LEADS', 'engagement')).toBe('Leads');
    expect(objectiveDetailLabel('PROFILE_VISITS', 'traffic')).toBe('Visitas ao perfil');
    expect(objectiveDetailLabel('UNCLASSIFIED', 'other')).toBeNull();
  });
});

describe('clientColor', () => {
  it('returns the chosen palette colour or a stable automatic one', () => {
    expect(clientColor({ id: 'a', color: '#3B82F6' })).toBe('#3b82f6');
    const auto = clientColor({ id: 'cliente-x' });
    expect(CLIENT_COLOR_PALETTE.map((c) => c.value)).toContain(auto);
    expect(clientColor({ id: 'cliente-x', color: 'not-a-colour' })).toBe(auto);
  });
});

describe('compareCellWithBenchmark', () => {
  const cells = getCampaignMetricCellsByObjective('SALES', {
    spend: metric(100), purchases: metric(4), purchase_roas: metric(3),
  } as never, 'BRL');
  const cpa = cells.find((c) => c.key === 'cpa')!;
  const roas = cells.find((c) => c.key === 'purchase_roas')!;

  it('flags cost metrics above the target and ratios below it', () => {
    expect(compareCellWithBenchmark(cpa, { cpa: 30 })).toEqual({ target: 30, status: 'good' });
    expect(compareCellWithBenchmark(cpa, { cpa: 20 })).toEqual({ target: 20, status: 'bad' });
    expect(compareCellWithBenchmark(roas, { roas: 2 })?.status).toBe('good');
    expect(compareCellWithBenchmark(roas, { roas: 4 })?.status).toBe('bad');
  });

  it('never judges without a reference or a real value', () => {
    expect(compareCellWithBenchmark(cpa, undefined)).toBeNull();
    expect(compareCellWithBenchmark(cpa, { roas: 2 })).toBeNull();
    const spend = cells.find((c) => c.key === 'spend')!;
    expect(compareCellWithBenchmark(spend, { cpa: 10 })).toBeNull();
  });
});

describe('buildMetaBoard', () => {
  const clients = [client('c1'), client('c2'), client('c3')];
  const catalog = {
    clients: [
      { clientId: 'c1', clientName: 'c1', accounts: [account('l1')] },
      { clientId: 'c2', clientName: 'c2', accounts: [account('l2')] },
      { clientId: 'c3', clientName: 'c3', accounts: [] },
    ],
    availableAssets: [],
  };

  it('merges every client account, sorts by spend and reports gaps', () => {
    const result = buildMetaBoard(clients, catalog, [
      { clientId: 'c1', account: account('l1'), response: { state: 'ready', total: 3, items: [
        node('idle', 0),
        node('paused_spent', 50, { status: 'PAUSED', effectiveStatus: 'PAUSED', objective: 'OUTCOME_TRAFFIC', classifiedObjective: 'TRAFFIC' }),
      ] } },
      { clientId: 'c2', account: account('l2'), response: { state: 'period_not_synced', total: 0, items: [] } },
    ]);

    expect(result.campaigns.map((c) => c.campaign.id)).toEqual(['paused_spent', 'idle']);
    expect(result.campaigns[0]).toMatchObject({ group: 'traffic', isActive: false, hasDelivery: true, spend: 50 });
    expect(result.campaigns[1]).toMatchObject({ group: 'sales', isActive: true, hasDelivery: false });
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'period_not_synced', client: clients[1] })]);
    expect(result.clientsWithoutAccount).toEqual([clients[2]]);
    expect(result.truncatedAccounts).toEqual([expect.objectContaining({ total: 3 })]);
  });

  it('turns a failed or malformed response into an issue instead of crashing', () => {
    const result = buildMetaBoard(clients, catalog, [
      { clientId: 'c1', account: account('l1'), error: new Error('boom') },
      { clientId: 'c2', account: account('l2'), response: { error: 'asset_not_found' } as never },
    ]);
    expect(result.campaigns).toEqual([]);
    expect(result.issues.map((issue) => issue.kind)).toEqual(['error', 'error']);
  });
});
