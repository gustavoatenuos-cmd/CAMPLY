import { useEffect, useState, type ReactNode } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { fetchMetaPerformanceHierarchy, type HierarchicalMetricNode, type HierarchyResponse } from '../../lib/performance/metaPerformanceHierarchy';
import type { GlobalPerformanceAccount } from '../../lib/performance/globalPerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { deriveCostMetric } from '../../lib/performance/traceableMetrics';
import { isRunStale } from '../../lib/performance/campaignDecisionEligibility';
import { TraceableMetricValue } from '../performance/TraceableMetricValue';
import { CampaignActivityStatusBadge } from '../performance/CampaignActivityStatusBadge';

interface ClientCampaignDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  performance: EnrichedGlobalClientPerformance | null;
  period: DashboardPeriod;
}

type DrawerState =
  | { kind: 'loading' }
  | { kind: 'no_account' }
  | { kind: 'period_not_synced' }
  | { kind: 'unauthorized' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; response: HierarchyResponse };

// Contas sem clientMetaAssetId não têm vínculo analítico oficial e não podem
// ser usadas para buscar hierarquia — pular silenciosamente para a próxima.
function selectMetaAccount(performance: EnrichedGlobalClientPerformance | null): GlobalPerformanceAccount | null {
  if (!performance) return null;
  return performance.accounts.find((account) => Boolean(account.clientMetaAssetId)) ?? null;
}

