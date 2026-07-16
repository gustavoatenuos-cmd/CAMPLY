import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Facebook, Link as LinkIcon, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { invokeFunction } from '../lib/invokeFunction';
import {
  loadCachedClientMetaAssetCatalog,
  loadClientMetaAssetCatalog,
  type ClientMetaAccount,
  type ClientMetaAssetCatalog,
} from '../lib/meta/clientMetaAssetService';
import {
  applyAccountOutcome,
  buildBulkSyncSummaryMessage,
  classifySyncOutcome,
  initializeBulkSyncProgress,
  isBulkSyncAllFailed,
  outcomeFromThrownError,
  type BulkSyncAccountResult,
  type BulkSyncProgress,
} from '../lib/meta/bulkSyncDiagnostics';
import { syncMetaAsset } from '../lib/meta/metaSyncService';
import type { DashboardPeriod } from '../lib/performance/analyticsCapabilities';
import type { CamplyData } from '../types';
import { evaluateClientOperationalReadiness, summarizeMetaReadinessAcrossClients } from '../lib/operational/clientOperationalReadiness';
import { BulkSyncResultsPanel } from './meta/BulkSyncResultsPanel';
import { SyncStatusBadge } from './meta/SyncStatusBadge';
import { MetaReadinessBadge } from './operational/MetaReadinessBadge';
import { MetaOperationalWorkspace } from './meta/MetaOperationalWorkspace';
import { ConfirmDialog } from './ui/ConfirmDialog';

const bulkPeriodLabels: Record<DashboardPeriod, string> = {
  this_month: 'Mês atual',
  this_week: 'Semana atual',
  today: 'Hoje',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  last_90d: 'Últimos 90 dias',
};

interface MetaIntegrationViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

type MetaAsset = {
  id?: string;
  asset_id?: string;
  asset_name?: string;
  asset_type?: string;
};

type IntegrationStatus = {
  status?: string;
  integration?: {
    meta_user_name?: string;
    last_validated_at?: string | null;
    last_sync_at?: string | null;
  };
  assets?: MetaAsset[];
  source?: 'database' | 'remote';
  remoteValidated?: boolean;
};

type ConnectionStatus = 'unknown' | 'loading' | 'active' | 'none' | 'expired' | 'unavailable';

function metaActionError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/meta-validate-token/i.test(message)) {
    const detail = message ? ` Detalhe técnico: ${message}` : '';
    return `Não foi possível verificar a conexão salva agora. A leitura operacional permanece preservada.${detail}`;
  }
  if (/meta-oauth-start/i.test(message)) {
    const detail = message ? ` Detalhe técnico: ${message}` : '';
    return `Não foi possível iniciar a autorização com o Facebook agora. A conexão salva não foi alterada; tente novamente em alguns segundos.${detail}`;
  }
  return message || fallback;
}

