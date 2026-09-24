import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronRight,
  Image as ImageIcon,
  Layers3,
  PauseCircle,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import type { CamplyData, CreativeCriticResponse } from '../types';
import { invokeFunction } from '../lib/invokeFunction';
import {
  buildCreativeLabClientRows,
  loadCreativeLabForClient,
  loadCreativeLabClientMediaSummaries,
  type CreativeLabClientMediaSummary,
  type CreativeLabClientResult,
  type CreativeLabClientRow,
  type CreativeLabClientState,
  type CreativeLabCreative,
  type CreativeLabPeriod,
} from '../lib/meta/creativeLabService';
import {
  loadClientMetaAssetCatalog,
  type ClientMetaAssetCatalog,
} from '../lib/meta/clientMetaAssetService';

interface Props {
  data: CamplyData;
}

type ClientFilter = 'all' | CreativeLabClientState;
type CreativeFilter = 'all' | 'active' | 'history';

const clientStateCopy: Record<CreativeLabClientState, { label: string; className: string; dot: string }> = {
  active_media: {
    label: 'Mídia ativa',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  no_active_media: {
    label: 'Sem mídia ativa',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  inactive: {
    label: 'Cliente inativo',
    className: 'border-white/10 bg-white/5 text-brand-muted',
    dot: 'bg-brand-muted',
  },
};

function money(value: number | null, currency = 'BRL'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  } catch {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}

function number(value: number | null, suffix = ''): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
}

function stateIcon(state: CreativeLabClientState) {
  if (state === 'active_media') return Activity;
  if (state === 'no_active_media') return PauseCircle;
  return Users;
}

function stateOrder(state: CreativeLabClientState): number {
  if (state === 'active_media') return 0;
  if (state === 'no_active_media') return 1;
  return 2;
}

function objectiveLabel(value: string | null): string {
  const objective = String(value || '').toUpperCase();
  if (objective === 'SALES') return 'Vendas';
  if (objective === 'LEADS') return 'Leads';
  if (objective === 'TRAFFIC') return 'Tráfego';
  if (objective.includes('WHATSAPP') || objective.includes('MESSAG')) return 'Mensagens';
  return value || 'Sem classificação';
}

function creativeKpi(creative: CreativeLabCreative): 'roas' | 'ctr' | 'cpa' {
  const objective = String(creative.objective || '').toUpperCase();
  if (objective === 'SALES') return 'roas';
  if (objective === 'TRAFFIC') return 'ctr';
  return 'cpa';
}

function ClientStateBadge({ state }: { state: CreativeLabClientState }) {
  const copy = clientStateCopy[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${copy.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${copy.dot}`} />
      {copy.label}
    </span>
  );
}

function ClientCard({ row, onOpen }: { row: CreativeLabClientRow; onOpen: () => void }) {
  const Icon = stateIcon(row.state);
  const disabled = row.accounts.length === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-2xl border border-brand-line bg-brand-surface p-5 text-left transition hover:border-brand-green/30 hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-brand-soft">
              <Icon size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-black text-white">{row.client.company || row.client.name}</h3>
              <p className="truncate text-xs text-brand-muted">{row.client.segment || 'Cliente CAMPLY'}</p>
            </div>
          </div>
        </div>
        <ChevronRight size={18} className="mt-2 shrink-0 text-brand-muted transition group-hover:translate-x-0.5 group-hover:text-brand-green" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ClientStateBadge state={row.state} />
        {row.accounts.length > 0 ? (
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-brand-muted">
            {row.accounts.length} conta{row.accounts.length > 1 ? 's' : ''} Meta
          </span>
        ) : (
          <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300">
            Meta não vinculada
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-brand-line/70 pt-4">
        <ClientMiniMetric label="Campanhas ativas" value={row.activeCampaigns} />
        <ClientMiniMetric label="Conjuntos ativos" value={row.activeAdSets} />
        <ClientMiniMetric label="Anúncios ativos" value={row.activeAds} />
      </div>
      {disabled && (
        <p className="mt-3 text-[11px] text-brand-muted">Abra o cliente mesmo sem vínculo para ver o motivo e a próxima ação.</p>
      )}
    </button>
  );
}

function ClientMiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-black text-white">{value}</p>
      <p className="text-[10px] leading-tight text-brand-muted">{label}</p>
    </div>
  );
}

function CreativeThumb({ creative, large = false }: { creative: CreativeLabCreative; large?: boolean }) {
  const src = creative.thumbnailUrl || creative.imageUrl;
  const size = large ? 'h-56 w-full' : 'h-16 w-16';
  return src ? (
    <img src={src} alt="" className={`${size} rounded-xl bg-black/20 object-cover`} />
  ) : (
    <div className={`${size} grid shrink-0 place-items-center rounded-xl border border-brand-line bg-black/20 text-brand-muted`}>
      <ImageIcon size={large ? 32 : 18} />
    </div>
  );
}

function CreativeMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-brand-line bg-black/15 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">{label}</p>
      <p className={`mt-1 text-base font-black ${accent ? 'text-brand-green' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function CreativeRow({
  creative,
  rank,
  onOpen,
}: {
  creative: CreativeLabCreative;
  rank: number;
  onOpen: () => void;
}) {
  const currency = creative.currency || 'BRL';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-brand-line bg-brand-surface p-4 text-left transition hover:border-brand-green/30 hover:bg-white/[0.04]"
    >
      <div className="flex gap-4">
        <CreativeThumb creative={creative} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-brand-muted">#{rank}</span>
                <h3 className="truncate font-black text-white">{creative.name}</h3>
              </div>
              <p className="mt-1 truncate text-xs text-brand-muted">
                {creative.campaigns.slice(0, 2).join(' · ') || 'Campanha não identificada'}
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
              creative.active
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-white/10 bg-white/5 text-brand-muted'
            }`}>
              {creative.active ? 'Em veiculação' : 'Histórico/pausado'}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <CreativeMetric label="Investimento" value={money(creative.spend, currency)} />
        <CreativeMetric label="CTR" value={number(creative.ctr, '%')} />
        <CreativeMetric label="CPM" value={money(creative.cpm, currency)} />
        <CreativeMetric label={creative.resultLabel} value={number(creative.resultValue)} accent />
        <CreativeMetric label={creative.costLabel} value={money(creative.costPerResult, currency)} />
        <CreativeMetric label="ROAS" value={creative.roas === null ? '—' : `${number(creative.roas)}x`} />
      </div>
    </button>
  );
}

export function CreativeCriticView({ data }: Props) {
  const [catalog, setCatalog] = useState<ClientMetaAssetCatalog | null>(null);
  const [mediaSummaries, setMediaSummaries] = useState<CreativeLabClientMediaSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<ClientFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [period, setPeriod] = useState<CreativeLabPeriod>('last_30d');
  const [creativeFilter, setCreativeFilter] = useState<CreativeFilter>('all');
  const [labResult, setLabResult] = useState<CreativeLabClientResult | null>(null);
  const [labLoading, setLabLoading] = useState(false);
  const [selectedCreative, setSelectedCreative] = useState<CreativeLabCreative | null>(null);
  const [analysis, setAnalysis] = useState<CreativeCriticResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    Promise.all([
      loadClientMetaAssetCatalog(),
      loadCreativeLabClientMediaSummaries(),
    ])
      .then(([result, summaries]) => {
        if (!active) return;
        setCatalog(result);
        setMediaSummaries(summaries);
        setCatalogError(null);
      })
      .catch((error) => {
        if (!active) return;
        setCatalogError(error instanceof Error ? error.message : 'Não foi possível carregar os vínculos Meta.');
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => { active = false; };
  }, []);

  const accountMap = useMemo(() => new Map(
    (catalog?.clients || []).map((item) => [item.clientId, item.accounts] as const)
  ), [catalog]);

  const mediaSummaryMap = useMemo(() => {
    const map = new Map<string, CreativeLabClientMediaSummary[]>();
    for (const summary of mediaSummaries) {
      const items = map.get(summary.clientId) || [];
      items.push(summary);
      map.set(summary.clientId, items);
    }
    return map;
  }, [mediaSummaries]);

  const clientRows = useMemo(
    () => buildCreativeLabClientRows(data, accountMap, mediaSummaryMap).sort((a, b) => (
      stateOrder(a.state) - stateOrder(b.state)
      || (a.client.company || a.client.name).localeCompare(b.client.company || b.client.name, 'pt-BR')
    )),
    [data, accountMap, mediaSummaryMap]
  );

  const visibleClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return clientRows.filter((row) => (
      (clientFilter === 'all' || row.state === clientFilter)
      && (!query || `${row.client.company} ${row.client.name} ${row.client.segment}`.toLocaleLowerCase('pt-BR').includes(query))
    ));
  }, [clientRows, clientFilter, search]);

  const selectedClient = useMemo(
    () => clientRows.find((row) => row.client.id === selectedClientId) || null,
    [clientRows, selectedClientId]
  );

  useEffect(() => {
    if (!selectedClient) {
      setLabResult(null);
      return;
    }
    let active = true;
    setLabLoading(true);
    setLabResult(null);
    setSelectedCreative(null);
    setAnalysis(null);
    setAnalysisError(null);
    loadCreativeLabForClient(selectedClient.accounts, period)
      .then((result) => {
        if (active) setLabResult(result);
      })
      .finally(() => {
        if (active) setLabLoading(false);
      });
    return () => { active = false; };
  }, [selectedClient?.client.id, selectedClient?.accounts, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const creatives = labResult?.creatives || [];
  const visibleCreatives = useMemo(() => creatives.filter((creative) => {
    if (creativeFilter === 'active') return creative.active;
    if (creativeFilter === 'history') return !creative.active;
    return true;
  }), [creatives, creativeFilter]);

  const currencies = useMemo(() => [...new Set(creatives.map((creative) => creative.currency || 'BRL'))], [creatives]);
  const investmentSummary = useMemo(() => currencies.map((currency) => {
    const value = creatives
      .filter((creative) => (creative.currency || 'BRL') === currency)
      .reduce((sum, creative) => sum + creative.spend, 0);
    return money(value, currency);
  }).join(' + '), [creatives, currencies]);

  const deliveredCreatives = creatives.filter((creative) => creative.spend > 0).length;
  const withoutResult = creatives.filter((creative) => creative.spend > 0 && creative.resultValue === 0).length;
  const bestCreative = creatives.find((creative) => creative.spend > 0);

  const runAiAnalysis = async (creative: CreativeLabCreative) => {
    if (!labResult) return;
    const rows = labResult.rawRows.filter((row) => `${row.accountId}:${row.creativeId}` === creative.key);
    if (rows.length === 0) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysis(null);
    try {
      const adsData = rows.slice(0, 20).map((row) => {
        const matchingAd = creative.ads.find((ad) => ad.adId === row.adId);
        const impressions = Number(row.metrics.impressions?.value || 0);
        const clicks = Number(row.metrics.link_clicks?.value || 0);
        const spend = Number(row.metrics.spend?.value || 0);
        const conversations = Number(row.metrics.messaging_conversations_started_total?.value || 0);
        const purchases = Number(row.metrics.purchases?.value || 0);
        const purchaseValue = Number(row.metrics.purchase_value?.value || 0);
        const leads = Number(row.metrics.leads?.value || 0);
        return {
          id: row.adId,
          name: row.adName,
          status: matchingAd?.activeStructure ? 'ACTIVE' : row.adEffectiveStatus || row.adStatus || 'PAUSED',
          creative: {
            title: row.title,
            body: row.body,
            thumbnail_url: row.thumbnailUrl || row.imageUrl,
          },
          metrics: {
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            cpc: clicks > 0 ? spend / clicks : 0,
            cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
            conversations,
            cost_per_conversation: conversations > 0 ? spend / conversations : 0,
            purchases,
            purchase_value: purchaseValue,
            purchase_roas: spend > 0 && purchaseValue > 0 ? purchaseValue / spend : 0,
            leads,
            cost_per_lead: leads > 0 ? spend / leads : 0,
          },
        };
      });
      const response = await invokeFunction<{ analysis: CreativeCriticResponse }>('meta-creative-critic', {
        adsData,
        kpi: creativeKpi(creative),
        scopeName: `${selectedClient?.client.company || selectedClient?.client.name} · ${creative.name}`,
      });
      setAnalysis(response.analysis);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'A análise por IA não pôde ser concluída.');
    } finally {
      setAnalysisLoading(false);
    }
  };

  if (selectedClient) {
    return (
      <div className="min-h-full bg-brand-ink p-4 text-white sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-4">
            <button
              type="button"
              onClick={() => setSelectedClientId(null)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-muted transition hover:text-white"
            >
              <ArrowLeft size={16} /> Todos os clientes
            </button>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <ClientStateBadge state={selectedClient.state} />
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-brand-muted">
                    {selectedClient.accounts.length} conta{selectedClient.accounts.length !== 1 ? 's' : ''} Meta
                  </span>
                </div>
                <h1 className="text-2xl font-black sm:text-3xl">{selectedClient.client.company || selectedClient.client.name}</h1>
                <p className="mt-1 text-sm text-brand-muted">
                  Ranking baseado nas métricas persistidas do Analytics. A IA só interpreta depois que você abre um criativo.
                </p>
              </div>
              <div className="flex rounded-xl border border-brand-line bg-brand-surface p-1">
                {([
                  ['last_7d', '7 dias'],
                  ['last_30d', '30 dias'],
                  ['last_90d', '90 dias'],
                ] as Array<[CreativeLabPeriod, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPeriod(value)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                      period === value ? 'bg-brand-green text-brand-ink' : 'text-brand-muted hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {selectedClient.accounts.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Cliente sem conta Meta vinculada"
              description="Vincule a conta em Integração Meta para o laboratório usar os snapshots oficiais."
            />
          ) : labLoading ? (
            <EmptyState icon={RefreshCw} spin title="Montando o laboratório" description="Carregando criativos e métricas verificadas do período..." />
          ) : labResult?.state !== 'ready' ? (
            <EmptyState
              icon={AlertTriangle}
              title="Laboratório indisponível para este período"
              description={labResult?.message || 'Nenhum criativo disponível.'}
            />
          ) : (
            <>
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard label="Criativos com entrega" value={String(deliveredCreatives)} note={`${creatives.length} criativos sincronizados`} icon={ImageIcon} />
                <SummaryCard label="Investimento analisado" value={investmentSummary || '—'} note="Somado por moeda" icon={BarChart3} />
                <SummaryCard label="Melhor criativo" value={bestCreative?.name || '—'} note={bestCreative ? `${bestCreative.resultLabel}: ${number(bestCreative.resultValue)}` : 'Sem entrega'} icon={Target} />
                <SummaryCard label="Investiram sem resultado" value={String(withoutResult)} note="Sinal factual para investigação" icon={AlertTriangle} />
              </section>

              <section className="rounded-2xl border border-brand-line bg-brand-surface p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-black text-white">Ranking de criativos</h2>
                    <p className="text-xs text-brand-muted">Ordenado pelo resultado principal do objetivo; sem score artificial.</p>
                  </div>
                  <div className="flex rounded-xl bg-black/20 p-1">
                    {([
                      ['all', 'Todos'],
                      ['active', 'Em veiculação'],
                      ['history', 'Histórico'],
                    ] as Array<[CreativeFilter, string]>).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setCreativeFilter(value)}
                        className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                          creativeFilter === value ? 'bg-white/10 text-white' : 'text-brand-muted hover:text-white'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                {visibleCreatives.map((creative) => (
                  <CreativeRow
                    key={creative.key}
                    creative={creative}
                    rank={creatives.findIndex((item) => item.key === creative.key) + 1}
                    onOpen={() => {
                      setSelectedCreative(creative);
                      setAnalysis(null);
                      setAnalysisError(null);
                    }}
                  />
                ))}
                {visibleCreatives.length === 0 && (
                  <EmptyState icon={ImageIcon} title="Nenhum criativo neste filtro" description="Troque o filtro para visualizar o restante do histórico." />
                )}
              </section>
            </>
          )}
        </div>

        {selectedCreative && (
          <CreativeDrawer
            creative={selectedCreative}
            rank={creatives.findIndex((item) => item.key === selectedCreative.key) + 1}
            total={creatives.length}
            analysis={analysis}
            analysisLoading={analysisLoading}
            analysisError={analysisError}
            onAnalyze={() => void runAiAnalysis(selectedCreative)}
            onClose={() => {
              setSelectedCreative(null);
              setAnalysis(null);
              setAnalysisError(null);
            }}
          />
        )}
      </div>
    );
  }

  const counts = {
    all: clientRows.length,
    active_media: clientRows.filter((row) => row.state === 'active_media').length,
    no_active_media: clientRows.filter((row) => row.state === 'no_active_media').length,
    inactive: clientRows.filter((row) => row.state === 'inactive').length,
  };

  return (
    <div className="min-h-full bg-brand-ink p-4 text-white sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <div className="flex items-center gap-2">
            <Sparkles className="text-brand-green" size={22} />
            <h1 className="text-2xl font-black sm:text-3xl">Laboratório de Criativos</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-brand-muted">
            Comece pelo cliente. O CAMPLY separa cliente ativo de mídia realmente ativa e usa a mesma base de métricas do Analytics para encontrar os melhores criativos.
          </p>
        </header>

        {catalogError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <strong>Vínculos Meta:</strong> {catalogError}
          </div>
        )}

        <section className="flex flex-col gap-3 rounded-2xl border border-brand-line bg-brand-surface p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-xl border border-brand-line bg-brand-ink py-2.5 pl-10 pr-3 text-sm text-white outline-none transition focus:border-brand-green/50"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ['all', 'Todos'],
              ['active_media', 'Mídia ativa'],
              ['no_active_media', 'Sem mídia ativa'],
              ['inactive', 'Inativos'],
            ] as Array<[ClientFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setClientFilter(value)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                  clientFilter === value
                    ? 'border-brand-green/40 bg-brand-green/10 text-brand-green'
                    : 'border-brand-line text-brand-muted hover:text-white'
                }`}
              >
                {label} <span className="ml-1 opacity-60">{counts[value]}</span>
              </button>
            ))}
          </div>
        </section>

        {catalogLoading ? (
          <EmptyState icon={RefreshCw} spin title="Carregando clientes" description="Lendo vínculos Meta e o estado da operação..." />
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleClients.map((row) => (
              <ClientCard key={row.client.id} row={row} onOpen={() => setSelectedClientId(row.client.id)} />
            ))}
          </section>
        )}

        {!catalogLoading && visibleClients.length === 0 && (
          <EmptyState icon={Users} title="Nenhum cliente neste filtro" description="Altere o filtro ou a busca para encontrar outro cliente." />
        )}

        <p className="text-xs text-brand-muted">
          “Mídia ativa” exige campanha, conjunto e anúncio em estrutura ativa na última sincronização. Campanha ligada com conjuntos pausados não é tratada como mídia ativa.
        </p>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof ImageIcon;
}) {
  return (
    <div className="rounded-2xl border border-brand-line bg-brand-surface p-4">
      <div className="flex items-center gap-2 text-brand-muted">
        <Icon size={15} />
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-3 line-clamp-2 text-xl font-black text-white">{value}</p>
      <p className="mt-1 text-[11px] text-brand-muted">{note}</p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  spin = false,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  spin?: boolean;
}) {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-brand-line bg-brand-surface/40 p-8 text-center">
      <div>
        <Icon size={34} className={`mx-auto mb-3 text-brand-muted ${spin ? 'animate-spin' : ''}`} />
        <h3 className="font-black text-white">{title}</h3>
        <p className="mt-1 max-w-lg text-sm text-brand-muted">{description}</p>
      </div>
    </div>
  );
}

