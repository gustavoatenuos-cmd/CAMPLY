import { AlertTriangle, CheckCircle2, CircleDashed, Clock, HelpCircle } from 'lucide-react';
import type { ClientAnalyticsDecision } from '../../lib/performance/clientAnalyticsDecision';

interface StatusTone {
  label: string;
  icon: React.ReactNode;
  badgeClass: string;
}

export const STATUS_TONE: Record<ClientAnalyticsDecision['status'], StatusTone> = {
  healthy: { label: 'Saudável', icon: <CheckCircle2 className="h-3.5 w-3.5" />, badgeClass: 'bg-emerald-400/10 text-emerald-300 border border-emerald-400/20' },
  attention: { label: 'Atenção', icon: <CircleDashed className="h-3.5 w-3.5" />, badgeClass: 'bg-amber-400/10 text-amber-300 border border-amber-400/20' },
  critical: { label: 'Crítico', icon: <AlertTriangle className="h-3.5 w-3.5" />, badgeClass: 'bg-rose-400/10 text-rose-300 border border-rose-400/20' },
  no_profile: { label: 'Perfil pendente', icon: <HelpCircle className="h-3.5 w-3.5" />, badgeClass: 'bg-white/[0.04] text-brand-muted border border-brand-line' },
  no_data: { label: 'Sem dados', icon: <Clock className="h-3.5 w-3.5" />, badgeClass: 'bg-white/[0.04] text-brand-muted border border-brand-line' },
  stale_data: { label: 'Dados desatualizados', icon: <Clock className="h-3.5 w-3.5" />, badgeClass: 'bg-sky-400/10 text-sky-300 border border-sky-400/20' },
};

function money(value: number | null): string | null {
  if (value === null) return null;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function number(value: number | null): string | null {
  if (value === null) return null;
  return Math.round(value).toLocaleString('pt-BR');
}

interface StatGridItem {
  label: string;
  value: string;
}

function buildStatGrid(decision: ClientAnalyticsDecision): StatGridItem[] {
  const { primaryMetric, target, actual, gap, projection } = decision;
  const items: StatGridItem[] = [];
  const resultLabel = primaryMetric.label;

  if (target.costCeiling !== null) {
    items.push({ label: `${resultLabel}: meta de custo`, value: `até ${money(target.costCeiling)}` });
  } else if (target.minVolume !== null) {
    items.push({ label: `Meta de ${resultLabel.toLowerCase()}`, value: number(target.minVolume) ?? '-' });
  } else if (target.minRoas !== null) {
    items.push({ label: 'ROAS mínimo', value: `${target.minRoas.toFixed(2)}x` });
  }

  if (actual.resultCount !== null) {
    const cost = actual.costPerResult !== null ? ` (${money(actual.costPerResult)}/${resultLabel.toLowerCase().replace(/s$/, '')})` : '';
    items.push({ label: `${resultLabel} no período`, value: `${number(actual.resultCount)}${cost}` });
  }

  if (gap.costDifferencePercent !== null) {
    const sign = gap.costDifferencePercent > 0 ? 'acima' : 'abaixo';
    items.push({ label: 'Diferença vs. meta', value: `${Math.abs(gap.costDifferencePercent).toFixed(1)}% ${sign}` });
  } else if (gap.volumeDeficit !== null && gap.volumeDeficit > 0) {
    items.push({ label: 'Déficit projetado', value: `${number(gap.volumeDeficit)} ${resultLabel.toLowerCase()}` });
  }

  if (projection.projectedResult !== null) {
    items.push({ label: 'Projeção do mês', value: `${number(projection.projectedResult)} ${resultLabel.toLowerCase()}` });
  }

  return items;
}

export function ClientAnalyticsStatusPanel({ decision }: { decision: ClientAnalyticsDecision }) {
  const tone = STATUS_TONE[decision.status];
  const showStatGrid = decision.status === 'healthy' || decision.status === 'attention' || decision.status === 'critical';
  const statGrid = showStatGrid ? buildStatGrid(decision) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${tone.badgeClass}`}>
          {tone.icon}
          {tone.label}
        </span>
        {decision.dataQuality.status === 'partial' && (
          <span className="text-[11px] font-medium text-amber-300">Dados parciais — leitura limitada</span>
        )}
      </div>

      <p className="text-sm leading-snug text-brand-muted">{decision.recommendation}</p>

      {statGrid.length > 0 && (
        <div className="hidden gap-2 lg:grid lg:grid-cols-2">
          {statGrid.map((item) => (
            <div key={item.label} className="border-l border-brand-line pl-3">
              <p className="text-[10px] text-brand-muted">{item.label}</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
