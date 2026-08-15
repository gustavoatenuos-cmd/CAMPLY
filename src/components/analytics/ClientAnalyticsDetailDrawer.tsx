import { useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { periodLabels } from '../../lib/performance/analyticsCapabilities';
import type { GlobalClientStatus } from '../../lib/performance/globalPerformanceDashboard';
import {
  buildClientAnalyticsDecision,
  periodFromDashboardPeriod,
  type ClientAnalyticsDecision,
} from '../../lib/performance/clientAnalyticsDecision';
import { explainDashboardClientSync } from '../../lib/performance/explainClientSyncState';
import { metricLabels } from '../../lib/analysis/clientAnalysisProfile';
import { resolveClientPrimaryName } from '../../data/clientDisplay';
import { ClientMetricComparisonGrid } from './ClientMetricComparisonGrid';

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

function primaryResultValue(decision: ClientAnalyticsDecision): string {
  const actual = formatNumber(decision.actual.resultCount);
  if (decision.actual.costPerResult === null) return actual;
  return `${actual} · ${formatCurrency(decision.actual.costPerResult)} por resultado`;
}

export function ClientAnalyticsDetailDrawer({
  isOpen,
  onClose,
  performance,
  period,
  onOpenCampaigns,
  onEditClient,
}: ClientAnalyticsDetailDrawerProps) {
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
      budgetPacing: performance.budgetPacing,
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
            : decision?.status === 'stale_data'
              ? 'Dados desatualizados.'
              : 'Sem dados confiáveis.';

  const recommendedAction = syncDiagnosis !== 'ok'
    ? SYNC_DIAGNOSIS_COPY[syncDiagnosis].action
    : decision?.recommendation ?? 'Configure a meta principal do cliente.';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-all" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col space-y-2 border-b p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">{clientName}</h3>
              <p className="text-sm text-muted-foreground">
                {account?.accountName || 'Conta Meta não vinculada'} · {periodLabels[period]}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-sm opacity-70 transition-opacity hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            <span>Última sincronização: {performance.lastSuccessfulRun?.finishedAt ? new Date(performance.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR') : 'nunca'}</span>
            <span>· Qualidade: {performance.dataQuality?.status ?? 'unavailable'}</span>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-auto p-6">
          <Section title="Diagnóstico do gerente de contas">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{primaryDiagnosisTitle}</p>
              <p className="mt-1 text-sm text-gray-600">{recommendedAction}</p>
            </div>
            {(performance.hasNewerPartial || performance.hasNewerFailure) ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Último snapshot confiável em uso; a tentativa mais recente {performance.hasNewerFailure ? 'falhou' : 'ficou parcial'}. A análise abaixo não usa a tentativa incompleta.
              </div>
            ) : null}
          </Section>

          <Section title="Contrato do cliente">
            {!profile ? (
              <p className="text-sm italic text-gray-500">Perfil de análise não configurado.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Métrica principal" value={metricLabels[profile.primaryConversionMetric] || profile.primaryConversionMetric} />
                <Field label="Orçamento planejado" value={formatCurrency(profile.plannedBudget, currency)} />
                <Field label="Custo máximo aceitável" value={decision?.target.costCeiling != null ? formatCurrency(decision.target.costCeiling, currency) : 'Não configurado'} />
                <Field label="ROAS mínimo" value={decision?.target.minRoas != null ? `${decision.target.minRoas.toFixed(2)}x` : 'Não configurado'} />
                <Field label="Volume esperado" value={decision?.target.minVolume != null ? formatNumber(decision.target.minVolume) : 'Não configurado'} />
                <Field label="Canal principal" value={profile.primaryChannel || '—'} />
                <Field label="Modelo de venda" value={profile.salesModels?.length ? profile.salesModels.join(', ') : '—'} />
                <Field label="Operação" value={profile.operationType || '—'} />
              </div>
            )}
          </Section>

          <Section title="Resultado principal">
            {!decision || decision.status === 'no_profile' ? (
              <p className="text-sm text-gray-500">Configure a métrica principal para transformar os dados da Meta em uma leitura orientada ao cliente.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label={decision.primaryMetric.label} value={primaryResultValue(decision)} />
                <Field label="Investimento no período" value={formatCurrency(decision.actual.spend, currency)} />
                {decision.primaryMetric.family === 'sales' ? (
                  <Field label="ROAS" value={decision.actual.roas != null ? `${decision.actual.roas.toFixed(2)}x` : '—'} />
                ) : null}
                <Field label="Fonte do resultado" value={decision.actual.objectiveScoped ? 'Objetivo/canal compatível' : 'Conta agregada'} />
              </div>
            )}
          </Section>

          <Section title="Métricas principais, secundárias e regras">
            <ClientMetricComparisonGrid performance={performance} />
          </Section>

          {decision && !['no_profile', 'no_data'].includes(decision.status) ? (
            <Section title="Projeção até o fim do período">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Ritmo atual" value={decision.projection.dailyResultRate !== null ? `${decision.projection.dailyResultRate.toFixed(1)} / dia` : '—'} />
                <Field label="Projeção do período" value={formatNumber(decision.projection.projectedResult)} />
                <Field label="Status de resultado" value={RESULT_PACING_LABEL[decision.resultPacing.status]} />
                <Field label="Ritmo de orçamento" value={BUDGET_PACING_LABEL[decision.budgetPacing.status]} />
              </div>
            </Section>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-px border-t bg-gray-100">
          <button
            type="button"
            onClick={() => onOpenCampaigns(performance)}
            data-testid="detail-drawer-open-campaigns"
            className="flex items-center justify-center gap-1.5 bg-white py-3 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Ver campanhas
          </button>
          <button
            type="button"
            onClick={() => onEditClient?.(performance.clientId)}
            disabled={!onEditClient}
            className="flex items-center justify-center gap-1.5 bg-white py-3 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Editar metas
          </button>
        </div>
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
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-50 p-2">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
    </div>
  );
}
