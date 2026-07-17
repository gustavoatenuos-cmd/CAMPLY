import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  PenSquare,
  RotateCcw,
  SquareStack,
} from 'lucide-react';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { ClientLogo } from '../clients/ClientLogo';
import { CampaignHierarchicalTable } from './CampaignHierarchicalTable';
import { OperationalHealthBadge } from './OperationalHealthBadge';
import { PacingBar } from './PacingBar';
import { metricLabels } from '../../lib/analysis/clientAnalysisProfile';
import { getClientPrimaryMetricView } from '../../lib/performance/clientAnalyticsDecision';
import { operationalHealthTagFor, summarizeDiagnosis, type ClientPriorityEntry } from '../../lib/performance/clientPriorityGrouping';
import { effectiveClientProfile } from './CommercialDecisionOverview';
import { resolveClientPrimaryName } from '../../data/clientDisplay';

interface ClientPerformanceCardGridProps {
  entries: ClientPriorityEntry[];
  period: DashboardPeriod;
  onViewAnalytics: (clientId: string) => void;
  onEditClient: (clientId: string) => void;
  /** Abre a confirmação de desativação (o diálogo em si vive no componente pai). */
  onDeactivateClient?: (clientId: string) => void;
  /** Reativação não exige confirmação — mesmo padrão do ClientsView. */
  onReactivateClient?: (clientId: string) => void;
  /** Decide se o card mostra "Desativar cliente" ou "Reativar cliente"; quando omitido, o botão não aparece. */
  isClientOperationallyActive?: (clientId: string) => boolean;
  registerCardRef?: (clientId: string, element: HTMLDivElement | null) => void;
}

