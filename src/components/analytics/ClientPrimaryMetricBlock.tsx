import React from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { getClientPrimaryMetricView } from '../../lib/performance/clientAnalyticsDecision';

interface ClientPrimaryMetricBlockProps {
  performance: EnrichedGlobalClientPerformance;
}

function formatValue(value: number | null, type: 'currency' | 'number' | 'percent' | 'multiplier' = 'number'): string {
  if (value === null) return 'Sem valor confiável';

  if (type === 'currency') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }
  if (type === 'percent') {
    return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 }).format(value / 100);
  }
  if (type === 'multiplier') {
    return `${value.toFixed(2)}x`;
  }
  return new Intl.NumberFormat('pt-BR').format(value);
}

// Só métricas de custo/ROAS/CTR/CPM entram como "sem valor confiável" quando
// null - o resultado principal (actual) usa "0" como leitura honesta de
// "nenhum resultado no período", não "sem dado".
const COST_FORMAT: Record<string, 'currency' | 'percent' | 'multiplier'> = {
  CPA: 'currency',
  CPL: 'currency',
  'Custo/Conversa': 'currency',
  CPC: 'currency',
  ROAS: 'multiplier',
  CTR: 'percent',
  CPM: 'currency',
};

export function ClientPrimaryMetricBlock({ performance }: ClientPrimaryMetricBlockProps) {
  // performance.client é o registro local do workspace (sem perfil analítico);
  // o perfil comercial de fato vem do nível superior, populado a partir de
  // client_analysis_profiles em globalPerformanceDashboard.ts.
  const profile = performance.analysisProfile;
  const view = getClientPrimaryMetricView(
    profile,
    performance.metrics ?? {},
    performance.metricGroups ?? [],
    performance.resolvedTargets ?? []
  );

  if (view.status === 'no_profile') {
    return (
      <div className="flex items-center text-sm text-gray-500 italic py-2">
        Meta principal não configurada
      </div>
    );
  }

  if (view.status === 'unmapped') {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-gray-600 mb-1">
          <span className="font-medium">Meta configurada:</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
            {view.label}
          </span>
        </div>
      </div>
    );
  }

  const cells = [
    { label: `${view.label} (realizado)`, value: formatValue(view.actual) },
    ...(view.costMetric ? [{ label: view.costMetric.label, value: formatValue(view.costMetric.value, COST_FORMAT[view.costMetric.label] ?? 'currency') }] : []),
    ...(view.secondaryMetric ? [{ label: view.secondaryMetric.label, value: formatValue(view.secondaryMetric.value, COST_FORMAT[view.secondaryMetric.label] ?? 'number') }] : []),
  ];

  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between items-center text-gray-600 mb-1">
        <span className="font-medium">Meta configurada:</span>
        <span>{view.label}</span>
      </div>
      <div className={`grid gap-2 ${cells.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {cells.map((cell) => (
          <div key={cell.label} className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">{cell.label}</span>
            <span className="font-semibold">{cell.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
