import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { fetchMetaPerformanceHierarchy, type HierarchicalMetricNode } from '../../lib/performance/metaPerformanceHierarchy';
import type { GlobalPerformanceAccount } from '../../lib/performance/globalPerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { TraceableMetricValue } from '../performance/TraceableMetricValue';
import { evaluateClientOperationalReadiness } from '../../lib/operational/clientOperationalReadiness';
import { getCampaignMetricCellsByObjective } from '../../lib/performance/campaignMetricCells';
import { buildClientAnalyticsDecision, deriveMonthPeriod } from '../../lib/performance/clientAnalyticsDecision';
import { ClientAnalyticsStatusPanel } from './ClientAnalyticsStatusPanel';

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
  | { kind: 'ready'; items: HierarchicalMetricNode[] };

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

  // Mesmo motor de decisão usado no card resumo (ClientAnalyticsCard) - o
  // drill-down de campanhas não pode perder a meta/gap/projeção/diagnóstico
  // que o cliente configurou, só porque o usuário abriu o detalhe.
  const decision = useMemo(() => {
    if (!performance) return null;
    const now = new Date();
    return buildClientAnalyticsDecision({
      client: performance.client ?? { id: performance.clientId, name: performance.clientName, company: '' },
      analysisProfile: performance.analysisProfile,
      globalPerformance: {
        clientStatus: performance.clientStatus,
        dataQuality: performance.dataQuality,
        lastSuccessfulRun: performance.lastSuccessfulRun,
      },
      accountMetrics: performance.metrics ?? {},
      metricGroups: performance.metricGroups ?? [],
      resolvedTargets: performance.resolvedTargets ?? [],
      period: deriveMonthPeriod(now),
      currentDate: now,
    });
  }, [performance]);

  const readiness = useMemo(() => {
    if (!performance) return null;
    return evaluateClientOperationalReadiness({
      clientId: performance.clientId,
      client: performance.client ?? null,
      analysisProfile: performance.analysisProfile,
      globalClientStatus: performance.clientStatus,
      receivableEntries: undefined,
      analyticsDecision: decision,
    });
  }, [performance, decision]);

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
        if (response.state === 'period_not_synced') {
          setState({ kind: 'period_not_synced' });
        } else if (response.state === 'unauthorized') {
          setState({ kind: 'unauthorized' });
        } else if (response.state === 'empty' || response.items.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', items: response.items });
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
          {decision && (
            <div className="pt-2">
              <ClientAnalyticsStatusPanel decision={decision} />
            </div>
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
              {readiness && (readiness.campaigns.status === 'partial' || readiness.campaigns.status === 'stale') && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  {readiness.campaigns.warnings.join(' ') || 'Dados da campanha podem estar incompletos.'}
                </div>
              )}
              {state.items.map((campaign) => (
                <CampaignRow key={campaign.id} campaign={campaign} account={account} />
              ))}
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
  const status = campaign.effectiveStatus || campaign.status;
  const cells = getCampaignMetricCellsByObjective(campaign.classifiedObjective, campaign.metrics, account.currency);

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
            <span className={`px-2 py-0.5 rounded-full ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
              {status}
            </span>
            <span>•</span>
            <span>{campaign.classifiedObjective || campaign.objective || 'Sem objetivo'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100">
        {cells.map((c) => (
          <MetricCell key={c.key} label={c.label} value={c.value} metric={c.metric} />
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

