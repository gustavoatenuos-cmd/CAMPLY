import type { ReactNode } from 'react';
import { metricTraceLabel, type TraceableMetric } from '../../lib/performance/traceableMetrics';

export function TraceableMetricValue({
  metric,
  children,
  className = '',
}: {
  metric: TraceableMetric | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (!metric) return <span className={className}>{children}</span>;

  const trace = metricTraceLabel(metric);
  return (
    <span
      title={trace}
      tabIndex={0}
      className={`cursor-help underline decoration-dotted underline-offset-4 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green ${className}`}
    >
      {children}
      <span className="sr-only">. Detalhes: {trace.split('\n').join('. ')}</span>
    </span>
  );
}
