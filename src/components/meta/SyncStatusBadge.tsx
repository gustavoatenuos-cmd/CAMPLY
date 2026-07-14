import { AlertTriangle, CheckCircle2, CircleDashed, Clock, RefreshCw } from 'lucide-react';
import type { BulkSyncAccountStatus } from '../../lib/meta/bulkSyncDiagnostics';

interface StatusTone {
  label: string;
  icon: React.ReactNode;
  className: string;
}

// Cores/ícones deliberadamente distintos do ícone de "vínculo salvo" - este
// badge é sobre o resultado da ÚLTIMA sincronização, não sobre o vínculo.
export const SYNC_STATUS_TONE: Record<BulkSyncAccountStatus, StatusTone> = {
  pending: { label: 'Pendente', icon: <Clock size={13} />, className: 'bg-white/5 text-brand-muted' },
  running: { label: 'Sincronizando', icon: <RefreshCw size={13} className="animate-spin" />, className: 'bg-blue-400/10 text-blue-300' },
  success: { label: 'Sucesso', icon: <CheckCircle2 size={13} />, className: 'bg-emerald-400/10 text-emerald-200' },
  partial: { label: 'Parcial', icon: <CircleDashed size={13} />, className: 'bg-amber-400/10 text-amber-200' },
  already_running: { label: 'Em andamento', icon: <Clock size={13} />, className: 'bg-sky-400/10 text-sky-200' },
  failed: { label: 'Falha', icon: <AlertTriangle size={13} />, className: 'bg-rose-400/10 text-rose-200' },
};

export function SyncStatusBadge({ status }: { status: BulkSyncAccountStatus }) {
  const tone = SYNC_STATUS_TONE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.className}`}>
      {tone.icon}
      {tone.label}
    </span>
  );
}
