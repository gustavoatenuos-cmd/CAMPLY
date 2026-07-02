import type { PerformanceScore } from '../../lib/performance/performanceScore';

const styles: Record<PerformanceScore['status'], string> = {
  excellent: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  healthy: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  attention: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  critical: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  unavailable: 'border-brand-line bg-white/5 text-brand-muted',
};

const labels: Record<PerformanceScore['status'], string> = {
  excellent: 'Excelente',
  healthy: 'Saudável',
  attention: 'Atenção',
  critical: 'Crítico',
  unavailable: 'Sem pontuação',
};

export function PerformanceScoreBadge({ score, compact = false }: { score: PerformanceScore; compact?: boolean }) {
  return (
    <span
      title={`${score.summary} Confiança: ${score.confidence}%. Cobertura: ${score.coveragePercent}%.`}
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-bold ${styles[score.status]}`}
    >
      <span className="text-sm font-black">{score.value ?? '—'}</span>
      {!compact && <span>{labels[score.status]}</span>}
    </span>
  );
}
