import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, ChevronRight, ImageOff, Search, Sparkles, Trophy, X } from 'lucide-react';
import type { CamplyData } from '../types';
import { clientDisplayName } from '../data/clientDisplay';
import {
  buildCreativeLabClientSummary,
  buildCreativeLabCreatives,
  type CreativeLabClientState,
  type CreativeLabCreative,
} from '../lib/meta/creativeLab';

interface Props { data: CamplyData; }
type ClientFilter = 'all' | CreativeLabClientState;
type CreativeFilter = 'all' | 'active' | 'paused';

const PERIODS = [
  { id: 'last_7d', label: '7 dias' },
  { id: 'last_30d', label: '30 dias' },
  { id: 'last_90d', label: '90 dias' },
] as const;

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

const stateMeta: Record<CreativeLabClientState, { label: string; dot: string; badge: string }> = {
  media_active: { label: 'Mídia ativa', dot: 'bg-emerald-400', badge: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
  no_active_media: { label: 'Sem mídia ativa', dot: 'bg-amber-400', badge: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  inactive_client: { label: 'Cliente inativo', dot: 'bg-zinc-500', badge: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300' },
};

export function CreativeCriticView({ data }: Props) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('last_30d');
  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');
  const [creativeFilter, setCreativeFilter] = useState<CreativeFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedCreative, setSelectedCreative] = useState<CreativeLabCreative | null>(null);

  const summaries = useMemo(() => data.clients
    .filter((client) => client.status !== 'lead')
    .map((client) => buildCreativeLabClientSummary(data, client, period))
    .sort((left, right) => {
      const order: Record<CreativeLabClientState, number> = { media_active: 0, no_active_media: 1, inactive_client: 2 };
      if (order[left.state] !== order[right.state]) return order[left.state] - order[right.state];
      return clientDisplayName(left.client).localeCompare(clientDisplayName(right.client), 'pt-BR');
    }), [data, period]);

  const filteredClients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return summaries
      .filter((item) => clientFilter === 'all' || item.state === clientFilter)
      .filter((item) => !normalized
        || clientDisplayName(item.client).toLocaleLowerCase('pt-BR').includes(normalized)
        || item.client.segment.toLocaleLowerCase('pt-BR').includes(normalized));
  }, [summaries, clientFilter, query]);

  const selectedSummary = summaries.find((item) => item.client.id === selectedClientId) ?? null;
  const creatives = useMemo(() => selectedClientId ? buildCreativeLabCreatives(data, selectedClientId, period) : [], [data, selectedClientId, period]);
  const filteredCreatives = useMemo(() => creatives.filter((item) => creativeFilter === 'all' || item.status === creativeFilter), [creatives, creativeFilter]);

  useEffect(() => { setSelectedCreative(null); }, [selectedClientId, period]);

  const counts = useMemo(() => ({
    all: summaries.length,
    media_active: summaries.filter((item) => item.state === 'media_active').length,
    no_active_media: summaries.filter((item) => item.state === 'no_active_media').length,
    inactive_client: summaries.filter((item) => item.state === 'inactive_client').length,
  }), [summaries]);

  if (selectedSummary) {
    return (
      <div className="min-h-full bg-brand-ink p-4 text-white sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-5">
          <header className="flex flex-col gap-4 rounded-2xl border border-brand-line bg-brand-surface p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <button type="button" onClick={() => setSelectedClientId(null)} className="mt-0.5 rounded-lg border border-brand-line p-2 text-brand-muted transition hover:text-white" aria-label="Voltar para clientes">
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-black">{clientDisplayName(selectedSummary.client)}</h1>
                  <ClientStateBadge state={selectedSummary.state} />
                </div>
                <p className="mt-1 text-sm text-brand-muted">Laboratório de criativos · {selectedSummary.client.metaAdAccountName || 'Conta Meta vinculada'}</p>
                <p className="mt-1 text-xs text-brand-muted">Status de mídia considera conjuntos sincronizados, não apenas o status da campanha.</p>
              </div>
            </div>
            <select aria-label="Período do laboratório" value={period} onChange={(event) => setPeriod(event.target.value as (typeof PERIODS)[number]['id'])} className="rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm font-semibold text-white outline-none focus:border-brand-green">
              {PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Criativos com entrega" value={formatNumber(creatives.length)} />
            <SummaryCard label="Investimento analisado" value={money(creatives.reduce((sum, item) => sum + item.snapshot.spend, 0))} />
            <SummaryCard label="Melhor criativo" value={creatives[0]?.name || 'Sem dados'} compact />
            <SummaryCard label="Estrutura ativa" value={selectedSummary.activeAdSetCount + ' conjuntos · ' + selectedSummary.activeAdCount + ' anúncios'} compact />
          </section>

          <section className="rounded-2xl border border-brand-line bg-brand-surface">
            <div className="flex flex-col gap-3 border-b border-brand-line p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-black">Relatório de métricas dos criativos</h2>
                <p className="mt-1 text-xs text-brand-muted">Ranking objetivo pelas métricas sincronizadas do período.</p>
              </div>
              <div className="flex rounded-lg border border-brand-line bg-brand-ink p-1 text-xs">
                {([['all', 'Todos'], ['active', 'Ativos agora'], ['paused', 'Pausados']] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setCreativeFilter(id)} className={'rounded-md px-3 py-1.5 font-semibold transition ' + (creativeFilter === id ? 'bg-brand-green text-brand-ink' : 'text-brand-muted hover:text-white')}>{label}</button>
                ))}
              </div>
            </div>

            {filteredCreatives.length === 0 ? (
              <div className="grid min-h-64 place-items-center p-8 text-center">
                <div>
                  <ImageOff className="mx-auto h-9 w-9 text-brand-muted" />
                  <p className="mt-3 font-semibold text-brand-soft">Nenhum criativo com entrega encontrado nesse período.</p>
                  <p className="mt-1 text-xs text-brand-muted">O Lab só ranqueia criativos que possuem gasto ou impressões sincronizadas.</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-brand-line">
                {filteredCreatives.map((creative) => (
                  <CreativeRow key={creative.creativeId} creative={creative} rank={creatives.findIndex((item) => item.creativeId === creative.creativeId) + 1} onOpen={() => setSelectedCreative(creative)} />
                ))}
              </div>
            )}
          </section>
        </div>
        <CreativeDrawer creative={selectedCreative} onClose={() => setSelectedCreative(null)} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-brand-ink p-4 text-white sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <div className="flex items-center gap-2"><Sparkles className="text-brand-green" size={22} /><h1 className="text-2xl font-black">Laboratório de Criativos</h1></div>
          <p className="mt-1 text-sm text-brand-muted">Escolha um cliente para ver os criativos, métricas e melhores desempenhos.</p>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <FilterCard label="Todos" count={counts.all} active={clientFilter === 'all'} onClick={() => setClientFilter('all')} />
          <FilterCard label="Mídia ativa" count={counts.media_active} active={clientFilter === 'media_active'} onClick={() => setClientFilter('media_active')} tone="good" />
          <FilterCard label="Sem mídia ativa" count={counts.no_active_media} active={clientFilter === 'no_active_media'} onClick={() => setClientFilter('no_active_media')} tone="warning" />
          <FilterCard label="Clientes inativos" count={counts.inactive_client} active={clientFilter === 'inactive_client'} onClick={() => setClientFilter('inactive_client')} />
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-2.5 text-brand-muted" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente..." className="w-full rounded-lg border border-brand-line bg-brand-ink py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-brand-muted focus:border-brand-green" />
          </div>
          <select value={period} onChange={(event) => setPeriod(event.target.value as (typeof PERIODS)[number]['id'])} className="rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-sm text-white outline-none focus:border-brand-green">
            {PERIODS.map((item) => <option key={item.id} value={item.id}>Dados: {item.label}</option>)}
          </select>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredClients.map((item) => (
            <button type="button" key={item.client.id} onClick={() => setSelectedClientId(item.client.id)} className="group rounded-2xl border border-brand-line bg-brand-surface p-5 text-left transition hover:border-brand-muted/70 hover:bg-brand-surface2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="truncate font-black">{clientDisplayName(item.client)}</p><p className="mt-1 truncate text-xs text-brand-muted">{item.client.segment || 'Sem segmento'}</p></div>
                <ClientStateBadge state={item.state} />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <MiniMetric label="Campanhas Meta" value={formatNumber(item.metaCampaignCount)} />
                <MiniMetric label="Conjuntos ativos" value={formatNumber(item.activeAdSetCount)} />
                <MiniMetric label="Criativos no período" value={formatNumber(item.creativeCount)} />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-brand-line pt-3">
                <p className="text-[11px] text-brand-muted">
                  {item.state === 'media_active' ? item.campaignsWithActiveAdSets + ' campanhas com conjunto ativo' : item.state === 'no_active_media' ? 'Nenhum conjunto ativo sincronizado' : 'Cliente fora da operação ativa'}
                </p>
                <ChevronRight className="text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-white" size={16} />
              </div>
            </button>
          ))}
        </section>

        {filteredClients.length === 0 && <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-brand-line text-sm text-brand-muted">Nenhum cliente nesse filtro.</div>}
      </div>
    </div>
  );
}

