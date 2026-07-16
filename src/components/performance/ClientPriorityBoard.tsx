import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Siren } from 'lucide-react';
import {
  clientSpend,
  groupByPriorityTier,
  operationalHealthTagFor,
  PRIORITY_TIER_LABELS,
  reasonLabel,
  technicalSyncReason,
  type ClientPriorityEntry,
  type PriorityTier,
} from '../../lib/performance/clientPriorityGrouping';
import { OperationalHealthBadge } from './OperationalHealthBadge';
import { resolveClientPrimaryName } from '../../data/clientDisplay';

interface ClientPriorityBoardProps {
  entries: ClientPriorityEntry[];
  onSelectClient: (clientId: string) => void;
}

const TIER_ICON: Record<PriorityTier, typeof Siren> = {
  action_now: Siren,
  attention: AlertTriangle,
  healthy: CheckCircle2,
};

const TIER_TONE: Record<PriorityTier, string> = {
  action_now: 'border-rose-400/25 bg-rose-400/[0.04]',
  attention: 'border-amber-400/25 bg-amber-400/[0.04]',
  healthy: 'border-emerald-400/25 bg-emerald-400/[0.04]',
};

const HEALTHY_PREVIEW_LIMIT = 6;

function formatSpend(entry: ClientPriorityEntry): string | null {
  const spend = clientSpend(entry.client);
  if (spend <= 0) return null;
  const currency = entry.client.accounts[0]?.currency || 'BRL';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(spend);
  } catch {
    return spend.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
}

function ClientPriorityRow({ entry, onSelectClient }: { entry: ClientPriorityEntry; onSelectClient: (clientId: string) => void }) {
  const tag = operationalHealthTagFor(entry);
  const spend = formatSpend(entry);
  const reasons = entry.reasons.filter((reason) => reason !== 'healthy');
  const technicalReason = tag === 'sync_partial' || tag === 'sync_failed' ? technicalSyncReason(entry.client) : null;

  return (
    <button
      type="button"
      data-testid="client-priority-row"
      onClick={() => onSelectClient(entry.client.clientId)}
      className="flex w-full items-start justify-between gap-3 rounded-xl border border-transparent bg-black/15 p-3 text-left transition hover:border-white/10 hover:bg-black/25"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-white">
          {resolveClientPrimaryName(entry.workspaceClient, entry.client.analysisProfile, entry.client)}
        </p>
        <p className="mt-1 truncate text-xs text-brand-muted">
          {reasons.length > 0 ? reasons.map((reason) => reasonLabel(reason)).join(' · ') : 'Sem pendências'}
        </p>
        {technicalReason && (
          <p className="mt-0.5 truncate text-[10px] text-brand-muted/80">Motivo técnico: {technicalReason}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <OperationalHealthBadge tag={tag} />
        {spend && <span className="text-[10px] text-brand-muted">{spend}</span>}
      </div>
    </button>
  );
}

function PriorityTierColumn({
  tier,
  entries,
  onSelectClient,
}: {
  tier: PriorityTier;
  entries: ClientPriorityEntry[];
  onSelectClient: (clientId: string) => void;
}) {
  const Icon = TIER_ICON[tier];
  const [expanded, setExpanded] = useState(false);
  const isCappable = tier === 'healthy' && entries.length > HEALTHY_PREVIEW_LIMIT;
  const visible = isCappable && !expanded ? entries.slice(0, HEALTHY_PREVIEW_LIMIT) : entries;

  return (
    <div data-testid={`priority-column-${tier}`} className={`rounded-2xl border p-4 ${TIER_TONE[tier]}`}>
      <div className="flex items-center gap-2">
        <Icon size={16} className="shrink-0 text-white/80" />
        <h3 className="text-sm font-black text-white">{PRIORITY_TIER_LABELS[tier]}</h3>
        <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">{entries.length}</span>
      </div>

      <div className="mt-3 space-y-2">
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-brand-muted">
            Nenhum cliente neste grupo.
          </p>
        ) : (
          visible.map((entry) => (
            <ClientPriorityRow key={entry.client.clientId} entry={entry} onSelectClient={onSelectClient} />
          ))
        )}
      </div>

      {isCappable && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-xs font-bold text-brand-soft hover:text-white"
        >
          {expanded ? 'Mostrar menos' : `Ver todos (${entries.length})`}
        </button>
      )}
    </div>
  );
}

/**
 * Bloco de prioridade operacional: agrupa os clientes do recorte em
 * Exige ação agora / Em atenção / Saudáveis, usando o mesmo diagnóstico
 * (clientPriorityGrouping) que os cards abaixo — o motivo exibido aqui nunca
 * diverge do motivo mostrado no card do cliente.
 */
export function ClientPriorityBoard({ entries, onSelectClient }: ClientPriorityBoardProps) {
  const groups = groupByPriorityTier(entries);

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <PriorityTierColumn tier="action_now" entries={groups.action_now} onSelectClient={onSelectClient} />
      <PriorityTierColumn tier="attention" entries={groups.attention} onSelectClient={onSelectClient} />
      <PriorityTierColumn tier="healthy" entries={groups.healthy} onSelectClient={onSelectClient} />
    </section>
  );
}
