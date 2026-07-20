import { useMemo, useState, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { periodLabels } from '../../lib/performance/analyticsCapabilities';
import type { GlobalClientStatus } from '../../lib/performance/globalPerformanceDashboard';
import { buildClientAnalyticsDecision, periodFromDashboardPeriod, type ClientAnalyticsDecision } from '../../lib/performance/clientAnalyticsDecision';
import { explainDashboardClientSync } from '../../lib/performance/explainClientSyncState';
import { metricLabels } from '../../lib/analysis/clientAnalysisProfile';
import { resolveClientPrimaryName } from '../../data/clientDisplay';
import { syncMetaAsset } from '../../lib/meta/metaSyncService';

interface ClientAnalyticsDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  performance: EnrichedGlobalClientPerformance | null;
  period: DashboardPeriod;
  onOpenCampaigns: (performance: EnrichedGlobalClientPerformance) => void;
  onEditClient?: (clientId: string) => void;
}

type SyncDiagnosisState = 'not_synced' | 'failed' | 'partial' | 'ok';

function syncDiagnosisFor(status: GlobalClientStatus): SyncDiagnosisState {
  if (status === 'never_synced' || status === 'period_not_synced' || status === 'not_connected') return 'not_synced';
  if (status === 'failed') return 'failed';
  if (status === 'partial' || status === 'sync_without_metrics' || status === 'stale') return 'partial';
  return 'ok';
}

const SYNC_DIAGNOSIS_COPY: Record<Exclude<SyncDiagnosisState, 'ok'>, { title: string; action: string }> = {
  not_synced: { title: 'Período não sincronizado.', action: 'Sincronize este período antes de analisar.' },
  failed: { title: 'A última sincronização falhou.', action: 'Tente sincronizar novamente antes de confiar nestes números.' },
  partial: { title: 'Sincronização parcial.', action: 'Dados parciais. Não tomar decisão sem nova sincronização.' },
};

