import { useEffect, useState } from 'react';
import type { CamplyData } from '../types';
import type { ClientIntelligenceDashboardDTO, IntelligencePeriod } from '../contracts/clientIntelligence';
import { getClientIntelligenceDashboard } from '../services/clientIntelligenceService';

interface Props { data: CamplyData; updateData: (updater: (data: CamplyData) => CamplyData) => void }
const periods: Array<{ id: IntelligencePeriod; label: string }> = [
  { id: 'today', label: 'Hoje' }, { id: 'yesterday', label: 'Ontem' },
  { id: 'this_week', label: 'Esta semana' }, { id: 'last_week', label: 'Semana anterior' },
  { id: 'this_month', label: 'Este mês' }, { id: 'last_month', label: 'Mês anterior' },
];

function format(value: number | null, unit?: string, currency = 'BRL') {
  if (value == null) return '—';
  if (unit === 'currency') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  if (unit === 'percentage') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (unit === 'ratio') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function ClientAnalyticsView({ data }: Props) {
  const [clientId, setClientId] = useState(data.clients[0]?.id ?? '');
  const [period, setPeriod] = useState<IntelligencePeriod>('this_month');
  const [dashboard, setDashboard] = useState<ClientIntelligenceDashboardDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    setLoading(true); setError('');
    void getClientIntelligenceDashboard(clientId, period).then((result) => {
      if (active) setDashboard(result);
    }).catch((reason) => {
      if (active) { setDashboard(null); setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a inteligência.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, period]);

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <header className="mb-5">
        <p className="text-xs font-black uppercase tracking-[.2em] text-brand-green">Inteligência oficial</p>
        <h1 className="mt-1 text-2xl font-black text-white">Analytics por cliente</h1>
        <p className="mt-1 text-sm text-brand-muted">Somente runs completos persistidos; tentativas parciais aparecem separadamente.</p>
      </header>
      <div className="mb-5 grid gap-3 rounded-xl border border-brand-line bg-brand-surface p-4 md:grid-cols-2">
        <label className="text-xs font-bold text-brand-soft">Cliente<select aria-label="Cliente analítico" value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">{data.clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}</select></label>
        <label className="text-xs font-bold text-brand-soft">Período<select aria-label="Período analítico" value={period} onChange={(event) => setPeriod(event.target.value as IntelligencePeriod)} className="mt-1 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">{periods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </div>
      {loading && <div className="rounded-xl border border-brand-line p-8 text-center text-brand-soft">Carregando dados oficiais…</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">{error}</div>}
      {!loading && !error && dashboard && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Card label="Última sincronização confiável" value={dashboard.dataQuality.reliableRunId ? `${dashboard.dataQuality.dateStart ?? ''} — ${dashboard.dataQuality.dateStop ?? ''}` : 'Indisponível'} />
            <Card label="Última tentativa" value={dashboard.dataQuality.latestAttemptRunId ? dashboard.dataQuality.latestAttemptStatus ?? 'Sem status' : 'Nenhuma'} />
            <Card label="Score explicável" value={dashboard.score.value == null ? 'Dados insuficientes' : `${dashboard.score.value}/100`} detail={dashboard.score.explanation} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card label="Planejado" value={format(dashboard.budgetPacing.planned, 'currency', dashboard.dataQuality.currency ?? 'BRL')} />
            <Card label="Investido" value={format(dashboard.budgetPacing.actual, 'currency', dashboard.dataQuality.currency ?? 'BRL')} />
            <Card label="Esperado agora" value={format(dashboard.budgetPacing.expectedNow, 'currency', dashboard.dataQuality.currency ?? 'BRL')} />
            <Card label="Projeção" value={format(dashboard.budgetPacing.projectedEnd, 'currency', dashboard.dataQuality.currency ?? 'BRL')} detail={dashboard.budgetPacing.status} />
          </div>
          {dashboard.dataQuality.status === 'unavailable' ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-6 text-amber-100"><strong>Dados indisponíveis.</strong><p className="mt-1 text-sm">Sem run qualificado, nenhuma pontuação ou leitura saudável é inventada.</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.metrics.map((metric) => <Card key={metric.metricId} label={metric.label} value={format(metric.actual, metric.unit, dashboard.dataQuality.currency ?? 'BRL')} detail={`Meta: ${typeof metric.target === 'number' ? format(metric.target, metric.unit, dashboard.dataQuality.currency ?? 'BRL') : metric.target ? `${metric.target.min}–${metric.target.max}` : 'não configurada'} · ${metric.status}`} />)}
            </div>
          )}
          <div className="rounded-xl border border-brand-line bg-brand-surface p-4">
            <h2 className="font-black text-white">Campanhas do mesmo run confiável</h2>
            {dashboard.campaigns.length === 0 ? <p className="mt-3 text-sm text-brand-muted">Nenhuma campanha qualificada para o período.</p> : <div className="mt-3 grid gap-2">{dashboard.campaigns.map((campaign) => <div key={`${campaign.campaignId}-${campaign.objective}`} className="min-w-0 rounded-lg border border-brand-line bg-brand-ink p-3"><p className="truncate font-bold text-white">{campaign.campaignName}</p><p className="text-xs text-brand-muted">{campaign.objective ?? 'Objetivo não classificado'} · {format(campaign.spend, 'currency', dashboard.dataQuality.currency ?? 'BRL')}</p></div>)}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function Card({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="min-w-0 rounded-xl border border-brand-line bg-brand-surface p-4"><p className="text-xs font-bold uppercase tracking-wide text-brand-muted">{label}</p><p className="mt-2 break-words text-lg font-black text-white">{value}</p>{detail && <p className="mt-1 text-xs text-brand-soft">{detail}</p>}</div>;
}
