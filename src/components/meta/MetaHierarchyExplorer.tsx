import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Scale,
  Target,
} from 'lucide-react';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import {
  resolveDerivedMetric,
  type TraceableMetric,
} from '../../lib/performance/traceableMetrics';
import {
  fetchMetaPerformanceHierarchy,
  type HierarchicalMetricNode,
  type HierarchyLevel,
  type HierarchyResponse,
} from '../../lib/performance/metaPerformanceHierarchy';
import { isRunStale } from '../../lib/performance/campaignDecisionEligibility';
import { syncMetaAsset } from '../../lib/meta/metaSyncService';
import type { ClientMetaAccount } from '../../lib/meta/clientMetaAssetService';
import { TraceableMetricValue } from '../performance/TraceableMetricValue';
import { CampaignActivityStatusBadge } from '../performance/CampaignActivityStatusBadge';
import { TargetSettingsDrawer } from './TargetSettingsDrawer';
import { MetricReconciliationPanel } from './MetricReconciliationPanel';

const nextLevel: Partial<Record<HierarchyLevel, HierarchyLevel>> = {
  campaign: 'adset',
  adset: 'ad',
  ad: 'creative',
};

const levelLabels: Record<HierarchyLevel, string> = {
  campaign: 'Campanha',
  adset: 'Conjunto',
  ad: 'Anúncio',
  creative: 'Criativo',
};

const bucketSections: Array<{
  key: 'activeNoDeliveryItems' | 'activeWithoutActiveStructureItems' | 'pausedWithSpendItems' | 'unclassifiedDestinationItems';
  totalKey: 'activeNoDeliveryTotal' | 'activeWithoutActiveStructureTotal' | 'pausedWithSpendTotal' | 'unclassifiedDestinationTotal';
  title: string;
}> = [
  { key: 'activeNoDeliveryItems', totalKey: 'activeNoDeliveryTotal', title: 'Ativas sem entrega' },
  { key: 'activeWithoutActiveStructureItems', totalKey: 'activeWithoutActiveStructureTotal', title: 'Ativas sem estrutura ativa' },
  { key: 'pausedWithSpendItems', totalKey: 'pausedWithSpendTotal', title: 'Pausadas com gasto' },
  { key: 'unclassifiedDestinationItems', totalKey: 'unclassifiedDestinationTotal', title: 'Objetivo não classificado' },
];

function metricNumber(metric: TraceableMetric | undefined): number | null {
  return metric?.available && metric.value !== null ? metric.value : null;
}

function currency(value: number | null, code: string | null): string {
  if (value === null) return '—';
  if (!code) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(value);
  } catch {
    return `${code} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}

function number(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${suffix}`;
}

function MetricGrid({ metrics, currencyCode }: { metrics: Record<string, TraceableMetric>; currencyCode: string | null }) {
  const cells = useMemo(() => {
    const specs: Array<[string, string, 'currency' | 'number' | 'percent']> = [
      ['spend', 'Investimento', 'currency'],
      ['impressions', 'Impressões', 'number'],
      ['reach', 'Alcance', 'number'],
      ['clicks', 'Cliques (todos)', 'number'],
      ['link_clicks', 'Cliques no link', 'number'],
      ['link_ctr', 'CTR', 'percent'],
      ['cpm', 'CPM', 'currency'],
      ['link_cpc', 'CPC', 'currency'],
      ['landing_page_views', 'Landing pages', 'number'],
      ['messaging_conversations_started_total', 'Conversas', 'number'],
      ['whatsapp_conversations_started', 'WhatsApp', 'number'],
      ['messenger_conversations_started', 'Messenger', 'number'],
      ['instagram_direct_conversations_started', 'Instagram', 'number'],
      ['cost_per_messaging_conversation', 'Custo/conversa', 'currency'],
      ['leads', 'Leads', 'number'],
      ['cost_per_lead', 'CPL', 'currency'],
      ['purchases', 'Compras', 'number'],
      ['cost_per_purchase', 'CPA', 'currency'],
      ['purchase_value', 'Valor de compras', 'currency'],
      ['purchase_roas', 'ROAS', 'number'],
    ];
    return specs.map(([metricId, label, format]) => {
      const metric = resolveDerivedMetric(metrics, metricId);
      const value = metricNumber(metric);
      return {
        metricId,
        label,
        metric,
        formatted: format === 'currency' ? currency(value, currencyCode) : number(value, format === 'percent' ? '%' : ''),
      };
    });
  }, [currencyCode, metrics]);

  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.metricId} className="rounded-lg bg-black/15 p-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-brand-muted">{cell.label}</p>
          <p className="mt-1 text-sm font-black text-white">
            <TraceableMetricValue metric={cell.metric}>{cell.formatted}</TraceableMetricValue>
          </p>
        </div>
      ))}
    </div>
  );
}