function ClientStateBadge({ state }: { state: CreativeLabClientState }) {
  const meta = stateMeta[state];
  return <span className={'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ' + meta.badge}><span className={'h-1.5 w-1.5 rounded-full ' + meta.dot} />{meta.label}</span>;
}

function FilterCard({ label, count, active, onClick, tone = 'neutral' }: { label: string; count: number; active: boolean; onClick: () => void; tone?: 'neutral' | 'good' | 'warning' }) {
  const countClass = tone === 'good' ? 'text-emerald-300' : tone === 'warning' ? 'text-amber-300' : 'text-white';
  return <button type="button" onClick={onClick} className={'rounded-xl border p-4 text-left transition ' + (active ? 'border-brand-green bg-brand-green/10' : 'border-brand-line bg-brand-surface hover:bg-brand-surface2')}><p className="text-xs font-semibold text-brand-muted">{label}</p><p className={'mt-1 text-2xl font-black ' + countClass}>{count}</p></button>;
}

function SummaryCard({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div className="rounded-xl border border-brand-line bg-brand-surface p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-brand-muted">{label}</p><p className={'mt-2 font-black text-white ' + (compact ? 'truncate text-sm' : 'text-xl')} title={value}>{value}</p></div>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-brand-ink p-2.5"><p className="text-[9px] font-bold uppercase tracking-wide text-brand-muted">{label}</p><p className="mt-1 text-sm font-black text-white">{value}</p></div>;
}

function CreativeRow({ creative, rank, onOpen }: { creative: CreativeLabCreative; rank: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="grid w-full gap-4 p-4 text-left transition hover:bg-white/[0.025] lg:grid-cols-[48px_1.5fr_repeat(5,minmax(90px,0.65fr))_24px] lg:items-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-ink">{rank === 1 ? <Trophy size={17} className="text-amber-300" /> : <span className="text-sm font-black text-brand-muted">#{rank}</span>}</div>
      <div className="flex min-w-0 items-center gap-3">
        <CreativeThumb creative={creative} />
        <div className="min-w-0">
          <div className="flex items-center gap-2"><p className="truncate text-sm font-black">{creative.name}</p><span className={'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ' + (creative.status === 'active' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-brand-muted')}>{creative.status === 'active' ? 'Ativo' : 'Pausado'}</span></div>
          <p className="mt-1 truncate text-[11px] text-brand-muted">{creative.campaignNames.join(' · ')}</p>
        </div>
      </div>
      <Metric label="Investimento" value={money(creative.snapshot.spend)} />
      <Metric label="CTR" value={creative.snapshot.ctr === null ? '—' : formatNumber(creative.snapshot.ctr, 2) + '%'} />
      <Metric label="CPM" value={money(creative.snapshot.cpm)} />
      <Metric label={creative.primary.label} value={formatNumber(creative.primary.value)} />
      <Metric label={creative.primary.costLabel} value={money(creative.primary.cost)} />
      <ChevronRight className="hidden text-brand-muted lg:block" size={16} />
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-wide text-brand-muted">{label}</p><p className="mt-1 text-sm font-black text-white">{value}</p></div>;
}

function CreativeThumb({ creative, large = false }: { creative: CreativeLabCreative; large?: boolean }) {
  const sizeClass = large ? 'h-48 w-full' : 'h-12 w-12';
  if (!creative.thumbnailUrl) return <div className={sizeClass + ' grid shrink-0 place-items-center rounded-lg border border-brand-line bg-brand-ink text-brand-muted'}><ImageOff size={large ? 28 : 16} /></div>;
  return <img src={creative.thumbnailUrl} alt="" className={sizeClass + ' shrink-0 rounded-lg border border-brand-line bg-brand-ink object-cover'} loading="lazy" />;
}

function CreativeDrawer({ creative, onClose }: { creative: CreativeLabCreative | null; onClose: () => void }) {
  if (!creative) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-brand-line bg-brand-ink text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-brand-line p-5">
          <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-brand-green">Detalhe do criativo</p><h2 className="mt-1 truncate text-lg font-black">{creative.name}</h2></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-brand-muted transition hover:bg-white/5 hover:text-white" aria-label="Fechar"><X size={18} /></button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <CreativeThumb creative={creative} large />
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryCard label="Investimento" value={money(creative.snapshot.spend)} />
            <SummaryCard label={creative.primary.label} value={formatNumber(creative.primary.value)} />
            <SummaryCard label={creative.primary.costLabel} value={money(creative.primary.cost)} />
            <SummaryCard label="CTR" value={creative.snapshot.ctr === null ? '—' : formatNumber(creative.snapshot.ctr, 2) + '%'} />
            <SummaryCard label="CPM" value={money(creative.snapshot.cpm)} />
            <SummaryCard label="ROAS" value={creative.snapshot.roas === null ? '—' : formatNumber(creative.snapshot.roas, 2) + 'x'} />
          </section>
          <section className="rounded-xl border border-brand-line bg-brand-surface p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-brand-muted">Onde está rodando</h3>
            <DetailLine label="Campanhas" value={creative.campaignNames.join(', ')} />
            <DetailLine label="Conjuntos" value={creative.adSetNames.join(', ')} />
            <DetailLine label="Anúncios" value={creative.adNames.join(', ')} />
          </section>
          {(creative.title || creative.body) && <section className="rounded-xl border border-brand-line bg-brand-surface p-4"><h3 className="text-xs font-black uppercase tracking-widest text-brand-muted">Mensagem do criativo</h3>{creative.title && <p className="mt-3 font-bold text-white">{creative.title}</p>}{creative.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-brand-soft">{creative.body}</p>}</section>}
          <section className="rounded-xl border border-brand-green/20 bg-brand-green/5 p-4">
            <div className="flex items-center gap-2 text-brand-green"><BarChart3 size={16} /><h3 className="text-xs font-black uppercase tracking-widest">Leitura do Lab</h3></div>
            <p className="mt-2 text-sm leading-6 text-brand-soft">O ranking é calculado pelas métricas sincronizadas. A IA não define vencedor nem altera números; ela pode usar esses fatos apenas para explicar padrões e sugerir novos testes.</p>
          </section>
        </div>
      </aside>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="mt-3 border-t border-brand-line pt-3 first:border-0 first:pt-0"><p className="text-[10px] font-bold uppercase tracking-wide text-brand-muted">{label}</p><p className="mt-1 text-sm leading-5 text-brand-soft">{value || '—'}</p></div>;
}