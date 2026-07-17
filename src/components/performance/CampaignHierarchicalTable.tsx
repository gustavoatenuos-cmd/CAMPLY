import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Layers3 } from 'lucide-react';
import type { GlobalPerformanceAccount } from '../../lib/performance/globalPerformanceDashboard';
import { fetchMetaPerformanceHierarchy, type HierarchicalMetricNode, type HierarchyLevel } from '../../lib/performance/metaPerformanceHierarchy';
import type { DashboardPeriod } from '../../lib/performance/analyticsCapabilities';
import type { MetricContract } from '../../lib/performance/globalPerformanceDashboard';
import { TraceableMetricValue } from './TraceableMetricValue';
import { getCampaignMetricCellsByObjective } from '../../lib/performance/campaignMetricCells';

interface CampaignHierarchicalTableProps {
  account: GlobalPerformanceAccount;
  period: DashboardPeriod;
}

export function CampaignHierarchicalTable({ account, period }: CampaignHierarchicalTableProps) {
  const [campaigns, setCampaigns] = useState<HierarchicalMetricNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadCampaigns() {
      try {
        setLoading(true);
        const response = await fetchMetaPerformanceHierarchy(account.clientMetaAssetId, period, 'campaign', null, 1, 100);
        if (active) {
          setCampaigns(response.items || []);
          setError(null);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadCampaigns();
    return () => { active = false; };
  }, [account.clientMetaAssetId, period]);

  if (loading) {
    return (
      <div className="rounded-xl border border-brand-line p-8 text-center text-sm text-brand-muted">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
        Buscando hierarquia ativa...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center text-sm text-red-400">
        Erro ao carregar campanhas: {error}
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-muted">
        Nenhuma campanha ativa encontrada para este período.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {campaigns.map((campaign) => (
        <HierarchicalNodeRow
          key={campaign.id}
          node={campaign}
          level="campaign"
          account={account}
          period={period}
        />
      ))}
    </div>
  );
}

// ─── Recursive Node Row ───────────────────────────────────────────────────────

interface HierarchicalNodeRowProps {
  node: HierarchicalMetricNode;
  level: HierarchyLevel;
  account: GlobalPerformanceAccount;
  period: DashboardPeriod;
}

function HierarchicalNodeRow({ node, level, account, period }: HierarchicalNodeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<HierarchicalMetricNode[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const nextLevel = level === 'campaign' ? 'adset' : level === 'adset' ? 'ad' : null;

  async function handleToggle() {
    if (!nextLevel) return;
    
    if (!expanded && !loaded) {
      setLoadingChildren(true);
      try {
        const response = await fetchMetaPerformanceHierarchy(account.clientMetaAssetId, period, nextLevel, node.id, 1, 100);
        setChildren(response.items || []);
        setLoaded(true);
      } catch (err) {
        console.error('Failed to load children', err);
      } finally {
        setLoadingChildren(false);
      }
    }
    setExpanded(!expanded);
  }

  const cells = getCampaignMetricCellsByObjective(node.classifiedObjective, node.metrics, account.currency);

  // Indentação visual por nível
  const marginLeft = level === 'campaign' ? '0' : level === 'adset' ? 'ml-6' : 'ml-12';
  const bgColor = level === 'campaign' ? 'bg-brand-ink/40' : level === 'adset' ? 'bg-brand-ink/20' : 'bg-transparent';
  const labelText = level === 'campaign' ? 'Campanha' : level === 'adset' ? 'Conjunto' : 'Anúncio';

  return (
    <div className={`flex flex-col ${marginLeft}`}>
      <div 
        className={`grid gap-3 rounded-xl border border-brand-line/70 p-4 md:items-center ${bgColor} ${nextLevel ? 'cursor-pointer hover:border-brand-line' : ''}`}
        style={{
          gridTemplateColumns: `minmax(240px, 1.7fr) repeat(${cells.length}, minmax(90px, 0.7fr))`
        }}
        onClick={() => nextLevel && handleToggle()}
      >
        <div className="flex min-w-0 items-center gap-3">
          {nextLevel && (
            <button type="button" className="shrink-0 text-brand-muted hover:text-white">
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
          {!nextLevel && <div className="w-4" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-bold text-white" title={node.name}>{node.name}</span>
              {node.classifiedObjective && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold text-brand-soft">
                  {node.classifiedObjective}
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-brand-muted">
              {labelText} {node.effectiveStatus && `· ${node.effectiveStatus}`}
            </p>
          </div>
        </div>

        {cells.map((cellData) => (
          <MetricCell key={cellData.key} label={cellData.label} value={cellData.value} metric={cellData.metric} />
        ))}
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 border-l border-brand-line/50 pl-2">
          {loadingChildren && (
            <div className="p-4 text-xs text-brand-muted flex items-center gap-2">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
              Buscando...
            </div>
          )}
          {!loadingChildren && children.length === 0 && (
            <div className="p-4 text-xs text-brand-muted">
              Nenhum item ativo encontrado.
            </div>
          )}
          {!loadingChildren && children.map((child) => (
            <HierarchicalNodeRow
              key={child.id}
              node={child}
              level={nextLevel as HierarchyLevel}
              account={account}
              period={period}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function MetricCell({ label, value, metric }: { label: string; value: string; metric?: MetricContract }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">{label}</p>
      <p className="mt-1 font-bold text-white">
        <TraceableMetricValue metric={metric}>{value}</TraceableMetricValue>
      </p>
    </div>
  );
}
