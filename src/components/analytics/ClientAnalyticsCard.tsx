import React, { useMemo } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { calculateClientBudgetPacing } from '../../lib/performance/budgetPacingUtils';
import { buildClientAnalyticsDecision, periodFromDashboardPeriod } from '../../lib/performance/clientAnalyticsDecision';
import { evaluateClientOperationalReadiness } from '../../lib/operational/clientOperationalReadiness';
import { debugDashboardClientSync, explainDashboardClientSync } from '../../lib/performance/explainClientSyncState';
import { ClientPrimaryMetricBlock } from './ClientPrimaryMetricBlock';
import { ClientAnalyticsStatusPanel, STATUS_TONE } from './ClientAnalyticsStatusPanel';
import { ClientLogo } from '../clients/ClientLogo';
import { Clock, HelpCircle } from 'lucide-react';

interface ClientAnalyticsCardProps {
  performance: EnrichedGlobalClientPerformance;
  period: DashboardPeriod;
  onOpenCampaigns: (performance: EnrichedGlobalClientPerformance) => void;
  onOpenDetails: (performance: EnrichedGlobalClientPerformance) => void;
  /** Leva à Integração Meta, onde vincular e sincronizar de fato acontecem. */
  onOpenMetaIntegration?: () => void;
}

// Ações do bloqueio que só se resolvem na Integração Meta. Antes, todas abriam o
// drawer de detalhes - o botão "Sincronizar Meta" não sincronizava nada.
const META_INTEGRATION_ACTION = /^(Vincular conta Meta|Sincronizar Meta|Corrigir falha de sincronização|Revisar sincronização parcial)/;

