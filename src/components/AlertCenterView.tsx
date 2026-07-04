import { useCallback, useEffect, useState } from 'react';
import type { CamplyData } from '../types';
import type { ClientIntelligenceAlertDTO } from '../contracts/clientIntelligence';
import { acknowledgeClientAlert, getClientIntelligenceDashboard, resolveClientAlert } from '../services/clientIntelligenceService';

interface Props { data: CamplyData; updateData: (updater: (data: CamplyData) => CamplyData) => void }

export function AlertCenterView({ data }: Props) {
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? '');
  const [alerts, setAlerts] = useState<ClientIntelligenceAlertDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!clientId) return;
    setLoading(true); setError('');
    try { setAlerts((await getClientIntelligenceDashboard(clientId, 'this_month')).alerts); }
    catch (reason) { setAlerts([]); setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os alertas persistidos.'); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void reload(); }, [reload]);

  const mutate = async (id: string, action: 'acknowledge' | 'resolve') => {
    setError('');
    try { await (action === 'acknowledge' ? acknowledgeClientAlert(id) : resolveClientAlert(id)); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível confirmar a alteração.'); }
  };

  return <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
    <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[.2em] text-brand-green">Persistidos no Supabase</p><h1 className="mt-1 text-2xl font-black text-white">Central de alertas</h1><p className="mt-1 text-sm text-brand-muted">As regras são avaliadas no backend sobre métricas do último run confiável.</p></div>
      <label className="text-xs font-bold text-brand-soft">Cliente<select aria-label="Cliente dos alertas" value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white md:w-72">{data.clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}</select></label>
    </header>
    {error && <div role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-rose-100">{error}</div>}
    {loading ? <div className="p-8 text-center text-brand-soft">Lendo alertas confirmados…</div> : alerts.length === 0 ? <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-center"><p className="font-black text-white">Nenhum alerta persistido</p><p className="mt-1 text-sm text-brand-muted">Isso não é tratado como “saudável” quando os dados estão indisponíveis; consulte Analytics para a qualidade do run.</p></div> : <div className="grid gap-3">{alerts.map((item) => <article key={item.id} className={`rounded-xl border p-4 ${item.severity === 'critical' ? 'border-rose-400/40 bg-rose-400/10' : item.severity === 'warning' ? 'border-amber-400/30 bg-amber-400/10' : 'border-brand-line bg-brand-surface'}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-wide text-brand-soft">{item.severity} · {item.status}</p><h2 className="mt-1 font-black text-white">{item.message}</h2><p className="mt-1 text-xs text-brand-muted">{item.campaignName ?? 'Nível do cliente'} · {item.metricId} · última ocorrência {item.lastTriggeredAt || 'não informada'}</p></div><div className="flex shrink-0 gap-2">{item.status === 'active' && <button onClick={() => void mutate(item.id, 'acknowledge')} className="rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-soft">Confirmar</button>}<button onClick={() => void mutate(item.id, 'resolve')} className="rounded-lg bg-brand-green px-3 py-2 text-xs font-black text-brand-ink">Resolver</button></div></div></article>)}</div>}
  </section>;
}
