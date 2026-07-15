import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, XCircle } from 'lucide-react';
import type { OperationalHealthTag } from '../../lib/performance/clientPriorityGrouping';

interface Tone {
  label: string;
  icon: React.ReactNode;
  className: string;
}

/** Os 6 status visuais padronizados do dashboard operacional. */
export const OPERATIONAL_HEALTH_TONE: Record<OperationalHealthTag, Tone> = {
  ready: { label: 'Pronto', icon: <CheckCircle2 size={12} />, className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
  attention: { label: 'Atenção', icon: <AlertTriangle size={12} />, className: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
  critical: { label: 'Crítico', icon: <XCircle size={12} />, className: 'border-rose-400/30 bg-rose-400/10 text-rose-300' },
  insufficient_data: { label: 'Poucos dados', icon: <HelpCircle size={12} />, className: 'border-sky-400/30 bg-sky-400/10 text-sky-300' },
  sync_failed: { label: 'Falha de sync', icon: <XCircle size={12} />, className: 'border-rose-400/30 bg-rose-400/10 text-rose-300' },
  sync_partial: { label: 'Parcial', icon: <CircleDashed size={12} />, className: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
};

export function OperationalHealthBadge({ tag }: { tag: OperationalHealthTag }) {
  const tone = OPERATIONAL_HEALTH_TONE[tag];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone.className}`}>
      {tone.icon}
      {tone.label}
    </span>
  );
}
