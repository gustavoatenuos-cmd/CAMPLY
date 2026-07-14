import type { CampaignEligibilityVerdict } from '../../lib/performance/campaignDecisionEligibility';

const styles: Record<CampaignEligibilityVerdict, string> = {
  ANALYZABLE: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  ACTIVE_NO_DELIVERY: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  ACTIVE_WITHOUT_ACTIVE_STRUCTURE: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  PAUSED_WITH_SPEND: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  UNCLASSIFIED_DESTINATION: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  STALE_SNAPSHOT: 'border-brand-line bg-white/5 text-brand-muted',
  NOT_OPERATIONAL: 'border-brand-line bg-white/5 text-brand-muted',
};

const labels: Record<CampaignEligibilityVerdict, string> = {
  ANALYZABLE: 'Ativa no último sync',
  ACTIVE_NO_DELIVERY: 'Ativa sem entrega',
  ACTIVE_WITHOUT_ACTIVE_STRUCTURE: 'Ativa sem estrutura ativa',
  PAUSED_WITH_SPEND: 'Pausada com gasto',
  UNCLASSIFIED_DESTINATION: 'Objetivo não classificado',
  STALE_SNAPSHOT: 'Sem sincronização confiável',
  NOT_OPERATIONAL: 'Fora da operação',
};

export function CampaignActivityStatusBadge({ verdict }: { verdict: CampaignEligibilityVerdict }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${styles[verdict]}`}>
      {labels[verdict]}
    </span>
  );
}
