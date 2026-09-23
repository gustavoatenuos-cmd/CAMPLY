import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { clientDisplayName } from '../../data/clientDisplay';
import { clientColor } from '../../lib/clientColors';
import { periodLabels, type DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import { getCampaignMetricCellsByObjective } from '../../lib/performance/campaignMetricCells';
import { fetchMetaPerformanceHierarchy, type HierarchicalMetricNode } from '../../lib/performance/metaPerformanceHierarchy';
import { objectiveDetailLabel, objectiveGroup } from '../../lib/meta/campaignObjectiveGroups';
import { compareCellWithBenchmark } from '../../lib/meta/campaignBenchmarks';
import { isCampaignActive, type MetaBoardCampaign } from '../../lib/meta/metaCampaignBoard';
import { TraceableMetricValue } from '../performance/TraceableMetricValue';
import { StatusBadge } from './CampaignStatusBadge';

interface MetaCampaignDetailDrawerProps {
  item: MetaBoardCampaign | null;
  period: DashboardPeriod;
  onClose: () => void;
}

type AdsetState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: HierarchicalMetricNode[] };

const investmentPeriodLabels: Record<string, string> = { daily: 'por dia', weekly: 'por semana', monthly: 'por mês' };

function formatMoney(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(value);
  } catch {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}

function adsManagerUrl(adAccountId: string, campaignId: string): string {
  const account = adAccountId.replace(/^act_/, '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account}&selected_campaign_ids=${campaignId}`;
}

export function MetaCampaignDetailDrawer({ item, period, onClose }: MetaCampaignDetailDrawerProps) {
  const [adsets, setAdsets] = useState<AdsetState>({ kind: 'loading' });

  useEffect(() => {
    if (!item) return;
    let active = true;
    setAdsets({ kind: 'loading' });
    fetchMetaPerformanceHierarchy(item.account.clientMetaAssetId, period, 'adset', item.campaign.id, 1, 50)
      .then((response) => {
        if (!active) return;
        const items = Array.isArray(response.items) ? response.items : [];
        setAdsets({ kind: 'ready', items });
      })
      .catch((error) => {
        console.error('[MetaCampaignDetailDrawer] Falha ao carregar conjuntos', error);
        if (active) setAdsets({ kind: 'error' });
      });
    return () => { active = false; };
  }, [item?.key, period]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const { client, account, campaign } = item;
  const color = clientColor(client);
  const group = objectiveGroup(item.group);
  const detail = objectiveDetailLabel(campaign.classifiedObjective, item.group);
  const cells = getCampaignMetricCellsByObjective(campaign.classifiedObjective, campaign.metrics ?? {}, account.currency);
  const benchmarks = client.benchmarks;
  const hasBenchmarks = Boolean(benchmarks && Object.values(benchmarks).some((value) => typeof value === 'number' && value > 0));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Campanha ${campaign.name}`}
        className="flex h-full w-full max-w-2xl flex-col border-l border-brand-line bg-brand-ink text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="space-y-3 border-b border-brand-line p-6" style={{ borderTopColor: color, borderTopWidth: 4 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-black uppercase tracking-widest" style={{ color }}>{clientDisplayName(client)}</p>
              <h2 className="text-lg font-black leading-snug">{campaign.name}</h2>
              <p className="text-xs text-brand-muted">{account.accountName} · {periodLabels[period]}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-brand-muted transition hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge active={item.isActive} />
            <span className="rounded-full px-2 py-0.5 font-bold" style={{ color: group.accent, backgroundColor: `${group.accent}22` }}>{group.label}</span>
            {detail && <span className="rounded-full bg-white/5 px-2 py-0.5 font-semibold text-brand-soft">{detail}</span>}
            <a href={adsManagerUrl(account.adAccountId, campaign.id)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-brand-muted transition hover:text-brand-green">
              Abrir no Gerenciador <ExternalLink size={12} />
            </a>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <section>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-brand-muted">Métricas da Meta</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {cells.map((cell) => {
                const comparison = compareCellWithBenchmark(cell, benchmarks);
                return (
                  <div key={cell.key} className="rounded-lg border border-brand-line bg-brand-surface p-3">
                    <p className="text-[11px] text-brand-muted">{cell.label}</p>
                    <p className={`mt-1 text-lg font-black ${comparison ? (comparison.status === 'good' ? 'text-emerald-400' : 'text-rose-400') : 'text-white'}`}>
                      <TraceableMetricValue metric={cell.metric}>{cell.value}</TraceableMetricValue>
                    </p>
                    {comparison && (
                      <p className="mt-1 text-[10px] text-brand-muted">
                        Referência: {cell.key.includes('roas') ? `${comparison.target.toFixed(2)}x` : cell.key.includes('ctr') ? `${comparison.target}%` : formatMoney(comparison.target, account.currency)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-brand-line bg-brand-surface p-4 text-sm">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-muted">Referências do cliente</h3>
            <p className="text-brand-soft">
              Investimento Meta planejado:{' '}
              <span className="font-bold text-white">
                {client.adInvestmentMeta > 0
                  ? `${formatMoney(client.adInvestmentMeta, account.currency)} ${investmentPeriodLabels[client.adInvestmentPeriod] ?? ''}`
                  : 'não informado'}
              </span>
            </p>
            {!hasBenchmarks && (
              <p className="mt-2 text-xs text-brand-muted">
                Sem metas de custo cadastradas. Defina CPA, CPL, ROAS e outras referências no cadastro do cliente (Analytics &amp; Alertas) para as métricas ficarem verdes ou vermelhas aqui.
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-brand-muted">Conjuntos de anúncios</h3>
            {adsets.kind === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-brand-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando conjuntos...</div>
            )}
            {adsets.kind === 'error' && <p className="text-sm text-rose-300">Não foi possível carregar os conjuntos agora.</p>}
            {adsets.kind === 'ready' && adsets.items.length === 0 && <p className="text-sm text-brand-muted">Nenhum conjunto sincronizado para esta campanha.</p>}
            {adsets.kind === 'ready' && adsets.items.length > 0 && (
              <div className="space-y-2">
                {adsets.items.map((adset) => {
                  // Ad sets carry no classified objective; use the campaign's so the columns match.
                  const adsetCells = getCampaignMetricCellsByObjective(campaign.classifiedObjective, adset.metrics ?? {}, account.currency).slice(0, 3);
                  return (
                    <div key={adset.id} className="rounded-lg border border-brand-line bg-brand-surface p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold" title={adset.name}>{adset.name}</p>
                        <StatusBadge active={isCampaignActive(adset)} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {adsetCells.map((cell) => (
                          <div key={cell.key}>
                            <p className="text-[10px] text-brand-muted">{cell.label}</p>
                            <p className="text-xs font-bold">{cell.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
