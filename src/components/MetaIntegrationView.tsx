import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Facebook, Link as LinkIcon, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { invokeFunction } from '../lib/invokeFunction';
import type { CamplyData } from '../types';
import { MetaOperationalWorkspace } from './meta/MetaOperationalWorkspace';
import { ConfirmDialog } from './ui/ConfirmDialog';

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
  integration?: { meta_user_name?: string };
  assets?: MetaAsset[];
};

export function MetaIntegrationView({ data }: MetaIntegrationViewProps) {
  const [integration, setIntegration] = useState<IntegrationStatus['integration'] | null>(null);
  const [assets, setAssets] = useState<MetaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invokeFunction<IntegrationStatus>('meta-validate-token');
      if (response.status === 'active') {
        setIntegration(response.integration);
        setAssets(response.assets || []);
      } else {
        setIntegration(null);
        setAssets([]);
      }
    } catch {
      setIntegration(null);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  const connect = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await invokeFunction<{ url: string }>('meta-oauth-start');
      if (!response.url) throw new Error('URL de autorização indisponível.');
      window.location.assign(response.url);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Não foi possível iniciar a conexão.');
      setLoading(false);
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
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : 'Não foi possível atualizar os ativos.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex items-center gap-3 rounded-2xl border border-brand-line bg-brand-surface p-5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600/20 text-blue-400"><Facebook size={24} /></div>
          <div><h1 className="text-xl font-black text-white">Integração Meta Ads</h1><p className="text-sm text-brand-muted">Autorização, descoberta de contas e vínculo analítico seguro.</p></div>
        </header>

        {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"><AlertTriangle size={18} /> {error}</div>}

        <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
          <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-wider text-brand-green">Conexão</p><h2 className="mt-1 text-lg font-black text-white">{integration ? `Conectado como ${integration.meta_user_name || 'usuário Meta'}` : 'Conta não conectada'}</h2></div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${integration ? 'bg-emerald-400/10 text-emerald-200' : 'bg-white/5 text-brand-muted'}`}>{integration ? 'ATIVA' : 'DESCONECTADA'}</span>
            </div>
            <p className="mt-3 text-sm text-brand-muted">Tokens permanecem no backend. O navegador recebe somente o estado e os ativos autorizados.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {!integration ? <button type="button" onClick={() => void connect()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-black text-white disabled:opacity-60"><Facebook size={16} /> {loading ? 'Conectando...' : 'Conectar com Facebook'}</button> : <>
                <button type="button" onClick={() => void discoverAssets()} disabled={syncing} className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 font-black text-brand-ink disabled:opacity-60"><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> Descobrir ativos</button>
                <button type="button" onClick={() => setConfirmDisconnectOpen(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-4 py-2 font-bold text-rose-200 disabled:opacity-60"><Unlink size={16} /> Desconectar</button>
              </>}
            </div>
          </article>

          <article className="rounded-2xl border border-brand-line bg-brand-surface p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-green">Ativos descobertos</p>
            <h2 className="mt-1 text-lg font-black text-white">Contas e páginas autorizadas</h2>
            <div className="mt-4 space-y-2">
              {assets.map((asset, index) => <div key={asset.id || asset.asset_id || index} className="flex items-center gap-3 rounded-xl border border-brand-line bg-brand-ink/50 p-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-white/5">{asset.asset_type === 'adaccount' ? <CheckCircle2 className="text-brand-green" size={15} /> : <LinkIcon className="text-blue-300" size={15} />}</div><div><p className="font-bold text-white">{asset.asset_name || 'Ativo sem nome'}</p><p className="text-xs text-brand-muted">{asset.asset_type || 'tipo não informado'} · {asset.asset_id || asset.id}</p></div></div>)}
              {assets.length === 0 && <div className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-muted">Nenhum ativo carregado. Conecte a conta e execute a descoberta.</div>}
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
