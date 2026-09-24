import type { Client } from '../../types';
import type { DashboardPeriod } from '../performance/analyticsCapabilities';
import { fetchMetaPerformanceHierarchy, type HierarchicalMetricNode, type HierarchyResponse } from '../performance/metaPerformanceHierarchy';
import { loadClientMetaAssetCatalog, type ClientMetaAccount, type ClientMetaAssetCatalog } from './clientMetaAssetService';
import { objectiveGroupFor, type ObjectiveGroupId } from './campaignObjectiveGroups';

export const BOARD_PAGE_SIZE = 100;

export interface MetaBoardCampaign {
  key: string;
  client: Client;
  account: ClientMetaAccount;
  campaign: HierarchicalMetricNode;
  group: ObjectiveGroupId;
  spend: number;
  isActive: boolean;
  hasDelivery: boolean;
}

export interface MetaBoardAccountIssue {
  client: Client;
  account: ClientMetaAccount;
  kind: 'period_not_synced' | 'unauthorized' | 'error';
  message: string;
}

export interface MetaBoardResult {
  campaigns: MetaBoardCampaign[];
  issues: MetaBoardAccountIssue[];
  /** Active clients that have no Meta ad account linked. */
  clientsWithoutAccount: Client[];
  /** Accounts where not every current ACTIVE campaign could be loaded. */
  truncatedAccounts: Array<{ client: Client; account: ClientMetaAccount; activeTotal: number; loadedActive: number }>;
}

function metricNumber(node: HierarchicalMetricNode, metricId: string): number {
  const metric = node.metrics?.[metricId];
  return metric?.available && typeof metric.value === 'number' && Number.isFinite(metric.value) ? metric.value : 0;
}

export function isCampaignActive(node: Pick<HierarchicalMetricNode, 'effectiveStatus' | 'status'>): boolean {
  return (node.effectiveStatus || node.status || '').toUpperCase() === 'ACTIVE';
}

export function toBoardCampaign(client: Client, account: ClientMetaAccount, campaign: HierarchicalMetricNode): MetaBoardCampaign {
  const spend = metricNumber(campaign, 'spend');
  return {
    key: `${account.clientMetaAssetId}:${campaign.id}`,
    client,
    account,
    campaign,
    group: objectiveGroupFor(campaign.objective, campaign.classifiedObjective),
    spend,
    isActive: isCampaignActive(campaign),
    hasDelivery: spend > 0,
  };
}

/** Delivering campaigns first (by spend), then active ones without delivery, by name. */
export function sortBoardCampaigns(items: MetaBoardCampaign[]): MetaBoardCampaign[] {
  return [...items].sort((a, b) => {
    if (b.spend !== a.spend) return b.spend - a.spend;
    return a.campaign.name.localeCompare(b.campaign.name, 'pt-BR');
  });
}

export function buildMetaBoard(
  clients: Client[],
  catalog: ClientMetaAssetCatalog,
  responses: Array<{ clientId: string; account: ClientMetaAccount; response?: HierarchyResponse; error?: unknown }>,
): MetaBoardResult {
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const withAccount = new Set(
    catalog.clients.filter((entry) => entry.accounts.length > 0).map((entry) => entry.clientId),
  );
  const result: MetaBoardResult = {
    campaigns: [],
    issues: [],
    clientsWithoutAccount: clients.filter((client) => !withAccount.has(client.id)),
    truncatedAccounts: [],
  };

  for (const { clientId, account, response, error } of responses) {
    const client = clientById.get(clientId);
    if (!client) continue;
    if (error || !response) {
      result.issues.push({ client, account, kind: 'error', message: 'Não foi possível carregar as campanhas desta conta agora.' });
      continue;
    }
    if (response.state === 'period_not_synced') {
      result.issues.push({ client, account, kind: 'period_not_synced', message: 'Conta ainda sem sincronização dos últimos 90 dias.' });
      continue;
    }
    if (response.state === 'unauthorized') {
      result.issues.push({ client, account, kind: 'unauthorized', message: 'Sem permissão para ler esta conta Meta.' });
      continue;
    }
    if (response.state !== 'ready' && response.state !== 'empty') {
      result.issues.push({ client, account, kind: 'error', message: 'Resposta inesperada ao ler esta conta Meta.' });
      continue;
    }
    const items = Array.isArray(response.items) ? response.items : [];
    const activeItems = items.filter(isCampaignActive);
    for (const campaign of activeItems) {
      result.campaigns.push(toBoardCampaign(client, account, campaign));
    }
    const activeTotal = typeof response.activeTotal === 'number' && Number.isFinite(response.activeTotal)
      ? response.activeTotal
      : activeItems.length;
    if (activeTotal > activeItems.length) {
      result.truncatedAccounts.push({ client, account, activeTotal, loadedActive: activeItems.length });
    }
  }

  result.campaigns = sortBoardCampaigns(result.campaigns);
  return result;
}

export async function loadMetaCampaignBoard(clients: Client[], period: DashboardPeriod): Promise<MetaBoardResult> {
  const catalog = await loadClientMetaAssetCatalog();
  const clientIds = new Set(clients.map((client) => client.id));
  const jobs = catalog.clients
    .filter((entry) => clientIds.has(entry.clientId))
    .flatMap((entry) => entry.accounts
      .filter((account) => Boolean(account.clientMetaAssetId))
      .map((account) => ({ clientId: entry.clientId, account })));

  const responses = await Promise.all(jobs.map(async (job) => {
    try {
      const first = await fetchMetaPerformanceHierarchy(
        job.account.clientMetaAssetId,
        period,
        'campaign',
        null,
        1,
        BOARD_PAGE_SIZE,
      );

      if (first.state !== 'ready' || typeof first.activeTotal !== 'number') {
        return { ...job, response: first };
      }

      const items = [...first.items];
      let loadedActive = items.filter(isCampaignActive).length;
      const maxPages = Math.max(1, Math.ceil(first.total / BOARD_PAGE_SIZE));

      for (let page = 2; loadedActive < first.activeTotal && page <= maxPages; page += 1) {
        try {
          const next = await fetchMetaPerformanceHierarchy(
            job.account.clientMetaAssetId,
            period,
            'campaign',
            null,
            page,
            BOARD_PAGE_SIZE,
          );
          if (next.state !== 'ready' || next.items.length === 0) break;
          items.push(...next.items);
          loadedActive = items.filter(isCampaignActive).length;
        } catch (pageError) {
          console.warn('[MetaCampaignBoard] Falha ao completar campanhas ativas', job.account.adAccountId, pageError);
          break;
        }
      }

      return { ...job, response: { ...first, items } };
    } catch (error) {
      console.error('[MetaCampaignBoard] Falha ao carregar campanhas da conta', job.account.adAccountId, error);
      return { ...job, error };
    }
  }));

  return buildMetaBoard(clients, catalog, responses);
}