export function MetaHierarchyExplorer({
  account,
  period,
  refreshToken = 0,
  onChanged,
}: {
  account: ClientMetaAccount;
  period: DashboardPeriod;
  refreshToken?: number;
  onChanged?: () => void;
}) {
  const [root, setRoot] = useState<HierarchyResponse | null>(null);
  const [children, setChildren] = useState<Record<string, HierarchyResponse>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetItem, setTargetItem] = useState<HierarchicalMetricNode | null>(null);
  const [reconciliationItem, setReconciliationItem] = useState<HierarchicalMetricNode | null>(null);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoot(await fetchMetaPerformanceHierarchy(account.clientMetaAssetId, period, 'campaign'));
      setChildren({});
      setExpanded({});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar campanhas.');
    } finally {
      setLoading(false);
    }
  }, [account.clientMetaAssetId, period]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot, refreshToken]);

  const refreshRoot = async () => {
    await loadRoot();
    onChanged?.();
  };

  const loadChildren = async (item: HierarchicalMetricNode, level: HierarchyLevel) => {
    const childLevel = nextLevel[level];
    if (!childLevel) return;
    const key = `${level}:${item.id}`;
    if (children[key]) {
      setExpanded((current) => ({ ...current, [key]: !current[key] }));
      return;
    }
    setLoadingKey(key);
    setError(null);
    try {
      const page = await fetchMetaPerformanceHierarchy(account.clientMetaAssetId, period, childLevel, item.id);
      setChildren((current) => ({ ...current, [key]: page }));
      setExpanded((current) => ({ ...current, [key]: true }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível abrir este nível.');
    } finally {
      setLoadingKey(null);
    }
  };

  const loadMoreRoot = async () => {
    if (!root || root.items.length >= root.total) return;
    setLoadingKey('root:more');
    try {
      const nextPage = await fetchMetaPerformanceHierarchy(
        account.clientMetaAssetId, period, 'campaign', null, root.page + 1, root.pageSize
      );
      setRoot((current) => current ? {
        ...nextPage,
        items: [...current.items, ...nextPage.items],
      } : nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar mais campanhas.');
    } finally {
      setLoadingKey(null);
    }
  };

  const loadMoreChildren = async (item: HierarchicalMetricNode, level: HierarchyLevel) => {
    const childLevel = nextLevel[level];
    const key = `${level}:${item.id}`;
    const currentPage = children[key];
    if (!childLevel || !currentPage || currentPage.items.length >= currentPage.total) return;
    setLoadingKey(`${key}:more`);
    try {
      const nextPage = await fetchMetaPerformanceHierarchy(
        account.clientMetaAssetId, period, childLevel, item.id, currentPage.page + 1, currentPage.pageSize
      );
      setChildren((current) => ({
        ...current,
        [key]: { ...nextPage, items: [...currentPage.items, ...nextPage.items] },
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar mais itens.');
    } finally {
      setLoadingKey(null);
    }
  };

  const syncEntity = async (item: HierarchicalMetricNode, level: HierarchyLevel) => {
    const key = `${level}:${item.id}`;
    setLoadingKey(key);
    setError(null);
    try {
      await syncMetaAsset({
        clientMetaAssetId: account.clientMetaAssetId,
        period,
        requestedLevel: level === 'campaign' ? 'adset' : 'creative',
        campaignIds: level === 'campaign' ? [item.id] : [],
        adsetIds: level === 'adset' ? [item.id] : [],
        adIds: level === 'ad' ? [item.id] : [],
      });
      setChildren((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      const childLevel = nextLevel[level];
      if (childLevel) {
        const page = await fetchMetaPerformanceHierarchy(account.clientMetaAssetId, period, childLevel, item.id);
        setChildren((current) => ({ ...current, [key]: page }));
        setExpanded((current) => ({ ...current, [key]: true }));
      }
      onChanged?.();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'A sincronização seletiva falhou.');
    } finally {
      setLoadingKey(null);
    }
  };

  if (loading) return <div className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-brand-line text-brand-muted"><LoaderCircle className="animate-spin" size={18} /> Carregando campanhas...</div>;
  if (error && !root) return <StateMessage title="Não foi possível carregar a hierarquia" impact={error} action="Tentar novamente" onAction={() => void refreshRoot()} />;
  if (root?.state === 'period_not_synced') return <StateMessage title="Período ainda não sincronizado" impact="Nenhuma campanha confiável será exibida até uma sincronização completa deste período." />;
  if (!root || root.items.length === 0) return <StateMessage title="Nenhuma campanha analisável encontrada" impact="A conta não possui campanhas analisáveis coletadas para este período, ou ainda precisa ser sincronizada." action="Atualizar leitura" onAction={() => void refreshRoot()} />;

  const stale = isRunStale(root.run ?? null);

  return (
    <div data-testid="meta-hierarchy" className="space-y-3">
      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
      {stale && root.run?.finishedAt && (
        <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          Sincronização antiga: usando o último snapshot confiável de {new Date(root.run.finishedAt).toLocaleString('pt-BR')}.
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">Hierarquia Meta oficial</p>
          <p className="text-xs text-brand-muted">
            {root.total} campanha(s) analisável(is) · {root.run?.finishedAt ? `Ativa no último sync (${new Date(root.run.finishedAt).toLocaleString('pt-BR')})` : 'sem sync confiável'}
          </p>
        </div>
        <button type="button" onClick={() => void refreshRoot()} className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-soft"><RefreshCw size={13} /> Atualizar leitura</button>
      </div>
      {root.items.map((item) => (
        <EntityNode
          key={item.id}
          item={item}
          level="campaign"
          account={account}
          children={children}
          expanded={expanded}
          loadingKey={loadingKey}
          onExpand={loadChildren}
          onLoadMore={loadMoreChildren}
          onSync={syncEntity}
          onTarget={setTargetItem}
          onReconcile={setReconciliationItem}
        />
      ))}
      {root.items.length < root.total && <button type="button" onClick={() => void loadMoreRoot()} disabled={loadingKey === 'root:more'} className="w-full rounded-xl border border-brand-line px-4 py-3 text-sm font-black text-brand-green disabled:opacity-60">{loadingKey === 'root:more' ? 'Carregando...' : `Carregar mais campanhas (${root.total - root.items.length})`}</button>}

      {bucketSections.map((section) => (
        <BucketSection
          key={section.key}
          title={section.title}
          items={root[section.key]}
          total={root[section.totalKey]}
          currencyCode={account.currency}
        />
      ))}

      <TargetSettingsDrawer
        open={Boolean(targetItem)}
        onClose={() => setTargetItem(null)}
        clientMetaAssetId={account.clientMetaAssetId}
        campaignId={targetItem?.id}
        campaignName={targetItem?.name || undefined}
        metrics={targetItem?.metrics}
        onSaved={onChanged}
      />
      <MetricReconciliationPanel
        open={Boolean(reconciliationItem)}
        onClose={() => setReconciliationItem(null)}
        entityName={reconciliationItem?.name || 'Entidade Meta'}
        metricMap={reconciliationItem?.metrics || {}}
      />
    </div>
  );
}

function BucketSection({
  title,
  items,
  total,
  currencyCode,
}: {
  title: string;
  items: HierarchicalMetricNode[];
  total: number;
  currencyCode: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-dashed border-brand-line bg-brand-surface/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-bold text-white">{title} ({total})</span>
        {open ? <ChevronDown size={16} className="text-brand-muted" /> : <ChevronRight size={16} className="text-brand-muted" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-brand-line/70 p-3">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/15 p-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-white">{item.name || item.id}</p>
                <p className="mt-1 text-xs text-brand-muted">{item.classifiedObjective || item.objective || 'Objetivo não informado'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-brand-soft">
                  {currency(metricNumber(item.metrics.spend), currencyCode)}
                </span>
                {item.verdict && <CampaignActivityStatusBadge verdict={item.verdict} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntityNode({
  item,
  level,
  account,
  children,
  expanded,
  loadingKey,
  onExpand,
  onLoadMore,
  onSync,
  onTarget,
  onReconcile,
}: {
  item: HierarchicalMetricNode;
  level: HierarchyLevel;
  account: ClientMetaAccount;
  children: Record<string, HierarchyResponse>;
  expanded: Record<string, boolean>;
  loadingKey: string | null;
  onExpand: (item: HierarchicalMetricNode, level: HierarchyLevel) => Promise<void>;
  onLoadMore: (item: HierarchicalMetricNode, level: HierarchyLevel) => Promise<void>;
  onSync: (item: HierarchicalMetricNode, level: HierarchyLevel) => Promise<void>;
  onTarget: (item: HierarchicalMetricNode) => void;
  onReconcile: (item: HierarchicalMetricNode) => void;
}) {
  const key = `${level}:${item.id}`;
  const page = children[key];
  const childLevel = nextLevel[level];
  const busy = loadingKey === key;
  const isPaused = (item.effectiveStatus || item.status || '').toUpperCase().includes('PAUSED');

  return (
    <article data-testid={`meta-${level}-${item.id}`} className="rounded-xl border border-brand-line bg-brand-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {childLevel ? (
            <button type="button" aria-label={`Abrir ${levelLabels[level]} ${item.name || item.id}`} onClick={() => void onExpand(item, level)} className="mt-0.5 rounded p-1 text-brand-soft hover:bg-white/5 hover:text-white">
              {busy ? <LoaderCircle className="animate-spin" size={17} /> : expanded[key] ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            </button>
          ) : <ImageIcon className="mt-1 text-brand-green" size={17} />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-black text-white">{item.name || item.id}</p>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold text-brand-soft">{levelLabels[level]}</span>
              {level === 'campaign' && item.verdict ? (
                <CampaignActivityStatusBadge verdict={item.verdict} />
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isPaused ? 'bg-amber-400/10 text-amber-200' : 'bg-emerald-400/10 text-emerald-200'}`}>{item.effectiveStatus || item.status || 'STATUS N/D'}</span>
              )}
            </div>
            <p className="mt-1 break-all text-xs text-brand-muted">ID: {item.id}</p>
            <p className="mt-1 text-xs text-brand-muted">{item.classifiedObjective || item.objective || 'Objetivo não informado'} · {item.destinationType || 'Destino não informado'} · {item.attributionSetting || 'Atribuição no detalhe da métrica'}</p>
            {level === 'adset' && <p className="mt-1 text-xs text-brand-soft">Orçamento: {item.dailyBudget != null ? `${currency(item.dailyBudget, account.currency)}/dia` : item.lifetimeBudget != null ? currency(item.lifetimeBudget, account.currency) : 'não informado pela Meta'}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {level === 'campaign' && <button data-testid={`meta-target-${item.id}`} type="button" onClick={() => onTarget(item)} className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-2.5 py-1.5 text-xs font-bold text-brand-soft"><Target size={13} /> Metas</button>}
          <button data-testid={`meta-reconcile-${level}-${item.id}`} type="button" onClick={() => onReconcile(item)} className="inline-flex items-center gap-1 rounded-lg border border-brand-line px-2.5 py-1.5 text-xs font-bold text-brand-soft"><Scale size={13} /> Conciliar</button>
          {childLevel && <button type="button" disabled={busy} onClick={() => void onSync(item, level)} className="inline-flex items-center gap-1 rounded-lg bg-brand-green/10 px-2.5 py-1.5 text-xs font-bold text-brand-green disabled:opacity-60"><Layers3 size={13} /> Sincronizar {levelLabels[childLevel]}</button>}
        </div>
      </div>

      {level === 'creative' && (
        <div className="mt-3 grid gap-3 rounded-xl border border-brand-line/70 bg-brand-ink/50 p-3 md:grid-cols-[120px_1fr]">
          {item.thumbnailUrl || item.imageUrl ? <img src={item.thumbnailUrl || item.imageUrl || ''} alt={`Criativo ${item.name || item.id}`} className="h-28 w-full rounded-lg object-cover" /> : <div className="grid h-28 place-items-center rounded-lg bg-white/5 text-brand-muted"><ImageIcon size={24} /></div>}
          <div><p className="font-bold text-white">{item.title || 'Headline indisponível'}</p><p className="mt-2 text-sm text-brand-muted">{item.body || 'Texto do criativo indisponível.'}</p><p className="mt-2 text-xs text-brand-soft">Formato: {String(item.objectStorySpec?.format || 'não identificado')} · Atualizado: {item.updatedAt ? new Date(item.updatedAt).toLocaleString('pt-BR') : 'não informado'}</p></div>
        </div>
      )}
      <MetricGrid metrics={item.metrics} currencyCode={account.currency} />

      {expanded[key] && childLevel && (
        <div className="mt-4 space-y-3 border-l border-brand-line pl-3 sm:pl-5">
          {page?.state === 'period_not_synced' && <StateMessage title={`${levelLabels[childLevel]} ainda não sincronizado`} impact="Execute a sincronização seletiva deste nível para carregar dados oficiais." action={`Sincronizar ${levelLabels[childLevel]}`} onAction={() => void onSync(item, level)} />}
          {page?.state === 'empty' && <StateMessage title={`Nenhum ${levelLabels[childLevel].toLowerCase()} encontrado`} impact="A coleta foi concluída, mas não retornou entidades neste escopo." action="Sincronizar novamente" onAction={() => void onSync(item, level)} />}
          {page?.items.map((child) => (
            <EntityNode key={child.id} item={child} level={childLevel} account={account} children={children} expanded={expanded} loadingKey={loadingKey} onExpand={onExpand} onLoadMore={onLoadMore} onSync={onSync} onTarget={onTarget} onReconcile={onReconcile} />
          ))}
          {page && page.items.length < page.total && <button type="button" onClick={() => void onLoadMore(item, level)} disabled={loadingKey === `${key}:more`} className="w-full rounded-lg border border-brand-line px-3 py-2 text-xs font-black text-brand-green disabled:opacity-60">{loadingKey === `${key}:more` ? 'Carregando...' : `Carregar mais ${levelLabels[childLevel].toLowerCase()}s`}</button>}
        </div>
      )}
    </article>
  );
}

function StateMessage({ title, impact, action, onAction }: { title: string; impact: string; action?: string; onAction?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-line bg-brand-surface/60 p-5 text-center">
      <p className="font-bold text-white">{title}</p>
      <p className="mt-1 text-sm text-brand-muted">{impact}</p>
      {action && onAction && <button type="button" onClick={onAction} className="mt-3 rounded-lg border border-brand-line px-3 py-2 text-xs font-bold text-brand-green">{action}</button>}
    </div>
  );
}
