import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, PauseCircle } from 'lucide-react';
import {
  buildReadinessSummaryMessage,
  type ClientOperationalReadiness,
  type GlobalReadinessStatus,
} from '../../lib/operational/clientOperationalReadiness';

interface GlobalTone {
  label: string;
  icon: ReactNode;
  badgeClass: string;
}

const GLOBAL_TONE: Record<GlobalReadinessStatus, GlobalTone> = {
  ready: {
    label: 'Pronto',
    icon: <CheckCircle2 size={16} />,
    badgeClass: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  },
  attention: {
    label: 'Atenção',
    icon: <CircleDashed size={16} />,
    badgeClass: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  },
  blocked: {
    label: 'Bloqueado',
    icon: <AlertTriangle size={16} />,
    badgeClass: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  },
  inactive: {
    label: 'Inativo',
    icon: <PauseCircle size={16} />,
    badgeClass: 'border-brand-line bg-white/5 text-brand-muted',
  },
};

interface ClientReadinessBannerProps {
  readiness: ClientOperationalReadiness;
  className?: string;
}

/** Banner compacto e único, reutilizado em todas as telas que precisam mostrar se um cliente está pronto. */
export function ClientReadinessBanner({ readiness, className = '' }: ClientReadinessBannerProps) {
  const tone = GLOBAL_TONE[readiness.globalStatus];
  const message = buildReadinessSummaryMessage(readiness);

  return (
    <div
      data-testid="client-readiness-banner"
      data-status={readiness.globalStatus}
      className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${tone.badgeClass} ${className}`}
    >
      <span className="mt-0.5 shrink-0">{tone.icon}</span>
      <div className="min-w-0">
        <p className="font-bold">{tone.label}</p>
        <p className="mt-0.5 text-xs leading-snug opacity-90">{message}</p>
      </div>
    </div>
  );
}
