import React from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { resolveClientDecision } from '../../lib/performance/clientDecisionState';

interface ClientPrimaryMetricBlockProps {
  performance: EnrichedGlobalClientPerformance;
}

export function ClientPrimaryMetricBlock({ performance }: ClientPrimaryMetricBlockProps) {
  const decision = resolveClientDecision({ performance });
  
  if (decision.macroStatus === 'not_configured') {
    return (
      <div className="flex items-center text-sm text-gray-500 italic py-2">
        Meta principal não configurada
      </div>
    );
  }

  const { primaryMetric, efficiencyMetric } = decision;

  let extraMetricLabel = null;
  let extraMetricValue = null;

  if (primaryMetric.metricId === 'purchases') {
    extraMetricLabel = 'ROAS';
    const roasEval = performance.evaluations?.find(e => e.metricId === 'purchase_roas');
    extraMetricValue = roasEval?.actualValue ? `${roasEval.actualValue.toFixed(2)}x` : '-';
  } else if (primaryMetric.metricId === 'reach') {
    extraMetricLabel = 'Freq.';
    const freqVal = performance.metrics?.frequency?.value;
    extraMetricValue = freqVal ? `${freqVal.toFixed(2)}x` : '-';
  } else if (primaryMetric.metricId === 'traffic') {
    extraMetricLabel = 'CTR';
    const ctrVal = performance.metrics?.link_ctr?.value;
    extraMetricValue = ctrVal ? `${ctrVal.toFixed(2)}%` : '-';
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between items-center text-gray-600 mb-1">
        <span className="font-medium">Meta configurada:</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
          {primaryMetric.label}
        </span>
      </div>
      <div className={`grid gap-2 ${extraMetricLabel ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="bg-gray-50 p-2 rounded flex flex-col">
          <span className="text-xs text-gray-500">{primaryMetric.label}</span>
          <span className="font-semibold">{primaryMetric.formattedActual}</span>
        </div>
        {efficiencyMetric && (
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">{efficiencyMetric.label}</span>
            <span className="font-semibold">{efficiencyMetric.formattedValue}</span>
          </div>
        )}
        {extraMetricLabel && (
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">{extraMetricLabel}</span>
            <span className="font-semibold">{extraMetricValue}</span>
          </div>
        )}
      </div>
    </div>
  );
}