function formatCurrency(value: number | null, currency: string | null = 'BRL'): string {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(value);
  } catch {
    return `${currency || ''} ${value.toLocaleString('pt-BR')}`.trim();
  }
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function metricValue(metrics: Record<string, { available: boolean; value: number | null }>, id: string): number | null {
  const metric = metrics[id];
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

export function ClientAnalyticsDetailDrawer({ isOpen, onClose, performance, period, onOpenCampaigns, onEditClient }: ClientAnalyticsDetailDrawerProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const decision = useMemo<ClientAnalyticsDecision | null>(() => {
    if (!performance) return null;
    const now = new Date();
    const timezone = performance.accounts[0]?.timezone || 'America/Sao_Paulo';
    return buildClientAnalyticsDecision({
      client: performance.client ?? { id: performance.clientId, name: performance.clientName, company: '' },
      analysisProfile: performance.analysisProfile,
      globalPerformance: {
        clientStatus: explainDashboardClientSync(performance, period).status === 'success' ? 'available' : performance.clientStatus,
        dataQuality: performance.dataQuality,
        lastSuccessfulRun: performance.lastSuccessfulRun,
      },
      accountMetrics: performance.metrics ?? {},
      metricGroups: performance.metricGroups ?? [],
      resolvedTargets: performance.resolvedTargets ?? [],
      period: periodFromDashboardPeriod(period, timezone, now),
      currentDate: now,
    });
  }, [performance, period]);

  if (!isOpen || !performance) return null;

  const syncExplanation = explainDashboardClientSync(performance, period);
  const syncDiagnosis: SyncDiagnosisState = syncExplanation.status === 'success'
    ? 'ok'
    : syncExplanation.status === 'failed'
      ? 'failed'
      : syncExplanation.status === 'partial' || syncExplanation.status === 'stale'
        ? 'partial'
        : syncDiagnosisFor(performance.clientStatus);
  const profile = performance.analysisProfile;
  const account = performance.accounts[0];
  const currency = account?.currency || 'BRL';
  const clientName = resolveClientPrimaryName(performance.client, profile, performance);

  const handleSyncClient = async () => {
    const linkedAccounts = performance.accounts.filter((a) => a.clientMetaAssetId);
    if (linkedAccounts.length === 0) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await Promise.all(
        linkedAccounts.map((a) => syncMetaAsset({ clientMetaAssetId: a.clientMetaAssetId, period, requestedLevel: 'campaign' }))
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Falha ao sincronizar este cliente.');
    } finally {
      setSyncing(false);
    }
  };

  // Diagnóstico determinístico, por regra - nunca IA generativa. O estado de
  // sincronização (não sincronizado/falhou/parcial) tem prioridade sobre o
  // diagnóstico de meta, porque não faz sentido avaliar custo/volume sobre
  // dados que ainda não são confiáveis.
  const primaryDiagnosisTitle = syncDiagnosis !== 'ok'
    ? SYNC_DIAGNOSIS_COPY[syncDiagnosis].title
    : decision?.status === 'no_profile'
      ? 'Perfil de análise incompleto.'
      : decision?.status === 'healthy'
        ? 'Operação saudável.'
        : decision?.status === 'attention'
          ? 'Operação em atenção.'
          : decision?.status === 'critical'
            ? 'Operação crítica.'
            : 'Sem dados confiáveis.';

  const recommendedAction = syncDiagnosis !== 'ok' ? SYNC_DIAGNOSIS_COPY[syncDiagnosis].action : decision?.recommendation ?? 'Configure a meta principal do cliente.';

  const metrics = performance.metrics ?? {};

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-all" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col transform transition-transform border-l border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header / Identificação */}
        <div className="flex flex-col space-y-2 p-6 border-b">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-lg tracking-tight">{clientName}</h3>
              <p className="text-sm text-muted-foreground">
                {account?.accountName || 'Conta Meta não vinculada'} · {periodLabels[period]}
              </p>
            </div>
            <button onClick={onClose} className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            <span>Última sincronização: {performance.lastSuccessfulRun?.finishedAt ? new Date(performance.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR') : 'nunca'}</span>
            <span>· Qualidade dos dados: {performance.dataQuality?.status ?? 'unavailable'}</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Diagnóstico + ação recomendada */}
          <Section title="Diagnóstico">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{primaryDiagnosisTitle}</p>
              <p className="mt-1 text-sm text-gray-600">{recommendedAction}</p>
            </div>
            {(performance.hasNewerPartial || performance.hasNewerFailure) && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Último dado confiável em uso; a tentativa de sincronização mais recente {performance.hasNewerFailure ? 'falhou' : 'ficou parcial'}. Os números abaixo vêm da última sincronização bem-sucedida, não da mais recente.
              </div>
            )}
          </Section>

          {/* Contrato do cliente */}
          <Section title="Contrato do cliente">
            {!profile ? (
              <p className="text-sm text-gray-500 italic">Perfil de análise não configurado.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Métrica principal" value={metricLabels[profile.primaryConversionMetric] || profile.primaryConversionMetric} />
                <Field label="Orçamento planejado" value={formatCurrency(profile.plannedBudget, currency)} />
                <Field label="Custo máximo aceitável" value={decision?.target.costCeiling !== null && decision?.target.costCeiling !== undefined ? formatCurrency(decision.target.costCeiling, currency) : 'Não configurado'} />
                <Field label="ROAS mínimo" value={decision?.target.minRoas !== null && decision?.target.minRoas !== undefined ? `${decision.target.minRoas.toFixed(2)}x` : 'Não configurado'} />
                <Field label="Volume esperado" value={decision?.target.minVolume !== null && decision?.target.minVolume !== undefined ? formatNumber(decision.target.minVolume) : 'Não configurado'} />
                <Field label="Canal principal" value={profile.primaryChannel || '—'} />
                <Field label="Modelo de venda" value={profile.salesModels?.length ? profile.salesModels.join(', ') : '—'} />
                <Field label="Operação" value={profile.operationType || '—'} />
              </div>
            )}
          </Section>

          {/* Resultado real */}
          <Section title="Resultado real no período">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Field label="Investimento" value={formatCurrency(metricValue(metrics, 'spend'), currency)} />
              <Field label="Conversas" value={formatNumber(metricValue(metrics, 'messaging_conversations_started_total'))} />
              <Field label="Leads" value={formatNumber(metricValue(metrics, 'leads'))} />
              <Field label="Compras" value={formatNumber(metricValue(metrics, 'purchases'))} />
              <Field label="Valor de compra" value={formatCurrency(metricValue(metrics, 'purchase_value'), currency)} />
              <Field label="ROAS" value={metricValue(metrics, 'purchase_roas') !== null ? `${metricValue(metrics, 'purchase_roas')!.toFixed(2)}x` : '—'} />
              <Field label="Alcance" value={formatNumber(metricValue(metrics, 'reach'))} />
              <Field label="Impressões" value={formatNumber(metricValue(metrics, 'impressions'))} />
              <Field label="Cliques" value={formatNumber(metricValue(metrics, 'link_clicks'))} />
            </div>
          </Section>

          {/* Comparação */}
          {decision && decision.status !== 'no_profile' && decision.status !== 'no_data' && (
            <Section title="Comparação: esperado vs. realizado">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label={`${decision.primaryMetric.label} realizado`} value={formatNumber(decision.actual.resultCount)} />
                <Field label="Custo atual" value={decision.actual.costPerResult !== null ? formatCurrency(decision.actual.costPerResult, currency) : 'Sem valor confiável'} />
                <Field label="Orçamento vs. gasto" value={`${formatCurrency(decision.budgetPacing.plannedMonthlyBudget, currency)} planejado · ${formatCurrency(decision.budgetPacing.actualSpend, currency)} gasto`} />
                <Field
                  label="Gap da meta"
                  value={decision.gap.volumeDeficit !== null && decision.gap.volumeDeficit > 0
                    ? `-${formatNumber(decision.gap.volumeDeficit)} ${decision.primaryMetric.label.toLowerCase()}`
                    : decision.gap.costDifferencePercent !== null
                      ? `${decision.gap.costDifferencePercent > 0 ? '+' : ''}${decision.gap.costDifferencePercent.toFixed(1)}% no custo`
                      : 'Dentro da meta'}
                />
              </div>
            </Section>
          )}

          {/* Projeção */}
          {decision && decision.status !== 'no_profile' && decision.status !== 'no_data' && (
            <Section title="Projeção até o fim do período">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Ritmo atual" value={decision.projection.dailyResultRate !== null ? `${decision.projection.dailyResultRate.toFixed(1)} / dia` : '—'} />
                <Field label="Projeção do período" value={formatNumber(decision.projection.projectedResult)} />
                <Field label="Status de ritmo" value={RESULT_PACING_LABEL[decision.resultPacing.status]} />
                <Field label="Ritmo de orçamento" value={BUDGET_PACING_LABEL[decision.budgetPacing.status]} />
              </div>
            </Section>
          )}
        </div>

        {/* Ações */}
        <div className="grid grid-cols-3 gap-px bg-gray-100 border-t">
          <button
            onClick={() => onOpenCampaigns(performance)}
            data-testid="detail-drawer-open-campaigns"
            className="flex items-center justify-center gap-1.5 bg-white py-3 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Ver campanhas
          </button>
          <button
            onClick={() => onEditClient?.(performance.clientId)}
            disabled={!onEditClient}
            className="flex items-center justify-center gap-1.5 bg-white py-3 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Editar metas
          </button>
          <button
            onClick={() => void handleSyncClient()}
            disabled={syncing}
            className="flex items-center justify-center gap-1.5 bg-white py-3 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Sincronizar período deste cliente
          </button>
        </div>
        {syncError && <p className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">{syncError}</p>}
      </div>
    </div>
  );
}

const RESULT_PACING_LABEL: Record<ClientAnalyticsDecision['resultPacing']['status'], string> = {
  no_target: 'Sem meta de volume',
  behind: 'Abaixo da meta',
  on_track: 'Dentro da meta',
  ahead: 'Acima da meta',
};

const BUDGET_PACING_LABEL: Record<ClientAnalyticsDecision['budgetPacing']['status'], string> = {
  no_budget: 'Sem orçamento configurado',
  under_pacing: 'Abaixo do ritmo esperado',
  on_track: 'Dentro do ritmo',
  over_pacing: 'Acima do ritmo esperado',
  budget_exceeded: 'Orçamento excedido',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
    </div>
  );
}
