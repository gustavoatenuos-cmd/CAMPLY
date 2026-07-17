import React, { useMemo } from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { calculateClientBudgetPacing } from '../../lib/performance/budgetPacingUtils';
import { buildClientAnalyticsDecision, periodFromDashboardPeriod } from '../../lib/performance/clientAnalyticsDecision';
import { evaluateClientOperationalReadiness } from '../../lib/operational/clientOperationalReadiness';
import { explainClientSyncState } from '../../lib/performance/explainClientSyncState';
import { ClientPrimaryMetricBlock } from './ClientPrimaryMetricBlock';
import { ClientAnalyticsStatusPanel, STATUS_TONE } from './ClientAnalyticsStatusPanel';
import { ClientLogo } from '../clients/ClientLogo';
import { Clock, HelpCircle } from 'lucide-react';

interface ClientAnalyticsCardProps {
  performance: EnrichedGlobalClientPerformance;
  period: DashboardPeriod;
  onOpenCampaigns: (performance: EnrichedGlobalClientPerformance) => void;
  onOpenDetails: (performance: EnrichedGlobalClientPerformance) => void;
}

export function ClientAnalyticsCard({ performance, period, onOpenCampaigns, onOpenDetails }: ClientAnalyticsCardProps) {
  const { client, metrics, analysisProfile } = performance;
  // client é o registro local do workspace (sem perfil analítico); o perfil
  // comercial de fato vem do nível superior, populado a partir de
  // client_analysis_profiles em globalPerformanceDashboard.ts.
  const profile = analysisProfile;

  // Actual spend from Meta
  const actualSpend = metrics?.spend?.value ?? 0;

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
        clientStatus: performance.clientStatus,
        dataQuality: performance.dataQuality,
        lastSuccessfulRun: performance.lastSuccessfulRun,
      },
      accountMetrics: performance.metrics ?? {},
      metricGroups: performance.metricGroups ?? [],
      resolvedTargets: performance.resolvedTargets ?? [],
      period: periodFromDashboardPeriod(period, timezone, now),
      currentDate: now,
    });
  }, [client, performance, profile, period]);

  // Rastreabilidade de "por que este cliente está com este status de sync" -
  // só em dev, nunca em produção (ver explainClientSyncState.ts).
  if (import.meta.env.DEV) {
    console.debug('[explainClientSyncState]', explainClientSyncState(performance, period));
  }

  const readiness = useMemo(() => evaluateClientOperationalReadiness({
    clientId: performance.clientId,
    client: client ?? null,
    analysisProfile: profile,
    globalClientStatus: performance.clientStatus,
    receivableEntries: undefined,
    analyticsDecision: decision,
  }), [client, performance.clientId, performance.clientStatus, profile, decision]);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  // Determine badge color for pacing
  const getPacingColor = (status: string) => {
    switch (status) {
      case 'on_track': return 'bg-green-100 text-green-800';
      case 'under_pacing': return 'bg-blue-100 text-blue-800';
      case 'over_pacing': return 'bg-yellow-100 text-yellow-800';
      case 'budget_exceeded': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const hasDataIssues = readiness.analytics.status === 'blocked';

  return (
    <div className="flex flex-col h-full shadow-sm hover:shadow-md transition-shadow bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="pb-3 border-b bg-gray-50/50 p-4">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <ClientLogo 
              name={client?.company || client?.name || performance.clientName || 'Cliente'} 
              logoUrl={client?.logoUrl} 
              size="sm" 
            />
            <div>
              <h3 className="font-semibold text-gray-900 line-clamp-1">{client?.company || client?.name || performance.clientName || 'Cliente Desconhecido'}</h3>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                {profile?.operationType && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-800 border border-gray-200">{profile.operationType}</span>}
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

      <div className="flex-1 p-4 pt-4">
        {readiness.analytics.status === 'blocked' ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
            <HelpCircle className="h-5 w-5 text-gray-400" />
            <p className="text-sm font-medium text-gray-600">
              {readiness.analytics.missing[0] || readiness.analytics.warnings[0] || 'Cliente ainda não pode ser analisado'}
            </p>
            {readiness.analytics.action && (
              <button
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                onClick={() => onOpenDetails(performance)}
              >
                {readiness.analytics.action}
              </button>
            )}
          </div>
        ) : (
          <>
            {readiness.analytics.status === 'limited' && readiness.analytics.warnings.length > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>{readiness.analytics.warnings.join(' ')}</span>
              </div>
            )}
            <ClientAnalyticsStatusPanel decision={decision} />

            <div className="mt-4 pt-4 border-t border-gray-100">
              <ClientPrimaryMetricBlock performance={performance} />
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-600">Orçamento mensal</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getPacingColor(budgetPacing.status)}`}>
                  {budgetPacing.statusText}
                </span>
              </div>

              {budgetPacing.status === 'no_budget' ? (
                <div className="text-sm text-gray-500 italic py-1">
                  Orçamento não configurado
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="bg-gray-50 p-2 rounded flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Planejado</span>
                    <span className="font-semibold text-sm">{formatCurrency(budgetPacing.plannedMonthlyBudget)}</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Gasto</span>
                    <span className="font-semibold text-sm">{formatCurrency(budgetPacing.actualSpend)}</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Restante</span>
                    <span className={`font-semibold text-sm ${
                      budgetPacing.remainingBudget !== null && budgetPacing.remainingBudget < 0 ? 'text-red-600' : 'text-gray-900'
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

      <div className="p-4 border-t bg-gray-50/30 flex justify-between gap-2 mt-auto">
        <button 
          className="w-full text-xs inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          onClick={() => onOpenDetails(performance)}
        >
          Ver detalhes
        </button>
        <button 
          className="w-full text-xs inline-flex items-center justify-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          disabled={hasDataIssues}
          onClick={() => onOpenCampaigns(performance)}
        >
          Ver campanhas
        </button>
      </div>
    </div>
  );
}