function getMetric(client: GlobalClientPerformance, metricName: string) {
  const metric = client.metrics?.[metricName];
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function formatCurrency(val: number | null, currency = 'BRL') {
  if (val === null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val);
}

function formatNumber(val: number | null) {
  if (val === null) return '—';
  return new Intl.NumberFormat('pt-BR').format(val);
}

function formatMetricNumber(metricId: string, value: number | null, currency: string): string {
  if (value === null) return '—';
  return metricId.startsWith('cost_per') || metricId === 'spend' ? formatCurrency(value, currency) : formatNumber(value);
}

export function ClientPerformanceCardGrid({
  entries,
  period,
  onViewAnalytics,
  onEditClient,
  onDeactivateClient,
  onReactivateClient,
  isClientOperationallyActive,
  registerCardRef,
}: ClientPerformanceCardGridProps) {
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});

  const toggleClient = (clientId: string) => {
    setExpandedClients((prev) => ({ ...prev, [clientId]: !prev[clientId] }));
  };

  if (entries.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-brand-line bg-brand-ink/30 p-8 text-center">
        <AlertTriangle className="mb-4 text-brand-muted" size={32} />
        <h3 className="text-sm font-bold text-white">Nenhum cliente atende aos filtros aplicados.</h3>
        <p className="mt-1 text-xs text-brand-muted">Tente remover alguns filtros ou selecionar outro período.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {entries.map(({ client, workspaceClient, tier, reasons }) => {
        const logoUrl = workspaceClient?.logoUrl;
        const currency = client.accounts[0]?.currency || 'BRL';
        const profile = effectiveClientProfile(client);

        const spend = getMetric(client, 'spend');
        // Fonte única do que o card destaca como "resultado principal" - vem
        // de profile.primaryConversionMetric, nunca de qual dado existe (um
        // cliente configurado para mensagens não pode virar card de compras
        // só porque a conta também tem alguma compra registrada).
        const primaryView = getClientPrimaryMetricView(profile, client.metrics ?? {}, client.metricGroups ?? [], client.resolvedTargets ?? []);

        const primaryMetricId = profile?.primaryConversionMetric;
        const primaryEvaluation = primaryMetricId
          ? client.evaluations.find((evaluation) => evaluation.metricId === primaryMetricId && !evaluation.campaignId)
          : undefined;

        const plannedBudget = profile?.plannedBudget ?? null;
        const remaining = plannedBudget !== null && spend !== null ? plannedBudget - spend : null;

        const isExpanded = !!expandedClients[client.clientId];
        const tag = operationalHealthTagFor({ tier, reasons });
        const diagnosis = summarizeDiagnosis(client, reasons);
        const primaryName = resolveClientPrimaryName(workspaceClient, profile, client);
        const isEntryActive = isClientOperationallyActive ? isClientOperationallyActive(client.clientId) : true;

        return (
          <div
            key={client.clientId}
            ref={(element) => registerCardRef?.(client.clientId, element)}
            data-testid="client-performance-card"
            className="flex flex-col rounded-xl border border-brand-line bg-brand-ink shadow-sm transition-all overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-brand-line/50 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <ClientLogo name={primaryName} logoUrl={logoUrl} />
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold leading-tight text-white">
                    {primaryName}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="flex items-center gap-1 text-xs text-brand-muted">
                      <BriefcaseBusiness size={12} />
                      {workspaceClient?.segment || 'Multinicho'}
                    </span>
                    <span className="truncate text-xs text-brand-muted">
                      · {client.accounts[0]?.accountName || 'Sem conta vinculada'}
                      {client.accounts.length > 1 ? ` +${client.accounts.length - 1}` : ''}
                    </span>
                  </div>
                </div>
              </div>
              <OperationalHealthBadge tag={tag} />
            </div>

            {/* Performance Overview */}
            <div className="grid grid-cols-2 gap-px bg-brand-line/50 p-px">
              <div className="bg-brand-ink p-3 flex flex-col justify-center">
                <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Investimento total</p>
                <p className="text-lg font-black text-white">{formatCurrency(spend, currency)}</p>
              </div>

              <div className="bg-brand-ink p-3 flex flex-col justify-center">
                {primaryView.status === 'no_profile' ? (
                  <p className="text-xs text-brand-muted italic">Sem meta configurada</p>
                ) : primaryView.status === 'unmapped' ? (
                  <p className="text-xs text-brand-muted">{primaryView.label}</p>
                ) : (
                  <>
                    <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">
                      {primaryView.label}
                      {primaryView.secondaryMetric ? ` (${primaryView.secondaryMetric.label})` : ''}
                    </p>
                    <p className="text-lg font-black text-white">
                      {formatNumber(primaryView.actual)}
                      {primaryView.secondaryMetric && (
                        <span className="text-xs font-normal text-emerald-400">
                          {' '}({primaryView.secondaryMetric.value !== null ? primaryView.secondaryMetric.value.toFixed(2) + (primaryView.secondaryMetric.label === 'CTR' ? '%' : 'x') : '—'})
                        </span>
                      )}
                    </p>
                    {primaryView.costMetric && (
                      <p className="text-[10px] text-brand-muted mt-0.5">
                        {primaryView.costMetric.label}: {primaryView.costMetric.value !== null ? formatCurrency(primaryView.costMetric.value, currency) : 'Sem valor confiável'}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Meta principal + orçamento/pacing */}
            <div className="grid grid-cols-2 gap-px bg-brand-line/50 p-px">
              <div className="bg-brand-ink p-3 flex flex-col justify-center">
                <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Meta principal</p>
                {primaryMetricId ? (
                  <>
                    <p className="text-xs font-bold text-white">{metricLabels[primaryMetricId] || primaryMetricId}</p>
                    <p className="mt-0.5 text-[11px] text-brand-muted">
                      Realizado {formatMetricNumber(primaryMetricId, primaryEvaluation?.actualValue ?? null, currency)} · esperado {formatMetricNumber(primaryMetricId, primaryEvaluation?.targetValue ?? null, currency)}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-brand-muted">Não configurada</p>
                )}
              </div>

              <div className="bg-brand-ink p-3 flex flex-col justify-center">
                <p className="text-[10px] uppercase font-bold text-brand-muted mb-0.5">Orçamento planejado</p>
                <p className="text-xs font-bold text-white">{formatCurrency(plannedBudget, currency)}</p>
                <p className="mt-0.5 text-[11px] text-brand-muted">
                  Restante: {remaining === null ? '—' : formatCurrency(remaining, currency)}
                </p>
                {client.budgetPacing && (
                  <div className="mt-1.5">
                    <PacingBar pct={client.budgetPacing.differencePercent} />
                  </div>
                )}
              </div>
            </div>

            {/* Diagnóstico */}
            <div className="border-t border-brand-line/50 bg-brand-surface/20 px-4 py-2.5">
              <p className="text-[11px] leading-5 text-brand-muted">{diagnosis}</p>
            </div>

            {/* Status Sync */}
            <div className="flex items-center justify-between bg-brand-surface/30 px-4 py-2 border-t border-brand-line/50">
              <div className="flex items-center gap-1.5 text-[10px] text-brand-muted">
                {client.dataQuality.status === 'complete' ? (
                  <Database size={10} className="text-emerald-400" />
                ) : (
                  <Clock3 size={10} className="text-amber-400" />
                )}
                <span>
                  {client.lastSuccessfulRun?.finishedAt
                    ? new Date(client.lastSuccessfulRun.finishedAt).toLocaleString('pt-BR')
                    : 'Sem sincronização'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className={`grid gap-px bg-brand-line/50 p-px mt-auto ${onDeactivateClient || onReactivateClient ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <button
                onClick={() => onViewAnalytics(client.clientId)}
                className="flex items-center justify-center gap-1.5 bg-brand-ink py-2.5 text-xs font-bold text-brand-soft hover:bg-white/[0.03] hover:text-white transition-colors"
              >
                Ver análise
              </button>
              <button
                onClick={() => toggleClient(client.clientId)}
                data-testid="client-performance-card-toggle-campaigns"
                className="flex items-center justify-center gap-1.5 bg-brand-ink py-2.5 text-xs font-bold text-brand-soft hover:bg-white/[0.03] hover:text-white transition-colors"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Campanhas
              </button>
              <button
                onClick={() => onEditClient(client.clientId)}
                className="flex items-center justify-center gap-1.5 bg-brand-ink py-2.5 text-xs font-bold text-brand-muted hover:bg-white/[0.03] hover:text-white transition-colors"
                title="Editar cliente/metas"
              >
                <PenSquare size={13} />
                Editar
              </button>
              {isEntryActive ? (
                onDeactivateClient && (
                  <button
                    onClick={() => onDeactivateClient(client.clientId)}
                    data-testid="client-card-deactivate-button"
                    className="flex items-center justify-center gap-1.5 bg-brand-ink py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-400/10 transition-colors"
                    title="Desativar cliente"
                  >
                    <Ban size={13} />
                    Desativar
                  </button>
                )
              ) : (
                onReactivateClient && (
                  <button
                    onClick={() => onReactivateClient(client.clientId)}
                    data-testid="client-card-reactivate-button"
                    className="flex items-center justify-center gap-1.5 bg-brand-ink py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-400/10 transition-colors"
                    title="Reativar cliente"
                  >
                    <RotateCcw size={13} />
                    Reativar
                  </button>
                )
              )}
            </div>

            {/* Expanded Content (Micro-drilldown) */}
            {isExpanded && (
              <div className="border-t border-brand-line bg-brand-ink/50 p-4 overflow-x-auto">
                {client.accounts.length === 0 ? (
                  <p className="text-xs text-brand-muted text-center py-4">Nenhuma conta com dados ativos no período.</p>
                ) : (
                  client.accounts.map((account) => (
                    <div key={account.adAccountId} className="mb-4 last:mb-0">
                      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white/80">
                        <SquareStack size={12} />
                        {account.accountName}
                      </h4>
                      <CampaignHierarchicalTable account={account} period={period} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