function CreativeDrawer({
  creative,
  rank,
  total,
  analysis,
  analysisLoading,
  analysisError,
  onAnalyze,
  onClose,
}: {
  creative: CreativeLabCreative;
  rank: number;
  total: number;
  analysis: CreativeCriticResponse | null;
  analysisLoading: boolean;
  analysisError: string | null;
  onAnalyze: () => void;
  onClose: () => void;
}) {
  const currency = creative.currency || 'BRL';
  const shareNote = `Posição #${rank} de ${total} no período`;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Criativo ${creative.name}`}
        className="flex h-full w-full max-w-2xl flex-col border-l border-brand-line bg-brand-ink text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-brand-line p-5">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-brand-green">{shareNote}</p>
            <h2 className="mt-1 truncate text-xl font-black">{creative.name}</h2>
            <p className="mt-1 text-xs text-brand-muted">{objectiveLabel(creative.objective)} · {creative.adsCount} anúncio{creative.adsCount !== 1 ? 's' : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-brand-muted hover:bg-white/5 hover:text-white">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <CreativeThumb creative={creative} large />

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <CreativeMetric label="Investimento" value={money(creative.spend, currency)} />
            <CreativeMetric label="CTR" value={number(creative.ctr, '%')} />
            <CreativeMetric label="CPM" value={money(creative.cpm, currency)} />
            <CreativeMetric label={creative.resultLabel} value={number(creative.resultValue)} accent />
            <CreativeMetric label={creative.costLabel} value={money(creative.costPerResult, currency)} />
            <CreativeMetric label="ROAS" value={creative.roas === null ? '—' : `${number(creative.roas)}x`} />
          </section>

          <section className="rounded-2xl border border-brand-line bg-brand-surface p-4">
            <div className="flex items-center gap-2">
              <Layers3 size={16} className="text-brand-green" />
              <h3 className="font-black">Onde este criativo aparece</h3>
            </div>
            <div className="mt-3 space-y-2">
              {creative.ads.map((ad) => (
                <div key={ad.adId} className="rounded-xl border border-brand-line bg-black/15 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{ad.adName}</p>
                      <p className="mt-1 truncate text-[11px] text-brand-muted">{ad.campaignName} · {ad.adsetName || 'Sem conjunto'}</p>
                      <p className="mt-1 text-[10px] text-brand-muted">{ad.accountName}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                      ad.activeStructure ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-brand-muted'
                    }`}>
                      {ad.activeStructure ? 'Estrutura ativa' : 'Pausado/histórico'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-brand-green/20 bg-brand-green/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Bot size={17} className="text-brand-green" />
                  <h3 className="font-black">Interpretação por IA</h3>
                </div>
                <p className="mt-1 text-xs text-brand-muted">A IA recebe estas métricas verificadas; ela não escolhe nem recalcula o vencedor.</p>
              </div>
              <button
                type="button"
                onClick={onAnalyze}
                disabled={analysisLoading}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-xs font-black text-brand-ink disabled:opacity-50"
              >
                {analysisLoading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {analysisLoading ? 'Analisando...' : analysis ? 'Analisar novamente' : 'Analisar criativo'}
              </button>
            </div>

            {analysisError && <p className="mt-3 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{analysisError}</p>}

            {analysis && (
              <div className="mt-4 space-y-4 border-t border-brand-green/10 pt-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-brand-muted">Resumo</p>
                  <p className="mt-1 text-sm leading-6 text-brand-soft">{analysis.summary}</p>
                </div>
                {analysis.winner_patterns?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-brand-muted">Padrões observados</p>
                    <ul className="mt-2 space-y-1 text-sm text-brand-soft">
                      {analysis.winner_patterns.slice(0, 4).map((pattern) => (
                        <li key={pattern} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-brand-green" />{pattern}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.variant_briefs?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-brand-muted">Próximos testes sugeridos</p>
                    <div className="mt-2 grid gap-2">
                      {analysis.variant_briefs.slice(0, 3).map((brief, index) => (
                        <div key={`${brief.headline}-${index}`} className="rounded-xl border border-brand-line bg-brand-ink p-3">
                          <p className="text-xs font-black text-brand-green">{brief.headline}</p>
                          <p className="mt-1 text-xs leading-5 text-brand-muted">{brief.insight}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
