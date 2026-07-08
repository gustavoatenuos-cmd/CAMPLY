import { resolveClientDecision } from '../../lib/performance/clientDecisionState';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { ClientPrimaryMetricBlock } from './ClientPrimaryMetricBlock';
import { ClientLogo } from '../clients/ClientLogo';
import { Clock, AlertCircle, CalendarX2 } from 'lucide-react';
import { PerformanceStatusBadge } from '../performance/PerformanceStatusBadge';

interface ClientAnalyticsCardProps {
  performance: EnrichedGlobalClientPerformance;
  onOpenCampaigns: (performance: EnrichedGlobalClientPerformance) => void;
  onOpenDetails: (performance: EnrichedGlobalClientPerformance) => void;
}

export function ClientAnalyticsCard({ performance, onOpenCampaigns, onOpenDetails }: ClientAnalyticsCardProps) {
  const { client, score } = performance;
  const profile = performance.analysisProfile;
  const performanceScore = score?.value;

  const decision = resolveClientDecision({ performance });
  const currency = performance.accounts && performance.accounts.length > 0 && performance.accounts[0].currency ? performance.accounts[0].currency : 'BRL';

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(val);
  };

  // Determine badge color for pacing
  const getPacingColor = (status: string) => {
    switch (status) {
      case 'on_track': return 'bg-green-100 text-green-800';
      case 'under_spending': return 'bg-blue-100 text-blue-800';
      case 'over_spending': return 'bg-yellow-100 text-yellow-800';
      case 'exceeded': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusDisplay = () => {
    if (decision.dataStatus === 'not_connected') {
      return (
        <div className="flex items-center justify-center p-4 bg-gray-50 border border-gray-200 rounded text-gray-500 gap-2 text-sm mt-4">
          <AlertCircle className="h-4 w-4" />
          <span>Conta Meta não vinculada</span>
        </div>
      );
    }
    if (decision.dataStatus === 'never_synced') {
      return (
        <div className="flex items-center justify-center p-4 bg-gray-50 border border-gray-200 rounded text-gray-500 gap-2 text-sm mt-4">
          <Clock className="h-4 w-4" />
          <span>Nunca sincronizado</span>
        </div>
      );
    }
    if (decision.dataStatus === 'period_not_synced') {
      return (
        <div className="flex items-center justify-center p-4 bg-gray-50 border border-gray-200 rounded text-gray-500 gap-2 text-sm mt-4">
          <CalendarX2 className="h-4 w-4" />
          <span>Período atual não sincronizado</span>
        </div>
      );
    }
    return null;
  };

  const hasDataIssues = decision.macroStatus === 'not_connected' || decision.macroStatus === 'no_data';
  const mainAlert = decision.alerts.length > 0 ? decision.alerts[0] : null;

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
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border
              ${performanceScore && performanceScore > 80 ? 'bg-green-50 text-green-700 border-green-200' : 
                performanceScore && performanceScore > 50 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 
                performanceScore ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}
            `}>
              Score: {performanceScore ? Math.round(performanceScore) : '-'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 pt-4">
        {hasDataIssues ? (
          getStatusDisplay()
        ) : (
          <>
            <ClientPrimaryMetricBlock performance={performance} />

            {mainAlert ? (
              <div className="mt-3 text-xs p-2 rounded bg-red-50 text-red-800 border border-red-100 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{mainAlert.title}</p>
                  <p className="text-red-700/80 line-clamp-1">{mainAlert.description}</p>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[11px] p-2 rounded bg-green-50 text-green-800 border border-green-100 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                <span>Sem alertas críticos.</span>
              </div>
            )}
            
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-600">Orçamento mensal</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getPacingColor(decision.budget.status)}`}>
                  {decision.budget.label}
                </span>
              </div>

              {decision.budget.status === 'no_budget' ? (
                <div className="text-sm text-gray-500 italic py-1">
                  Orçamento não configurado
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="bg-gray-50 p-2 rounded flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Planejado</span>
                    <span className="font-semibold text-sm">{formatCurrency(decision.budget.plannedMonthlyBudget)}</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Gasto</span>
                    <span className="font-semibold text-sm">{formatCurrency(decision.budget.actualSpend)}</span>
                  </div>
                  <div className="bg-gray-50 p-2 rounded flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Restante</span>
                    <span className={`font-semibold text-sm ${
                      decision.budget.remainingBudget !== null && decision.budget.remainingBudget < 0 ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {formatCurrency(decision.budget.remainingBudget)}
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
