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
  action_now: 'text-rose-300',
  attention: 'text-amber-300',
  healthy: 'text-emerald-300',
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
      className="flex w-full items-start justify-between gap-3 border-b border-brand-line px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-white/[0.025]"
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
    <div data-testid={`priority-column-${tier}`} className="min-w-0 bg-brand-surface">
      <div className="flex h-10 items-center gap-2 border-b border-brand-line px-3">
        <Icon size={14} className={`shrink-0 ${TIER_TONE[tier]}`} />
        <h3 className="text-xs font-semibold text-white">{PRIORITY_TIER_LABELS[tier]}</h3>
        <span className="ml-auto text-[11px] font-medium text-brand-muted">{entries.length}</span>
      </div>

      <div>
        {visible.length === 0 ? (
          <p className="p-5 text-center text-xs text-brand-muted">
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
          className="mx-3 my-2 text-xs font-medium text-brand-soft hover:text-white"
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
    <section className="grid overflow-hidden rounded-xl border border-brand-line bg-brand-surface lg:grid-cols-3 lg:divide-x lg:divide-brand-line">
      <PriorityTierColumn tier="action_now" entries={groups.action_now} onSelectClient={onSelectClient} />
      <PriorityTierColumn tier="attention" entries={groups.attention} onSelectClient={onSelectClient} />
      <PriorityTierColumn tier="healthy" entries={groups.healthy} onSelectClient={onSelectClient} />
    </section>
  );
}