export function ClientAnalyticsCard({ performance, period, onOpenCampaigns, onOpenDetails, onOpenMetaIntegration }: ClientAnalyticsCardProps) {
  const { client, metrics, analysisProfile } = performance;
  // client é o registro local do workspace (sem perfil analítico); o perfil
  // comercial de fato vem do nível superior, populado a partir de
  // client_analysis_profiles em globalPerformanceDashboard.ts.
  const profile = analysisProfile;

  // Actual spend from Meta
  const actualSpend = metrics?.spend?.value ?? 0;

  const syncExplanation = useMemo(() => explainDashboardClientSync(performance, period), [performance, period]);
  const coverageClientStatus = syncExplanation.status === 'success'
    ? 'available'
    : syncExplanation.status === 'not_synced'
      ? 'period_not_synced'
      : syncExplanation.status === 'partial'
        ? 'partial'
        : syncExplanation.status === 'failed'
          ? 'failed'
          : syncExplanation.status === 'stale'
            ? 'stale'
            : performance.clientStatus;

  // Budget calculations
  const budgetPacing = calculateClientBudgetPacing(
    profile?.plannedBudget,
    profile?.budgetPeriod,
    actualSpend
  );

  const decision = useMemo(() => {
    const now = new Date();
    const timezone = performance.accounts[0]?.timezone || 'America/Sao_Paulo';
    return buildClientAnalyticsDecision({
      client: client ?? { id: performance.clientId, name: performance.clientName, company: '' },
      analysisProfile: profile,
      globalPerformance: {
        clientStatus: coverageClientStatus,
        dataQuality: performance.dataQuality,
        lastSuccessfulRun: performance.lastSuccessfulRun,
      },
      accountMetrics: performance.metrics ?? {},
      metricGroups: performance.metricGroups ?? [],
      resolvedTargets: performance.resolvedTargets ?? [],
      period: periodFromDashboardPeriod(period, timezone, now),
      currentDate: now,
    });
  }, [client, performance, profile, period, coverageClientStatus]);

  // Rastreabilidade de "por que este cliente está com este status de sync" -
  // só em dev, nunca em produção (ver explainClientSyncState.ts).
  debugDashboardClientSync(performance, period);

  const readiness = useMemo(() => evaluateClientOperationalReadiness({
    clientId: performance.clientId,
    client: client ?? null,
    analysisProfile: profile,
    globalClientStatus: coverageClientStatus,
    receivableEntries: undefined,
    analyticsDecision: decision,
  }), [client, performance.clientId, coverageClientStatus, profile, decision]);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  // Determine badge color for pacing
  const getPacingColor = (status: string) => {
    switch (status) {
      case 'on_track': return 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
      case 'under_pacing': return 'border border-sky-400/20 bg-sky-400/10 text-sky-300';
      case 'over_pacing': return 'border border-amber-400/20 bg-amber-400/10 text-amber-300';
      case 'budget_exceeded': return 'border border-rose-400/20 bg-rose-400/10 text-rose-300';
      default: return 'border border-brand-line bg-white/[0.04] text-brand-muted';
    }
  };

  const hasDataIssues = readiness.analytics.status === 'blocked';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-brand-line bg-brand-surface text-white">
      <div className="border-b border-brand-line px-4 py-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <ClientLogo 
              name={client?.company || client?.name || performance.clientName || 'Cliente'} 
              logoUrl={client?.logoUrl} 
              size="sm" 
            />
            <div>
              <h3 className="line-clamp-1 font-semibold text-white">{client?.company || client?.name || performance.clientName || 'Cliente Desconhecido'}</h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-brand-muted">
                {profile?.operationType && <span className="inline-flex items-center rounded-md border border-brand-line bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-brand-soft">{profile.operationType}</span>}
                {profile?.salesModels && profile.salesModels.length > 0 && (
                  <span className="truncate max-w-[120px]">{profile.salesModels[0]}</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-1">
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONE[decision.status].badgeClass}`}>
              {STATUS_TONE[decision.status].icon}
              {STATUS_TONE[decision.status].label}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4">
        {readiness.analytics.status === 'blocked' ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-brand-line bg-brand-ink p-6 text-center">
            <HelpCircle className="h-5 w-5 text-brand-muted" />
            <p className="text-sm font-medium text-brand-soft">
              {readiness.analytics.missing[0] || readiness.analytics.warnings[0] || 'Cliente ainda não pode ser analisado'}
            </p>
            {readiness.analytics.action && (
              <button
                className="rounded-md bg-brand-green px-3 py-1.5 text-xs font-semibold text-brand-ink hover:brightness-95"
                onClick={() => (
                  onOpenMetaIntegration && META_INTEGRATION_ACTION.test(readiness.analytics.action)
                    ? onOpenMetaIntegration()
                    : onOpenDetails(performance)
                )}
              >
                {readiness.analytics.action}
              </button>
            )}
          </div>
        ) : (
          <>
            {readiness.analytics.status === 'limited' && readiness.analytics.warnings.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-xs text-amber-300">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>{readiness.analytics.warnings.join(' ')}</span>
              </div>
            )}
            <ClientAnalyticsStatusPanel decision={decision} />

            <div className="mt-4 border-t border-brand-line pt-4">
              <ClientPrimaryMetricBlock performance={performance} />
            </div>

            <div className="mt-4 border-t border-brand-line pt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-brand-soft">Orçamento mensal</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getPacingColor(budgetPacing.status)}`}>
                  {budgetPacing.statusText}
                </span>
              </div>

              {budgetPacing.status === 'no_budget' ? (
                <div className="py-1 text-sm italic text-brand-muted">
                  Orçamento não configurado
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="flex flex-col rounded-md border border-brand-line bg-brand-ink p-2.5">
                    <span className="text-[10px] font-medium text-brand-muted">Planejado</span>
                    <span className="text-sm font-semibold text-white">{formatCurrency(budgetPacing.plannedMonthlyBudget)}</span>
                  </div>
                  <div className="flex flex-col rounded-md border border-brand-line bg-brand-ink p-2.5">
                    <span className="text-[10px] font-medium text-brand-muted">Gasto</span>
                    <span className="text-sm font-semibold text-white">{formatCurrency(budgetPacing.actualSpend)}</span>
                  </div>
                  <div className="flex flex-col rounded-md border border-brand-line bg-brand-ink p-2.5">
                    <span className="text-[10px] font-medium text-brand-muted">Restante</span>
                    <span className={`font-semibold text-sm ${
                      budgetPacing.remainingBudget !== null && budgetPacing.remainingBudget < 0 ? 'text-rose-300' : 'text-white'
                    }`}>
                      {formatCurrency(budgetPacing.remainingBudget)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mt-auto flex gap-2 border-t border-brand-line p-3">
        <button 
          className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-brand-line bg-brand-ink px-3 text-xs font-medium text-brand-soft hover:bg-brand-surface2 disabled:opacity-50"
          onClick={() => onOpenDetails(performance)}
        >
          Ver detalhes
        </button>
        <button 
          className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-brand-green px-3 text-xs font-semibold text-brand-ink hover:brightness-95 disabled:opacity-40"
          disabled={hasDataIssues}
          onClick={() => onOpenCampaigns(performance)}
        >
          Ver campanhas
        </button>
      </div>
    </div>
  );
}
