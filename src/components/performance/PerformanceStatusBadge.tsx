import type { PerformanceStatus } from '../../lib/performance/types';

const styles: Record<PerformanceStatus, string> = {
  on_track: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  attention: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  critical: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  insufficient_data: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  partial_data: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  unavailable: 'border-brand-line bg-white/5 text-brand-muted',
};

const labels: Record<PerformanceStatus, string> = {
  on_track: 'Dentro da meta',
  attention: 'Atenção',
  critical: 'Crítico',
  insufficient_data: 'Poucos dados',
  partial_data: 'Dados parciais',
  unavailable: 'Indisponível',
};

export function PerformanceStatusBadge({ status }: { status: PerformanceStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
