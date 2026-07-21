import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Link2, LoaderCircle, RefreshCw, Target, Unlink } from 'lucide-react';
import type { CamplyData } from '../../types';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import {
  linkClientMetaAsset,
  loadClientMetaAssetCatalog,
  unlinkClientMetaAsset,
  type ClientMetaAccount,
  type ClientMetaAssetCatalog,
} from '../../lib/meta/clientMetaAssetService';
import { syncMetaAsset } from '../../lib/meta/metaSyncService';
import { OperationTimedOutError } from '../../lib/withTimeout';
import { MetaHierarchyExplorer } from './MetaHierarchyExplorer';
import { TargetSettingsDrawer } from './TargetSettingsDrawer';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const periodLabels: Record<DashboardPeriod, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  today_and_yesterday: 'Hoje e ontem',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_90d: 'Últimos 90 dias',
};

function savedSnapshotLabel(account: ClientMetaAccount): string {
  const run = account.lastSuccess;
  if (!run) return 'Nenhum snapshot confiável salvo';
  return `Snapshot salvo em ${new Date(run.finishedAt || run.startedAt).toLocaleString('pt-BR')} · ${periodLabels[run.period as DashboardPeriod] || run.period}`;
}

function newerAttemptLabel(account: ClientMetaAccount): string | null {
  const attempt = account.lastAttempt;
  const success = account.lastSuccess;
  if (!attempt || attempt.status === 'success') return null;
  const attemptTime = new Date(attempt.finishedAt || attempt.startedAt).getTime();
  const successTime = success ? new Date(success.finishedAt || success.startedAt).getTime() : 0;
  if (attemptTime <= successTime) return null;
  const state = attempt.status === 'partial' ? 'parcial' : attempt.status === 'running' ? 'em andamento' : 'falhou';
  return `A tentativa mais recente está ${state}; o último snapshot confiável continua em uso.`;
}

function catalogErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/vínculos salvos|leitura direta|meta-client-catalog|demorou mais que o esperado/i.test(message)) {
    return 'Não foi possível ler os vínculos salvos agora. Nenhuma sincronização nova foi iniciada e nenhum dado foi removido.';
  }
  return message || 'Não foi possível carregar as contas Meta.';
}

