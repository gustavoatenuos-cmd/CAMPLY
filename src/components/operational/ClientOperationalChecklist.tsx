import type { ClientOperationalReadiness, ReadinessArea } from '../../lib/operational/clientOperationalReadiness';
import { ClientReadinessBanner } from './ClientReadinessBanner';

const AREA_STATUS_TONE: Record<string, string> = {
  ready: 'text-emerald-300',
  blocked: 'text-rose-300',
  failed: 'text-rose-300',
  limited: 'text-amber-300',
  partial: 'text-amber-300',
  stale: 'text-amber-300',
  inactive: 'text-brand-muted',
};

const AREA_ORDER: Array<{ key: keyof Omit<ClientOperationalReadiness, 'clientId' | 'globalStatus'>; label: string }> = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'meta', label: 'Meta Ads' },
  { key: 'campaigns', label: 'Campanhas' },
  { key: 'finance', label: 'Recebimentos' },
];

function AreaCard({ areaKey, label, area }: { areaKey: string; label: string; area: ReadinessArea<string> }) {
  return (
    <div
      data-testid={`client-readiness-area-${areaKey}`}
      className="rounded-lg border border-brand-line bg-brand-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-green">{label}</p>
        <span className={`text-xs font-bold ${AREA_STATUS_TONE[area.status] ?? 'text-brand-muted'}`}>
          {area.status}
        </span>
      </div>
      {area.missing.length > 0 && (
        <p className="mt-1.5 text-xs text-rose-200">Falta: {area.missing.join(', ')}</p>
      )}
      {area.warnings.length > 0 && (
        <p className="mt-1 text-xs text-amber-200">{area.warnings.join(' ')}</p>
      )}
      {area.action && <p className="mt-2 text-xs font-semibold text-brand-soft">Ação: {area.action}</p>}
    </div>
  );
}

interface ClientOperationalChecklistProps {
  readiness: ClientOperationalReadiness;
}

/** Checklist expandido por área, usado onde o usuário precisa entender exatamente o que falta para cada cliente. */
export function ClientOperationalChecklist({ readiness }: ClientOperationalChecklistProps) {
  return (
    <div data-testid="client-operational-checklist" className="space-y-3">
      <ClientReadinessBanner readiness={readiness} />
      <div className="grid gap-2 sm:grid-cols-2">
        {AREA_ORDER.map(({ key, label }) => (
          <AreaCard key={key} areaKey={key} label={label} area={readiness[key]} />
        ))}
      </div>
    </div>
  );
}
