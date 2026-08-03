import { useMemo } from 'react';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import {
  buildClientMetricComparisons,
  type ClientMetricComparison,
  type ClientMetricComparisonStatus,
} from '../../lib/performance/clientMetricComparison';

interface ClientMetricComparisonGridProps {
  performance: GlobalClientPerformance;
  compact?: boolean;
}

const STATUS_COPY: Record<ClientMetricComparisonStatus, { label: string; className: string }> = {
  on_track: { label: 'Dentro da meta', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  attention: { label: 'Atenção', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  critical: { label: 'Fora da meta', className: 'bg-red-50 text-red-700 border-red-200' },
  insufficient_data: { label: 'Dados insuficientes', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  partial_data: { label: 'Dados parciais', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  unavailable: { label: 'Indisponível', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  observed: { label: 'Monitorada', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
};

function formatValue(comparison: ClientMetricComparison, value: number | null): string {
  if (value === null) return 'Sem valor confiável';
  if (comparison.format === 'currency') {
    if (!comparison.currency) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: comparison.currency }).format(value);
    } catch {
      return `${comparison.currency} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
    }
  }
  if (comparison.format === 'percent') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (comparison.format === 'multiplier') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function expectation(comparison: ClientMetricComparison): string {
  if (comparison.targetKind === 'none') return 'Alvo numérico não configurado';
  if (comparison.targetKind === 'budget_pacing') return `Ritmo esperado: ${formatValue(comparison, comparison.targetValue)}`;
  if (comparison.targetKind === 'target_range' && comparison.targetMin !== null && comparison.targetMax !== null) {
    return `Esperado: ${formatValue(comparison, comparison.targetMin)} a ${formatValue(comparison, comparison.targetMax)}`;
  }
  if (comparison.targetKind === 'maximum_metric' || comparison.targetKind === 'cost_per_result') {
    return `Esperado: até ${formatValue(comparison, comparison.targetValue)}`;
  }
  if (comparison.targetKind === 'minimum_metric' || comparison.targetKind === 'minimum_results') {
    return `Esperado: mínimo ${formatValue(comparison, comparison.targetValue)}`;
  }
  return `Esperado: ${formatValue(comparison, comparison.targetValue)}`;
}

function differenceText(comparison: ClientMetricComparison): string {
  if (comparison.targetKind === 'none') return 'Acompanhamento sem julgamento de meta';
  if (comparison.actualValue === null) return 'O snapshot não trouxe um valor comparável';
  if (comparison.differencePercent === null) return STATUS_COPY[comparison.status].label;
  if (comparison.status === 'on_track') return 'Dentro da expectativa configurada';
  return `Desvio de ${Math.abs(comparison.differencePercent).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function ClientMetricComparisonGrid({ performance, compact = false }: ClientMetricComparisonGridProps) {
  const comparisons = useMemo(() => buildClientMetricComparisons(performance), [performance]);
  const visible = compact ? comparisons.slice(0, 4) : comparisons;
  const hiddenCount = comparisons.length - visible.length;

  if (comparisons.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
        Configure as métricas do perfil ou metas da conta para comparar o esperado com os dados da Meta.
      </div>
    );
  }

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`} data-testid="client-metric-comparisons">
      {visible.map((comparison) => {
        const tone = STATUS_COPY[comparison.status];
        return (
          <article key={comparison.key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-gray-900">{comparison.label}</p>
                <p className="mt-0.5 truncate text-[10px] text-gray-500">{comparison.scopeLabel}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.className}`}>
                {tone.label}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Realizado Meta</p>
                <p className="text-sm font-bold text-gray-900">{formatValue(comparison, comparison.actualValue)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Referência</p>
                <p className="text-xs font-semibold text-gray-700">{expectation(comparison)}</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">{differenceText(comparison)}</p>
          </article>
        );
      })}
      {hiddenCount > 0 && (
        <p className="text-xs text-gray-500">Mais {hiddenCount} comparação(ões) disponível(is) em “Ver detalhes”.</p>
      )}
    </div>
  );
}