export function MetaIntegrationView({ data }: MetaIntegrationViewProps) {
  const [integration, setIntegration] = useState<IntegrationStatus['integration'] | null>(null);
  const [assets, setAssets] = useState<MetaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [catalog, setCatalog] = useState<ClientMetaAssetCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showAvailableAssets, setShowAvailableAssets] = useState(false);
  const [bulkPeriod, setBulkPeriod] = useState<DashboardPeriod>('this_month');
  const [bulkSync, setBulkSync] = useState<BulkSyncProgress | null>(null);
  const [retryingAccountId, setRetryingAccountId] = useState<string | null>(null);
  // Uma sincronização em massa e um "tentar novamente" individual não podem
  // rodar ao mesmo tempo - as duas mexem nos mesmos contadores agregados de
  // bulkSync, e uma corrida entre elas corromperia o resultado por conta.
  const bulkSyncBusy = Boolean(bulkSync?.running) || retryingAccountId !== null;

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const next = await loadClientMetaAssetCatalog();
      setCatalog(next);
    } catch (catalogLoadError) {
      setCatalogError(catalogLoadError instanceof Error
        ? catalogLoadError.message
        : 'Não foi possível carregar as contas vinculadas a clientes.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const linkedAccounts = useMemo(() => (catalog?.clients || []).flatMap((client) => (
    client.accounts.map((account) => ({ clientId: client.clientId, clientName: client.clientName, account }))
  )), [catalog]);

  // Prontidão Meta de cada conta já vinculada, a partir do último sync conhecido
  // (independente de um bulk sync ter acabado de rodar) - camada central usada em
  // todas as telas operacionais, ver src/lib/operational/clientOperationalReadiness.ts.
  const linkedAccountsReadiness = useMemo(() => linkedAccounts.map((entry) => ({
    ...entry,
    readiness: evaluateClientOperationalReadiness({
      clientId: entry.clientId,
      client: null,
      analysisProfile: null,
      metaAccounts: [entry.account],
      period: bulkPeriod,
    }),
  })), [linkedAccounts, bulkPeriod]);

  const metaReadinessSummary = useMemo(() => summarizeMetaReadinessAcrossClients(
    linkedAccountsReadiness.map(({ readiness }) => readiness.meta)
  ), [linkedAccountsReadiness]);

  const availableUnlinkedAssets = useMemo(() => (
    (catalog?.availableAssets || []).filter((asset) => !asset.linkedClientId)
  ), [catalog]);

  const runAccountSync = async (account: ClientMetaAccount): Promise<Pick<BulkSyncAccountResult, 'status' | 'runId' | 'message' | 'error'>> => {
    try {
      const result = await syncMetaAsset({
        clientMetaAssetId: account.clientMetaAssetId,
        period: bulkPeriod,
        requestedLevel: 'campaign',
      });
      return classifySyncOutcome(result);
    } catch (syncError) {
      return outcomeFromThrownError(syncError);
    }
  };

  const syncLinkedClients = async () => {
    if (linkedAccounts.length === 0 || bulkSyncBusy) return;
    setError(null);
    setNotice(null);

    setBulkSync(initializeBulkSyncProgress(linkedAccounts.map(({ clientId, clientName, account }) => ({
      clientId,
      clientName,
      clientMetaAssetId: account.clientMetaAssetId,
      accountName: account.accountName,
      adAccountId: account.adAccountId,
    }))));

    for (const { account } of linkedAccounts) {
      setBulkSync((current) => current && applyAccountOutcome(current, account.clientMetaAssetId, { status: 'running' }));

      const outcome = await runAccountSync(account);
      setBulkSync((current) => current && applyAccountOutcome(current, account.clientMetaAssetId, outcome, 'running'));
    }

    setBulkSync((current) => {
      if (!current) return current;
      const finished = { ...current, running: false };
      const summary = buildBulkSyncSummaryMessage(finished);
      if (isBulkSyncAllFailed(finished)) {
        setError(summary);
      } else {
        setNotice(summary);
      }
      return finished;
    });
    await loadCatalog();
  };

  const retryAccountSync = async (target: BulkSyncAccountResult) => {
    if (!bulkSync || bulkSyncBusy) return;
    const linked = linkedAccounts.find((entry) => entry.account.clientMetaAssetId === target.clientMetaAssetId);
    if (!linked) return;

    setRetryingAccountId(target.clientMetaAssetId);
    setBulkSync((current) => current && applyAccountOutcome(
      current,
      target.clientMetaAssetId,
      { status: 'running', message: undefined, error: undefined },
      target.status
    ));
    try {
      const outcome = await runAccountSync(linked.account);
      setBulkSync((current) => {
        if (!current) return current;
        const next = applyAccountOutcome(current, target.clientMetaAssetId, outcome, 'running');
        setNotice(buildBulkSyncSummaryMessage(next));
        return next;
      });
      await loadCatalog();
    } finally {
      setRetryingAccountId(null);
    }
  };

  const checkStatus = useCallback(async (verifyRemote = false) => {
    setStatusLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await invokeFunction<IntegrationStatus>('meta-validate-token', { verifyRemote }, verifyRemote ? 30_000 : 20_000);
      if (response.status === 'active') {
        setIntegration(response.integration);
        setAssets(response.assets || []);
        setConnectionStatus('active');
        if (verifyRemote) setNotice('Acesso ao Facebook validado. O vínculo e os snapshots salvos foram preservados.');
      } else {
        setIntegration(null);
        setAssets([]);
        setConnectionStatus(response.status === 'expired' ? 'expired' : 'none');
      }
    } catch (statusError) {
      setConnectionStatus((current) => current === 'active' ? current : 'unavailable');
      setError(metaActionError(statusError, 'Não foi possível carregar a conexão salva. Tente novamente.'));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const cachedCatalog = loadCachedClientMetaAssetCatalog();
    if (!cachedCatalog) return;
    const cachedAssets = cachedCatalog.availableAssets.map((asset) => ({
      id: asset.metaAssetId,
      asset_id: asset.adAccountId,
      asset_name: asset.accountName,
      asset_type: 'adaccount',
    }));
    setAssets(cachedAssets);
    if (cachedAssets.length > 0) setConnectionStatus('active');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const metaSync = params.get('meta_sync');
    if (metaSync === 'success') {
      setNotice('Integração Meta autorizada. Clique em verificar conexão ou descobrir ativos para carregar as contas.');
      setConnectionStatus('unknown');
    }
    if (metaSync === 'error') {
      setError(params.get('meta_error') || 'Não foi possível concluir a autorização Meta.');
      setConnectionStatus('unknown');
    }
    if (metaSync) {
      params.delete('meta_sync');
      params.delete('meta_error');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }, []);

  const connect = async () => {
    setConnectLoading(true);
    setError(null);
    try {
      const response = await invokeFunction<{ url: string }>('meta-oauth-start');
      if (!response.url) throw new Error('URL de autorização indisponível.');
      window.location.assign(response.url);
    } catch (connectError) {
      setError(metaActionError(connectError, 'Não foi possível iniciar a conexão.'));
      setConnectLoading(false);
    }
  };

  const disconnect = async () => {
    setConfirmDisconnectOpen(false);
    setLoading(true);
    setError(null);
    try {
      await invokeFunction<{ success: boolean }>('meta-disconnect');
      setIntegration(null);
      setAssets([]);
      setConnectionStatus('none');
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Não foi possível desconectar.');
    } finally {
      setLoading(false);
    }
  };

  const discoverAssets = async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await invokeFunction<{ assets?: MetaAsset[] }>('meta-list-assets');
      setAssets(response.assets || []);
      setNotice('Ativos atualizados e salvos. As métricas das campanhas só mudam quando você sincronizar a conta ou o período.');
      await loadCatalog();
    } catch (discoverError) {
      setError(metaActionError(discoverError, 'Não foi possível atualizar os ativos.'));
    } finally {
      setSyncing(false);
    }
  };

  const connectionTitle = connectionStatus === 'loading'
    ? 'Carregando conexão salva...'
    : connectionStatus === 'active'
      ? `Conexão Meta salva${integration?.meta_user_name ? ` · ${integration.meta_user_name}` : ''}`
      : connectionStatus === 'expired'
        ? 'Autorização expirada'
        : connectionStatus === 'unavailable'
          ? 'Conexão salva temporariamente indisponível'
          : connectionStatus === 'unknown'
            ? 'Conexão salva será verificada sob demanda'
          : 'Conta não conectada';
  const connected = connectionStatus === 'active';

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex items-center gap-3 rounded-2xl border border-brand-line bg-brand-surface p-5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600/20 text-blue-400"><Facebook size={24} /></div>
          <div><h1 className="text-xl font-black text-white">Integração Meta Ads</h1><p className="text-sm text-brand-muted">Autorização, descoberta de contas e vínculo analítico seguro.</p></div>
        </header>

        {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"><AlertTriangle size={18} /> {error}</div>}
        {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200"><CheckCircle2 size={18} /> {notice}</div>}

        <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
          <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-wider text-brand-green">Conexão salva</p><h2 className="mt-1 text-lg font-black text-white">{connectionTitle}</h2></div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${connected ? 'bg-emerald-400/10 text-emerald-200' : connectionStatus === 'expired' ? 'bg-amber-400/10 text-amber-200' : 'bg-white/5 text-brand-muted'}`}>{connected ? 'SALVA' : connectionStatus === 'loading' ? 'CARREGANDO' : connectionStatus === 'expired' ? 'REAUTORIZAR' : connectionStatus === 'unavailable' ? 'INDISPONÍVEL' : connectionStatus === 'unknown' ? 'SOB DEMANDA' : 'DESCONECTADA'}</span>
            </div>
            <p className="mt-3 text-sm text-brand-muted">Ao abrir a página, o CAMPLY usa o último estado operacional salvo. O Facebook e a validação remota só são consultados quando você solicitar.</p>
            {integration?.last_validated_at && <p className="mt-2 text-xs text-brand-soft">Última validação solicitada: {new Date(integration.last_validated_at).toLocaleString('pt-BR')}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {connectionStatus === 'unknown' ? (
                <>
                  <button type="button" onClick={() => void checkStatus(false)} disabled={statusLoading} className="inline-flex items-center gap-2 rounded-lg border border-brand-line px-4 py-2 font-bold text-brand-soft disabled:opacity-60"><RefreshCw size={16} className={statusLoading ? 'animate-spin' : ''} /> Verificar conexão salva</button>
                  <button type="button" onClick={() => void connect()} disabled={connectLoading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-black text-white disabled:opacity-60"><Facebook size={16} /> {connectLoading ? 'Abrindo Facebook...' : 'Conectar com Facebook'}</button>
                </>
              ) : connectionStatus === 'unavailable' ? (
                <>
                  <button type="button" onClick={() => void checkStatus(false)} disabled={statusLoading} className="inline-flex items-center gap-2 rounded-lg border border-brand-line px-4 py-2 font-bold text-brand-soft disabled:opacity-60"><RefreshCw size={16} className={statusLoading ? 'animate-spin' : ''} /> Tentar leitura novamente</button>
                  <button type="button" onClick={() => void connect()} disabled={connectLoading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-black text-white disabled:opacity-60"><Facebook size={16} /> {connectLoading ? 'Abrindo Facebook...' : 'Conectar com Facebook'}</button>
                </>
              ) : !connected ? <>
                <button type="button" onClick={() => void connect()} disabled={connectLoading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-black text-white disabled:opacity-60"><Facebook size={16} /> {connectLoading ? 'Abrindo Facebook...' : connectionStatus === 'expired' ? 'Reautorizar Facebook' : 'Conectar com Facebook'}</button>
              </> : <>
                <button type="button" onClick={() => void checkStatus(true)} disabled={statusLoading} className="inline-flex items-center gap-2 rounded-lg border border-brand-line px-4 py-2 font-bold text-brand-soft disabled:opacity-60"><ShieldCheck size={16} className={statusLoading ? 'animate-pulse' : ''} /> Validar acesso</button>
                <button type="button" onClick={() => void discoverAssets()} disabled={syncing} className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 font-black text-brand-ink disabled:opacity-60"><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> Descobrir ativos</button>
                <button type="button" onClick={() => setConfirmDisconnectOpen(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-4 py-2 font-bold text-rose-200 disabled:opacity-60"><Unlink size={16} /> Desconectar</button>
              </>}
            </div>
          </article>

          <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-brand-green">Contas operacionais</p>
                <h2 className="mt-1 text-lg font-black text-white">Contas vinculadas a clientes</h2>
                <p className="mt-1 max-w-xl text-sm text-brand-muted">Conta autorizada no Facebook não é conta operacional do CAMPLY. Só contas vinculadas a um cliente ativo entram em sincronização e análise.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  data-testid="meta-bulk-period-select"
                  value={bulkPeriod}
                  onChange={(event) => setBulkPeriod(event.target.value as DashboardPeriod)}
                  className="rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm text-white"
                >
                  {Object.entries(bulkPeriodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button
                  data-testid="meta-sync-linked-clients"
                  type="button"
                  onClick={() => void syncLinkedClients()}
                  disabled={linkedAccounts.length === 0 || bulkSyncBusy}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-sm font-black text-brand-ink disabled:opacity-60"
                >
                  <RefreshCw size={16} className={bulkSync?.running ? 'animate-spin' : ''} /> Sincronizar clientes vinculados
                </button>
              </div>
            </div>

            {bulkSync && (
              <p data-testid="meta-bulk-sync-progress" className="mt-3 text-xs font-bold text-brand-soft">
                {bulkSync.running ? 'Sincronizando' : 'Concluído'}: {bulkSync.completed}/{bulkSync.total} conta(s) vinculada(s)
                {' · '}{bulkSync.success} sucesso
                {bulkSync.partial > 0 ? `, ${bulkSync.partial} parcial` : ''}
                {bulkSync.failed > 0 ? `, ${bulkSync.failed} falha` : ''}
              </p>
            )}

            {bulkSync && <BulkSyncResultsPanel results={bulkSync.results} onRetry={(target) => void retryAccountSync(target)} retryDisabled={bulkSyncBusy} />}

            {catalogError && <div role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{catalogError}</div>}

            {!bulkSync && metaReadinessSummary.allDegraded && (
              <p data-testid="meta-readiness-aggregate-warning" className="mt-3 text-xs font-bold text-amber-200">
                Nenhuma conta vinculada está com leitura completa
                {metaReadinessSummary.dominantCause ? `: ${metaReadinessSummary.dominantCause}` : '.'}
              </p>
            )}

            <div className="mt-4 space-y-2">
              {linkedAccountsReadiness.map(({ clientName, account, readiness }) => {
                const syncResult = bulkSync?.results.find((result) => result.clientMetaAssetId === account.clientMetaAssetId);
                return (
                  <div key={account.clientMetaAssetId} data-testid="meta-linked-account-row" className="flex items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-ink/50 p-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-400/10" title="Conta vinculada ao cliente">
                        <LinkIcon className="text-blue-300" size={15} />
                      </div>
                      <div>
                        <p className="font-bold text-white">{clientName}</p>
                        <p className="text-xs text-brand-muted">{account.accountName} · {account.adAccountId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {syncResult ? <SyncStatusBadge status={syncResult.status} /> : <MetaReadinessBadge status={readiness.meta.status} />}
                      <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold text-brand-soft">{account.assetStatus || 'STATUS N/D'}</span>
                    </div>
                  </div>
                );
              })}
              {catalogLoading && linkedAccounts.length === 0 && (
                <div className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-muted">Carregando contas vinculadas...</div>
              )}
              {!catalogLoading && linkedAccounts.length === 0 && (
                <div className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-muted">Nenhuma conta vinculada a um cliente ainda. Vincule uma conta abaixo, em "contas disponíveis para vínculo".</div>
              )}
            </div>

            <div className="mt-5 border-t border-brand-line pt-4">
              <button
                type="button"
                onClick={() => setShowAvailableAssets((current) => !current)}
                className="inline-flex items-center gap-2 text-xs font-bold text-brand-soft"
              >
                {showAvailableAssets ? 'Ocultar' : 'Ver'} contas disponíveis para vínculo ({availableUnlinkedAssets.length})
              </button>
              {showAvailableAssets && (
                <div className="mt-3 space-y-2">
                  {availableUnlinkedAssets.map((asset) => (
                    <div key={asset.metaAssetId} className="flex items-center gap-3 rounded-xl border border-dashed border-brand-line bg-brand-ink/30 p-3">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/5"><LinkIcon className="text-blue-300" size={15} /></div>
                      <div>
                        <p className="font-bold text-white">{asset.accountName}</p>
                        <p className="text-xs text-brand-muted">{asset.adAccountId} · autorizada no Facebook, ainda não vinculada a um cliente</p>
                      </div>
                    </div>
                  ))}
                  {availableUnlinkedAssets.length === 0 && <p className="text-sm text-brand-muted">Nenhuma conta disponível para vínculo.</p>}
                </div>
              )}
            </div>
          </article>
        </div>

        <MetaOperationalWorkspace data={data} />

        <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
          <h2 className="flex items-center gap-2 font-black text-white"><ShieldCheck className="text-brand-green" size={18} /> Limites de segurança</h2>
          <p className="mt-2 text-sm leading-6 text-brand-muted">Segredos não são enviados ao frontend; chamadas à Graph API ocorrem nas Edge Functions; vínculos são autorizados por usuário; coletas idênticas concorrentes e rajadas excessivas são bloqueadas.</p>
        </article>

        <ConfirmDialog
          open={confirmDisconnectOpen}
          title="Desconectar integração Meta?"
          description="A autorização será revogada no CAMPLY. Os dados analíticos já coletados permanecem preservados para auditoria."
          confirmLabel="Desconectar"
          tone="danger"
          loading={loading}
          onCancel={() => setConfirmDisconnectOpen(false)}
          onConfirm={() => void disconnect()}
        />
      </div>
    </section>
  );
}
