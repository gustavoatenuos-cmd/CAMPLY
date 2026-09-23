import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react';
import type { CamplyData, Client } from '../../types';
import { clientDisplayName } from '../../data/clientDisplay';
import { isClientOperationallyActive } from '../../data/receivablesForecast';
import { clientColor } from '../../lib/clientColors';
import { dashboardPeriods, periodLabels, type DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { getCampaignMetricCellsByObjective } from '../../lib/performance/campaignMetricCells';
import { loadMetaCampaignBoard, type MetaBoardCampaign, type MetaBoardResult } from '../../lib/meta/metaCampaignBoard';
import { OBJECTIVE_GROUPS, objectiveDetailLabel, type ObjectiveGroupId } from '../../lib/meta/campaignObjectiveGroups';
import { compareCellWithBenchmark } from '../../lib/meta/campaignBenchmarks';
import { MetaCampaignDetailDrawer } from './MetaCampaignDetailDrawer';
import { StatusBadge } from './CampaignStatusBadge';

interface MetaCampaignsBoardProps {
  data: CamplyData;
  onOpenMetaIntegration?: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; result: MetaBoardResult };

export function MetaCampaignsBoard({ data, onOpenMetaIntegration }: MetaCampaignsBoardProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('last_7d');
  const [selectedClientId, setSelectedClientId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showIdle, setShowIdle] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selected, setSelected] = useState<MetaBoardCampaign | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const activeClients = useMemo(() => data.clients.filter((client) => {
    const project = data.projects.find((item) => item.id === client.projectId);
    return isClientOperationallyActive(client, project);
  }), [data.clients, data.projects]);

  const clientsKey = activeClients.map((client) => client.id).sort().join('|');

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    loadMetaCampaignBoard(activeClients, period)
      .then((result) => { if (active) setState({ kind: 'ready', result }); })
      .catch((error) => {
        console.error('[MetaCampaignsBoard] Falha ao carregar campanhas', error);
        if (active) setState({ kind: 'error', message: 'Não foi possível carregar as campanhas da Meta agora.' });
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsKey, period, reloadToken]);

  // Keep the client colour/name fresh if the client is edited while the board is open.
  const clientById = useMemo(() => new Map(data.clients.map((client) => [client.id, client])), [data.clients]);

  const campaigns = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const query = searchQuery.trim().toLowerCase();
    return state.result.campaigns
      .map((item) => ({ ...item, client: clientById.get(item.client.id) ?? item.client }))
      .filter((item) => selectedClientId === 'all' || item.client.id === selectedClientId)
      .filter((item) => showIdle || item.hasDelivery)
      .filter((item) => !query
        || item.campaign.name.toLowerCase().includes(query)
        || clientDisplayName(item.client).toLowerCase().includes(query));
  }, [state, searchQuery, selectedClientId, showIdle, clientById]);

  const idleCount = state.kind === 'ready'
    ? state.result.campaigns.filter((item) => !item.hasDelivery && (selectedClientId === 'all' || item.client.id === selectedClientId)).length
    : 0;

  const byGroup = useMemo(() => {
    const map = new Map<ObjectiveGroupId, MetaBoardCampaign[]>();
    for (const item of campaigns) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [campaigns]);

  const visibleGroups = OBJECTIVE_GROUPS.filter((group) => group.id !== 'other' || (byGroup.get('other')?.length ?? 0) > 0);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Período"
            value={period}
            onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
            className="rounded-lg border border-brand-line bg-brand-ink px-3 py-1.5 text-xs font-medium text-white focus:border-brand-green focus:outline-none"
          >
            {dashboardPeriods.map((item) => <option key={item} value={item}>{periodLabels[item]}</option>)}
          </select>
          <select
            aria-label="Cliente"
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className="rounded-lg border border-brand-line bg-brand-ink px-3 py-1.5 text-xs font-medium text-white focus:border-brand-green focus:outline-none"
          >
            <option value="all">Todos os clientes ativos ({activeClients.length})</option>
            {activeClients.map((client) => <option key={client.id} value={client.id}>{clientDisplayName(client)}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-brand-muted">
            <input type="checkbox" checked={showIdle} onChange={(event) => setShowIdle(event.target.checked)} className="accent-brand-green" />
            Mostrar ativas sem entrega{idleCount > 0 ? ` (${idleCount})` : ''}
          </label>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-2.5 text-brand-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar campanha ou cliente..."
              className="w-full rounded-lg border border-brand-line bg-brand-ink py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-brand-muted focus:border-brand-green focus:outline-none"
            />
          </div>
          <button type="button" onClick={reload} title="Recarregar" aria-label="Recarregar campanhas" className="rounded-lg border border-brand-line p-2 text-brand-muted transition hover:text-white">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {state.kind === 'ready' && <BoardNotices result={state.result} onOpenMetaIntegration={onOpenMetaIntegration} />}

      {state.kind === 'loading' && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-brand-line bg-brand-surface p-10 text-sm text-brand-muted">
          <Loader2 className="h-5 w-5 animate-spin text-brand-green" /> Carregando campanhas da Meta...
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">
          {state.message} <button type="button" onClick={reload} className="ml-2 underline">Tentar de novo</button>
        </div>
      )}

      {state.kind === 'ready' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {visibleGroups.map((group) => {
            const items = byGroup.get(group.id) ?? [];
            return (
              <section key={group.id} aria-label={group.label} className="flex min-h-[320px] w-[290px] shrink-0 flex-col rounded-xl border border-brand-line bg-brand-surface">
                <header className="border-b border-brand-line p-4" style={{ borderTopColor: group.accent, borderTopWidth: 3, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-widest" style={{ color: group.accent }}>{group.label}</h3>
                    <span className="rounded-full bg-brand-ink px-2 py-0.5 text-[10px] font-bold text-white">{items.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-brand-muted">{group.description}</p>
                </header>
                <div className="flex-1 space-y-3 p-3">
                  {items.length === 0 ? (
                    <div className="grid h-24 place-items-center rounded-lg border border-dashed border-brand-line text-xs text-brand-muted">Nenhuma campanha</div>
                  ) : items.map((item) => (
                    <CampaignCard key={item.key} item={item} onOpen={() => setSelected(item)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <MetaCampaignDetailDrawer
        item={selected ? { ...selected, client: clientById.get(selected.client.id) ?? selected.client } : null}
        period={period}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function CampaignCard({ item, onOpen }: { item: MetaBoardCampaign; onOpen: () => void }) {
  const color = clientColor(item.client);
  const cells = getCampaignMetricCellsByObjective(item.campaign.classifiedObjective, item.campaign.metrics ?? {}, item.account.currency);
  // Gasto + resultado principal + custo do resultado (ou a métrica seguinte).
  const summary = cells.slice(0, 3);
  const detail = objectiveDetailLabel(item.campaign.classifiedObjective, item.group);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-lg border border-brand-line bg-brand-ink text-left transition hover:border-brand-muted/60 hover:bg-brand-surface2"
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-black uppercase tracking-wide" style={{ color }}>{clientDisplayName(item.client)}</span>
          <StatusBadge active={item.isActive} />
        </div>
        <p className="line-clamp-2 text-sm font-bold leading-snug text-white" title={item.campaign.name}>{item.campaign.name}</p>
        {detail && <span className="inline-block rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-brand-soft">{detail}</span>}
        <div className="grid grid-cols-3 gap-2 border-t border-brand-line pt-2">
          {summary.map((cell) => {
            const comparison = compareCellWithBenchmark(cell, item.client.benchmarks);
            return (
              <div key={cell.key} className="min-w-0">
                <p className="truncate text-[10px] text-brand-muted">{cell.label}</p>
                <p className={`truncate text-xs font-bold ${comparison ? (comparison.status === 'good' ? 'text-emerald-400' : 'text-rose-400') : 'text-white'}`}>{cell.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    </button>
  );
}

function BoardNotices({ result, onOpenMetaIntegration }: { result: MetaBoardResult; onOpenMetaIntegration?: () => void }) {
  const notSynced = result.issues.filter((issue) => issue.kind === 'period_not_synced');
  const failed = result.issues.filter((issue) => issue.kind !== 'period_not_synced');
  if (notSynced.length === 0 && failed.length === 0 && result.clientsWithoutAccount.length === 0 && result.truncatedAccounts.length === 0) return null;
  const names = (clients: Client[]) => Array.from(new Set(clients.map(clientDisplayName))).join(', ');

  return (
    <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-xs text-amber-100">
      <div className="flex items-center gap-2 font-bold text-amber-300"><AlertTriangle size={14} /> Atenção</div>
      {notSynced.length > 0 && <p>Sem sincronização Meta: {names(notSynced.map((issue) => issue.client))}.</p>}
      {failed.length > 0 && <p>Não foi possível ler: {names(failed.map((issue) => issue.client))}.</p>}
      {result.clientsWithoutAccount.length > 0 && <p>Sem conta de anúncios vinculada: {names(result.clientsWithoutAccount)}.</p>}
      {result.truncatedAccounts.map(({ client, account, total }) => (
        <p key={account.clientMetaAssetId}>{clientDisplayName(client)} ({account.accountName}): {total} campanhas; exibindo as 100 com mais gasto.</p>
      ))}
      {onOpenMetaIntegration && (notSynced.length > 0 || result.clientsWithoutAccount.length > 0) && (
        <button type="button" onClick={onOpenMetaIntegration} className="font-bold text-amber-300 underline">Abrir Integração Meta</button>
      )}
    </div>
  );
}