export function ClientCampaignDrawer({ isOpen, onClose, performance, period }: ClientCampaignDrawerProps) {
  const [state, setState] = useState<DrawerState>({ kind: 'loading' });

  const account = selectMetaAccount(performance);
  const linkedAccountCount = performance?.accounts.filter((a) => a.clientMetaAssetId).length ?? 0;

  useEffect(() => {
    if (!isOpen || !performance) return;

    if (!account) {
      setState({ kind: 'no_account' });
      return;
    }

    let active = true;
    setState({ kind: 'loading' });

    fetchMetaPerformanceHierarchy(account.clientMetaAssetId, period, 'campaign', null, 1, 100)
      .then((response) => {
        if (!active) return;
        const hasAnyItems = response.items.length > 0
          || response.activeNoDeliveryItems.length > 0
          || response.activeWithoutActiveStructureItems.length > 0
          || response.pausedWithSpendItems.length > 0
          || response.unclassifiedDestinationItems.length > 0;

        if (response.state === 'period_not_synced') {
          setState({ kind: 'period_not_synced' });
        } else if (response.state === 'unauthorized') {
          setState({ kind: 'unauthorized' });
        } else if (response.state === 'empty' || !hasAnyItems) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', response });
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error('[ClientCampaignDrawer] Falha ao carregar hierarquia de campanhas:', err);
        setState({ kind: 'error', message: 'Não foi possível carregar as campanhas desta conta agora.' });
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, performance?.clientId, account?.clientMetaAssetId, period]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-all" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col transform transition-transform border-l border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col space-y-1.5 p-6 border-b">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-lg tracking-tight">Campanhas: {performance?.clientName}</h3>
            <button onClick={onClose} className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            Desempenho detalhado das campanhas sincronizadas
          </p>
          {linkedAccountCount > 1 && account && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
              Exibindo a primeira conta Meta vinculada: {account.accountName}.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6">
          {state.kind === 'loading' && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              <span>Carregando campanhas da Meta...</span>
            </div>
          )}

          {state.kind === 'no_account' && (
            <EmptyMessage>Conta Meta não vinculada.</EmptyMessage>
          )}

          {state.kind === 'period_not_synced' && (
            <EmptyMessage>Esse período ainda não foi sincronizado.</EmptyMessage>
          )}

          {state.kind === 'unauthorized' && (
            <EmptyMessage>Sem permissão para acessar esta conta Meta.</EmptyMessage>
          )}

          {state.kind === 'empty' && (
            <EmptyMessage>Nenhuma campanha encontrada no período.</EmptyMessage>
          )}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center justify-center h-full text-red-500 bg-red-50 p-6 rounded-lg text-center">
              <h4 className="font-bold mb-2">Falha no carregamento</h4>
              <p className="text-sm">{state.message}</p>
            </div>
          )}

          {state.kind === 'ready' && account && (
            <div className="space-y-4">
              {isRunStale(state.response.run ?? null) && state.response.run?.finishedAt && (
                <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  Sincronização antiga: usando o último snapshot confiável de{' '}
                  {new Date(state.response.run.finishedAt).toLocaleString('pt-BR')}.
                </div>
              )}
              {state.response.items.map((campaign) => (
                <CampaignRow key={campaign.id} campaign={campaign} account={account} />
              ))}
              {state.response.pausedWithSpendItems.length > 0 && (
                <CampaignBucketGroup
                  title="Pausadas com gasto"
                  items={state.response.pausedWithSpendItems}
                  account={account}
                />
              )}
              {state.response.activeNoDeliveryItems.length > 0 && (
                <CampaignBucketGroup
                  title="Ativas sem entrega"
                  items={state.response.activeNoDeliveryItems}
                  account={account}
                />
              )}
              {state.response.activeWithoutActiveStructureItems.length > 0 && (
                <CampaignBucketGroup
                  title="Ativas sem estrutura ativa"
                  items={state.response.activeWithoutActiveStructureItems}
                  account={account}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 bg-gray-50 p-6 rounded-lg text-center border border-dashed">
      <p>{children}</p>
    </div>
  );
}

function CampaignRow({ campaign, account }: { campaign: HierarchicalMetricNode; account: GlobalPerformanceAccount }) {
  const spendMetric = campaign.metrics.spend;
  const purchasesMetric = campaign.metrics.purchases;
  const roasMetric = campaign.metrics.purchase_roas;
  const cpaMetric = deriveCostMetric('cost_per_purchase', spendMetric, purchasesMetric);

  return (
    <div className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-medium text-gray-900 leading-tight mb-1 flex items-center gap-2">
            {campaign.name}
            <a
              href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.adAccountId}&selected_campaign_ids=${campaign.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-indigo-600 transition-colors"
              title="Abrir no Gerenciador de Anúncios"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </h4>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {campaign.verdict && <CampaignActivityStatusBadge verdict={campaign.verdict} />}
            <span>•</span>
            <span>{campaign.objective || 'Sem objetivo'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100">
        <MetricCell label="Gasto" value={formatCurrency(metricValue(spendMetric), account.currency)} metric={spendMetric} />
        <MetricCell label="Compras" value={formatNumber(metricValue(purchasesMetric))} metric={purchasesMetric} />
        <MetricCell label="CPA" value={formatCurrency(metricValue(cpaMetric), account.currency)} metric={cpaMetric} />
        <MetricCell label="ROAS" value={roasMetric?.available && roasMetric.value !== null ? `${roasMetric.value.toFixed(2)}x` : '—'} metric={roasMetric} />
      </div>
    </div>
  );
}

function CampaignBucketGroup({
  title,
  items,
  account,
}: {
  title: string;
  items: HierarchicalMetricNode[];
  account: GlobalPerformanceAccount;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">{title} ({items.length})</p>
      <div className="space-y-3">
        {items.map((campaign) => (
          <CampaignRow key={campaign.id} campaign={campaign} account={account} />
        ))}
      </div>
    </div>
  );
}

function MetricCell({ label, value, metric }: { label: string; value: string; metric: HierarchicalMetricNode['metrics'][string] | undefined }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-sm">
        <TraceableMetricValue metric={metric}>{value}</TraceableMetricValue>
      </div>
    </div>
  );
}

function metricValue(metric: HierarchicalMetricNode['metrics'][string] | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) return '—';
  if (!currency) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}
