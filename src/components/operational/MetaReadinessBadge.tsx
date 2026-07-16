import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from 'lucide-react';
import type { MetaReadinessStatus } from '../../lib/operational/clientOperationalReadiness';

interface StatusTone {
  label: string;
  icon: React.ReactNode;
  className: string;
}

// Sobre o estado Meta já conhecido (última sincronização registrada), não sobre
// o resultado de uma sincronização em andamento - ver SyncStatusBadge para isso.
export const META_READINESS_TONE: Record<MetaReadinessStatus, StatusTone> = {
  ready: { label: 'Pronto', icon: <CheckCircle2 size={13} />, className: 'bg-emerald-400/10 text-emerald-200' },
  partial: { label: 'Parcial', icon: <CircleDashed size={13} />, className: 'bg-amber-400/10 text-amber-200' },
  stale: { label: 'Desatualizado', icon: <Clock size={13} />, className: 'bg-amber-400/10 text-amber-200' },
  failed: { label: 'Falha', icon: <AlertTriangle size={13} />, className: 'bg-rose-400/10 text-rose-200' },
  blocked: { label: 'Bloqueado', icon: <AlertTriangle size={13} />, className: 'bg-rose-400/10 text-rose-200' },
};

export function MetaReadinessBadge({ status }: { status: MetaReadinessStatus }) {
  const tone = META_READINESS_TONE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.className}`}>
      {tone.icon}
      {tone.label}
    </span>
  );
}
