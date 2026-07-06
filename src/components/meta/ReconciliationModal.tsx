import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { supabaseData } from '../../lib/supabase';
import {
  reconcileNormalizedMetric,
  type AdSetEntityRecord,
  type NormalizedMetricRecord,
  type RawSnapshotRecord,
} from '../../lib/meta/reconciliation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  syncRunId: string;
}

interface SyncRunRecord {
  id: string;
  ad_account_id: string;
  status: string;
  graph_api_version: string;
  started_at: string;
  records_fetched: number | null;
  error_message: string | null;
  metadata?: {
    failed_adsets?: string[];
    completeness_by_period?: Record<string, string>;
    persistence_failures?: Array<{ operation: string; message: string; adsetId?: string }>;
  } | null;
}

interface CampaignEntityRecord {
  campaign_id: string;
  campaign_name: string;
  classified_objective: string | null;
}

const formatNumber = (value: number | undefined, suffix = '') =>
  value === undefined || !Number.isFinite(value) ? 'Indisponível' : `${value.toFixed(4)}${suffix}`;

export function ReconciliationModal({ isOpen, onClose, syncRunId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runInfo, setRunInfo] = useState<SyncRunRecord | null>(null);
  const [snapshots, setSnapshots] = useState<RawSnapshotRecord[]>([]);
  const [metrics, setMetrics] = useState<NormalizedMetricRecord[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignEntityRecord[]>([]);
  const [adsets, setAdsets] = useState<AdSetEntityRecord[]>([]);

  useEffect(() => {
    if (!isOpen || !syncRunId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!supabaseData) throw new Error('Supabase not connected');

        const { data: run, error: runError } = await supabaseData
          .from('meta_sync_runs')
          .select('*')
          .eq('id', syncRunId)
          .single();
        if (runError) throw runError;
        const typedRun = run as SyncRunRecord;
        setRunInfo(typedRun);

        const [metricsResult, snapshotsResult, campaignsResult, adsetsResult] = await Promise.all([
          supabaseData.from('meta_normalized_metrics').select('*').eq('sync_run_id', syncRunId).limit(1000),
          supabaseData.from('meta_raw_snapshots').select('*').eq('sync_run_id', syncRunId).limit(1000),
          supabaseData.from('meta_campaign_entities').select('campaign_id,campaign_name,classified_objective').eq('ad_account_id', typedRun.ad_account_id),
          supabaseData.from('meta_adset_entities').select('adset_id,campaign_id,attribution_setting').eq('ad_account_id', typedRun.ad_account_id),
        ]);

        if (metricsResult.error) throw metricsResult.error;
        if (snapshotsResult.error) throw snapshotsResult.error;
        if (campaignsResult.error) throw campaignsResult.error;
        if (adsetsResult.error) throw adsetsResult.error;

        setMetrics((metricsResult.data || []) as NormalizedMetricRecord[]);
        setSnapshots((snapshotsResult.data || []) as RawSnapshotRecord[]);
        setCampaigns((campaignsResult.data || []) as CampaignEntityRecord[]);
        setAdsets((adsetsResult.data || []) as AdSetEntityRecord[]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Falha ao carregar conciliação');
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [isOpen, syncRunId]);

  const reconciliation = useMemo(() => metrics.map((metric) => ({
    metric,
    result: reconcileNormalizedMetric(metric, snapshots, adsets),
  })), [metrics, snapshots, adsets]);

  if (!isOpen) return null;

  const failedAdsets = runInfo?.metadata?.failed_adsets || [];
  const campaignName = (campaignId: string | null) =>
    campaigns.find((campaign) => campaign.campaign_id === campaignId)?.campaign_name || campaignId || '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-y-auto rounded-2xl border border-brand-line bg-brand-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-brand-line pb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Conciliação de Dados Meta Ads</h2>
            <p className="mt-1 font-mono text-xs text-brand-muted">Sync Run ID: {syncRunId}</p>
          </div>
          <button aria-label="Fechar conciliação" onClick={onClose} className="rounded-lg p-2 text-brand-soft hover:bg-brand-surface2 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-brand-soft">
            <RefreshCw size={32} className="mb-4 animate-spin" />
            <p>Carregando trilha de auditoria...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-4 text-rose-500">
            <AlertCircle size={20} />
            <p className="text-sm">{error}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {runInfo && (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Summary label="Status" value={runInfo.status} warning={runInfo.status !== 'success'} />
                  <Summary label="Timezone" value={`${(runInfo as any).timezone || 'UNKNOWN'} (${(runInfo as any).currency || 'UNKNOWN'})`} />
                  <Summary label="Graph API" value={runInfo.graph_api_version} />
                  <Summary label="Início" value={new Date(runInfo.started_at).toLocaleString()} />
                  <Summary label="Registros lidos" value={String(runInfo.records_fetched || 0)} />
                </div>
                {(runInfo.error_message || failedAdsets.length > 0) && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
                    <p><strong>Falhas de coleta/persistência:</strong> {runInfo.error_message || 'Falhas associadas a Ad Sets.'}</p>
                    <p className="mt-1"><strong>Ad Sets ausentes/falhos:</strong> {failedAdsets.length ? failedAdsets.join(', ') : 'Nenhum identificado'}</p>
                  </div>
                )}
              </>
            )}

            <section>
              <h3 className="mb-3 text-sm font-bold text-white">Métricas normalizadas × payload bruto</h3>
              <div className="overflow-x-auto rounded-lg border border-brand-line">
                <table className="w-full text-left text-sm text-white">
                  <thead className="bg-brand-surface2 text-xs uppercase text-brand-muted">
                    <tr>
                      <th className="p-3">Fonte</th>
                      <th className="p-3">Período</th>
                      <th className="p-3">Completude</th>
                      <th className="p-3">Métrica</th>
                      <th className="p-3 text-right">Bruto</th>
                      <th className="p-3 text-right">Normalizado</th>
                      <th className="p-3 text-right">Diferença</th>
                      <th className="p-3">Fórmula</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-line">
                    {reconciliation.map(({ metric, result }) => (
                      <tr key={metric.id} className="hover:bg-brand-surface2/30">
                        <td className="p-3 text-[11px]">
                          <strong>{metric.source_level || 'unknown'}</strong><br />
                          <span className="text-brand-muted">{campaignName(metric.campaign_id)}</span><br />
                          {metric.adset_id && <span className="font-mono text-[9px] text-brand-muted">AdSet: {metric.adset_id}</span>}
                        </td>
                        <td className="whitespace-nowrap p-3 text-[11px]">{metric.date_start || '—'} até {metric.date_stop || '—'}<br />
                          <span className="font-mono text-amber-400">{metric.attribution_setting || 'UNKNOWN'}</span>
                        </td>
                        <td className="p-3 text-[11px]">{metric.completeness_status || 'unknown'}</td>
                        <td className="p-3 font-semibold text-blue-400">{metric.metric_id}</td>
                        <td className="p-3 text-right font-mono">{formatNumber(result.rawValue)}</td>
                        <td className="p-3 text-right font-mono font-bold text-brand-green">{formatNumber(result.normalizedValue)}</td>
                        <td className="p-3 text-right font-mono text-xs">
                          {formatNumber(result.absoluteDifference)}<br />
                          <span className="text-brand-muted">{formatNumber(result.percentageDifference, '%')}</span>
                        </td>
                        <td className="max-w-[260px] p-3 font-mono text-[10px] text-brand-soft">{result.formula}</td>
                      </tr>
                    ))}
                    {reconciliation.length === 0 && (
                      <tr><td colSpan={8} className="p-8 text-center text-brand-muted">Nenhuma métrica normalizada neste sync.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-bold text-white">Todos os snapshots brutos</h3>
              <div className="space-y-3">
                {snapshots.map((snapshot) => (
                  <details key={snapshot.id} className="rounded-lg border border-brand-line bg-brand-surface p-4">
                    <summary className="cursor-pointer text-xs font-bold text-white">
                      Nível <span className="font-mono text-blue-400">{snapshot.entity_level}</span> — {snapshot.id}
                    </summary>
                    <div className="mt-4 overflow-x-auto rounded border border-brand-line bg-brand-ink p-4">
                      <pre className="font-mono text-[10px] text-brand-soft">{JSON.stringify(snapshot.payload, null, 2)}</pre>
                    </div>
                  </details>
                ))}
                {snapshots.length === 0 && <p className="text-xs text-brand-muted">Nenhum snapshot bruto gravado.</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="rounded-lg bg-brand-surface2 p-4">
      <p className="text-[10px] font-bold uppercase text-brand-muted">{label}</p>
      <p className={`mt-1 font-mono text-sm ${warning ? 'text-amber-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}
