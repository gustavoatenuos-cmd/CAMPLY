import { useMemo, useState } from 'react';
import { Scale, X } from 'lucide-react';
import type { TraceableMetric } from '../../lib/performance/traceableMetrics';
import { metricTraceLabel } from '../../lib/performance/traceableMetrics';
import { reconcileTraceableMetric } from '../../lib/meta/reconciliationService';

const metrics = [
  ['spend', 'Investimento'],
  ['impressions', 'Impressões'],
  ['link_clicks', 'Cliques no link'],
  ['messaging_conversations_started_total', 'Conversas'],
  ['leads', 'Leads'],
  ['purchases', 'Compras'],
] as const;

export function MetricReconciliationPanel({
  open,
  onClose,
  entityName,
  metricMap,
}: {
  open: boolean;
  onClose: () => void;
  entityName: string;
  metricMap: Record<string, TraceableMetric>;
}) {
  const [references, setReferences] = useState<Record<string, string>>({});
  const results = useMemo(() => metrics.map(([metricId, label]) => ({
    metricId,
    label,
    result: reconcileTraceableMetric(
      metricMap[metricId],
      references[metricId] === undefined || references[metricId] === '' ? null : Number(references[metricId]),
      metricId === 'spend' ? 0.5 : 1
    ),
  })), [metricMap, references]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3">
      <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-brand-line bg-brand-ink shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-brand-line bg-brand-ink p-5">
          <div>
            <div className="flex items-center gap-2"><Scale className="text-brand-green" size={20} /><h2 className="text-xl font-black text-white">Conciliação de métricas</h2></div>
            <p className="mt-1 text-sm text-brand-muted">{entityName} · informe valores do Meta Ads Manager com os mesmos parâmetros.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar conciliação" className="rounded-lg p-2 text-brand-muted hover:bg-brand-surface hover:text-white"><X size={20} /></button>
        </header>
        <div className="overflow-x-auto p-5">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-brand-muted"><tr><th className="p-3">Métrica</th><th className="p-3">Meta Ads</th><th className="p-3">CAMPLY</th><th className="p-3">Diferença</th><th className="p-3">Status</th><th className="p-3">Causa provável</th></tr></thead>
            <tbody className="divide-y divide-brand-line">
              {results.map(({ metricId, label, result }) => (
                <tr key={metricId}>
                  <td className="p-3 font-bold text-white" title={metricMap[metricId] ? metricTraceLabel(metricMap[metricId]) : undefined}>{label}</td>
                  <td className="p-3"><input aria-label={`Referência ${label}`} type="number" step="0.01" value={references[metricId] || ''} onChange={(event) => setReferences((current) => ({ ...current, [metricId]: event.target.value }))} className="w-32 rounded-lg border border-brand-line bg-brand-surface px-2 py-1.5 text-white" /></td>
                  <td className="p-3 text-white">{result.camplyValue?.toLocaleString('pt-BR') ?? '—'}</td>
                  <td className="p-3 text-white">{result.absoluteDifference?.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) ?? '—'}{result.percentageDifference !== null ? ` (${result.percentageDifference.toFixed(2)}%)` : ''}</td>
                  <td className="p-3"><span className="rounded-full bg-white/5 px-2 py-1 text-xs font-bold text-brand-soft">{result.status}</span></td>
                  <td className="max-w-xs p-3 text-xs text-brand-muted">{result.probableCause}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