export function MetaOperationalWorkspace({
  data,
  initialClientId,
  compact = false,
  period: controlledPeriod,
  onPeriodChange,
  onDataChanged,
}: {
  data: CamplyData;
  initialClientId?: string;
  compact?: boolean;
  period?: DashboardPeriod;
  onPeriodChange?: (period: DashboardPeriod) => void;
  onDataChanged?: () => void;
}) {
  const [clientId, setClientId] = useState(initialClientId || data.clients[0]?.id || '');
  const [catalog, setCatalog] = useState<ClientMetaAssetCatalog | null>(null);
  const [accountId, setAccountId] = useState('');
  const [linkAssetId, setLinkAssetId] = useState('');
  const [internalPeriod, setInternalPeriod] = useState<DashboardPeriod>('last_90d');
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false);
  const period = controlledPeriod || internalPeriod;
  const setPeriod = (nextPeriod: DashboardPeriod) => {
    if (!controlledPeriod) setInternalPeriod(nextPeriod);
    onPeriodChange?.(nextPeriod);
  };

  useEffect(() => {
    setClientId((current) => {
      if (initialClientId && data.clients.some((client) => client.id === initialClientId)) return initialClientId;
      if (data.clients.some((client) => client.id === current)) return current;
      return data.clients[0]?.id || '';
    });
  }, [data.clients, initialClientId]);

  const refresh = useCallback(async () => {
    if (!clientId) {
      setCatalog({ clients: [], availableAssets: [] });
      return;
    }
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const next = await loadClientMetaAssetCatalog(clientId);
      setCatalog(next);
      if (next.source === 'cache') {
        setWarning(`A conexão com o banco demorou; exibindo o último estado salvo neste navegador${next.cachedAt ? ` em ${new Date(next.cachedAt).toLocaleString('pt-BR')}` : ''}. Nenhuma sincronização nova foi iniciada.`);
      }
      const accounts = next.clients.find((client) => client.clientId === clientId)?.accounts || [];
      setAccountId((current) => accounts.some((account) => account.clientMetaAssetId === current)
        ? current
        : accounts[0]?.clientMetaAssetId || '');
      const linkable = next.availableAssets.find((asset) => !asset.linkedClientId || asset.linkedClientId === clientId);
      setLinkAssetId((current) => next.availableAssets.some((asset) => asset.metaAssetId === current)
        ? current
        : linkable?.metaAssetId || '');
    } catch (loadError) {
      setError(catalogErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshReading = async () => {
    await refresh();
    onDataChanged?.();
  };

  const clientCatalog = catalog?.clients.find((client) => client.clientId === clientId);
  const account = clientCatalog?.accounts.find((item) => item.clientMetaAssetId === accountId) || clientCatalog?.accounts[0];
  const linkableAssets = useMemo(() => (catalog?.availableAssets || []).filter((asset) => (
    !asset.linkedClientId || asset.linkedClientId === clientId
  )), [catalog, clientId]);

  const linkAccount = async () => {
    if (!clientId || !linkAssetId) return;
    setLoading(true);
    setError(null);
    setAction(null);
    try {
      await linkClientMetaAsset(clientId, linkAssetId);
      setAction('Conta vinculada ao cliente com sucesso.');
      await refresh();
      onDataChanged?.();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Não foi possível vincular a conta.');
    } finally {
      setLoading(false);
    }
  };

  const unlinkAccount = async () => {
    if (!account) return;
    setConfirmUnlinkOpen(false);
    setLoading(true);
    setError(null);
    setAction(null);
    try {
      await unlinkClientMetaAsset(account.clientMetaAssetId);
      setAction('Conta desvinculada. O histórico coletado foi preservado.');
      await refresh();
      onDataChanged?.();
    } catch (unlinkError) {
      setError(unlinkError instanceof Error ? unlinkError.message : 'Não foi possível desvincular a conta.');
    } finally {
      setLoading(false);
    }
  };

  const synchronize = async (requestedLevel: 'campaign' | 'creative') => {
    if (!account) return;
    setLoading(true);
    setError(null);
    setAction(null);
    try {
      const result = await syncMetaAsset({ clientMetaAssetId: account.clientMetaAssetId, period, requestedLevel });
      if (!result.success || result.status === 'failed') throw new Error(result.message || 'A coleta Meta falhou.');
      setAction(result.status === 'partial'
        ? 'Sincronização parcial registrada. O snapshot confiável anterior permanece disponível.'
        : `Sincronização ${requestedLevel === 'creative' ? 'completa' : 'de campanhas'} concluída e salva no banco.`);
      await refresh();
      setRefreshToken((current) => current + 1);
      onDataChanged?.();
    } catch (syncError) {
      if (syncError instanceof OperationTimedOutError) {
        setWarning('A sincronização demorou mais que o esperado. O último snapshot confiável continua em uso; recarreguei os dados salvos para manter a tela operacional.');
        await refresh();
        setRefreshToken((current) => current + 1);
        onDataChanged?.();
        return;
      }
      setError(syncError instanceof Error ? syncError.message : 'Não foi possível sincronizar esta conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section data-testid="meta-operational-workspace" className={`rounded-2xl border border-brand-line bg-brand-surface ${compact ? 'p-4' : 'p-5 lg:p-6'}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">Central Meta Ads</p>
          <h2 className="mt-1 text-xl font-black text-white">Performance oficial por cliente</h2>
          <p className="mt-1 max-w-3xl text-sm text-brand-muted">A tela sempre lê o último snapshot salvo no banco. O Facebook só é consultado quando você clica em sincronizar; recarregar a página não inicia uma nova coleta.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-bold text-brand-soft">
            Cliente
            <select data-testid="meta-client-select" value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm text-white">
              {data.clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-brand-soft">
            Período exato
            <select data-testid="meta-period-select" value={period} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm text-white">
              {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void refreshReading()} disabled={loading} title="Relê o snapshot salvo sem consultar o Facebook" className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-sm font-bold text-brand-soft disabled:opacity-60">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Recarregar dados salvos
          </button>
        </div>
      </div>

      {error && <div role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
      {warning && <div role="status" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">{warning}</div>}
      {action && <div role="status" className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">{action}</div>}

      {!clientId ? (
        <EmptyState title="Nenhum cliente cadastrado" description="Cadastre um cliente operacional antes de vincular uma conta Meta." />
      ) : loading && !catalog ? (
        <div className="mt-5 flex min-h-40 items-center justify-center gap-2 text-brand-muted"><LoaderCircle className="animate-spin" size={18} /> Carregando vínculos oficiais...</div>
      ) : error && !catalog ? (
        <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100">
          <h3 className="font-black text-white">Não foi possível ler o estado salvo</h3>
          <p className="mt-1 text-sm">Nenhuma sincronização nova foi iniciada e nenhum vínculo foi removido.</p>
          <button type="button" onClick={() => void refresh()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-300/30 px-3 py-2 text-sm font-bold"><RefreshCw size={14} /> Tentar novamente</button>
        </div>
      ) : !account ? (
        <div className="mt-5 rounded-xl border border-dashed border-brand-line bg-brand-ink/40 p-5">
          <h3 className="font-black text-white">Conta Meta ainda não vinculada</h3>
          <p className="mt-1 text-sm text-brand-muted">Escolha uma conta descoberta pela integração. O vínculo fica separado dos dados operacionais do cliente.</p>
          {linkableAssets.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <select data-testid="meta-link-select" value={linkAssetId} onChange={(event) => setLinkAssetId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">
                {linkableAssets.map((asset) => <option key={asset.metaAssetId} value={asset.metaAssetId}>{asset.accountName} · {asset.adAccountId}</option>)}
              </select>
              <button data-testid="meta-link-button" type="button" onClick={() => void linkAccount()} disabled={loading || !linkAssetId} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-2 font-black text-brand-ink disabled:opacity-60"><Link2 size={16} /> Vincular conta</button>
            </div>
          ) : <p className="mt-4 text-sm text-amber-200">Nenhuma conta livre foi encontrada. Conecte ou reautorize a integração Meta.</p>}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="rounded-xl border border-brand-line bg-brand-ink/45 p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 data-testid="meta-account-name" className="font-black text-white">{account.accountName}</h3>
                  <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-200">{account.assetStatus || 'STATUS N/D'}</span>
                </div>
                <p className="mt-1 text-xs text-brand-muted">{account.adAccountId} · {account.currency || 'Moeda N/D'} · {account.timezone || 'Fuso N/D'}</p>
                <p data-testid="meta-last-snapshot" className="mt-2 inline-flex items-center gap-1 text-xs text-brand-soft"><Clock3 size={13} /> {savedSnapshotLabel(account)}</p>
                {newerAttemptLabel(account) && <p className="mt-1 text-xs text-amber-200">{newerAttemptLabel(account)}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!compact && (
                  <>
                    <button data-testid="meta-sync-period" type="button" onClick={() => void synchronize('campaign')} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-brand-green/40 px-3 py-2 text-xs font-black text-brand-green disabled:opacity-60"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Sincronizar últimos 90 dias</button>
                    <button data-testid="meta-sync-account" type="button" onClick={() => void synchronize('creative')} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-3 py-2 text-xs font-black text-brand-ink disabled:opacity-60">Sincronizar conta completa (90 dias)</button>
                  </>
                )}
                <button type="button" onClick={() => setTargetsOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-xs font-black text-brand-soft"><Target size={14} /> Metas da conta</button>
                {!compact && (
                  <button type="button" onClick={() => setConfirmUnlinkOpen(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-black text-rose-200 disabled:opacity-60"><Unlink size={14} /> Desvincular</button>
                )}
              </div>
            </div>
            {clientCatalog && clientCatalog.accounts.length > 1 && (
              <label className="mt-4 block max-w-xl text-xs font-bold text-brand-soft">
                Conta vinculada em análise
                <select value={account.clientMetaAssetId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm text-white">
                  {clientCatalog.accounts.map((item) => <option key={item.clientMetaAssetId} value={item.clientMetaAssetId}>{item.accountName} · {item.adAccountId}</option>)}
                </select>
              </label>
            )}
          </div>

          <MetaHierarchyExplorer account={account} period={period} refreshToken={refreshToken} onChanged={() => { void refresh(); onDataChanged?.(); }} />
          <TargetSettingsDrawer open={targetsOpen} onClose={() => setTargetsOpen(false)} clientMetaAssetId={account.clientMetaAssetId} campaignName={`Conta · ${account.accountName}`} onSaved={() => { void refresh(); onDataChanged?.(); }} />
          <ConfirmDialog
            open={confirmUnlinkOpen}
            title="Desvincular conta Meta?"
            description={`A conta ${account.accountName} será removida deste cliente. O histórico analítico já coletado será preservado.`}
            confirmLabel="Desvincular"
            tone="danger"
            loading={loading}
            onCancel={() => setConfirmUnlinkOpen(false)}
            onConfirm={() => void unlinkAccount()}
          />
        </div>
      )}
    </section>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="mt-5 rounded-xl border border-dashed border-brand-line p-6 text-center"><p className="font-bold text-white">{title}</p><p className="mt-1 text-sm text-brand-muted">{description}</p></div>;
}
