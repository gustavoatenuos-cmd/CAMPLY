import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { X, RefreshCw, AlertCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  syncRunId: string;
}

export function ReconciliationModal({ isOpen, onClose, syncRunId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [runInfo, setRunInfo] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && syncRunId) {
      loadData();
    }
  }, [isOpen, syncRunId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!supabase) throw new Error('Supabase not connected');

      // 1. Load Sync Run
      const { data: runData, error: runErr } = await supabase
        .from('meta_sync_runs')
        .select('*')
        .eq('id', syncRunId)
        .single();
      
      if (runErr && runErr.code !== 'PGRST116') throw runErr;
      setRunInfo(runData);

      // 2. Load Normalized Metrics
      const { data: metricsData, error: metricsErr } = await supabase
        .from('meta_normalized_metrics')
        .select('*')
        .eq('sync_run_id', syncRunId);
        
      if (metricsErr) throw metricsErr;
      setMetrics(metricsData || []);

      // 3. Load Raw Snapshots
      const { data: snapsData, error: snapsErr } = await supabase
        .from('meta_raw_snapshots')
        .select('*')
        .eq('sync_run_id', syncRunId);
        
      if (snapsErr) throw snapsErr;
      setSnapshots(snapsData || []);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-brand-line bg-brand-surface p-6 shadow-2xl flex flex-col">
        
        <div className="flex items-center justify-between border-b border-brand-line pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Conciliação de Dados Meta Ads</h2>
            <p className="text-xs text-brand-muted mt-1 font-mono">Sync Run ID: {syncRunId}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-brand-soft hover:bg-brand-surface2 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-brand-soft">
            <RefreshCw size={32} className="animate-spin mb-4" />
            <p>Carregando trilha de auditoria...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-4 text-rose-500">
            <AlertCircle size={20} />
            <p className="text-sm">{error}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Sync Run Overview */}
            {runInfo && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg bg-brand-surface2 p-4">
                  <p className="text-[10px] uppercase text-brand-muted font-bold">Status</p>
                  <p className={`font-mono text-sm mt-1 ${runInfo.status === 'success' ? 'text-green-400' : 'text-amber-400'}`}>{runInfo.status}</p>
                </div>
                <div className="rounded-lg bg-brand-surface2 p-4">
                  <p className="text-[10px] uppercase text-brand-muted font-bold">Graph API Version</p>
                  <p className="font-mono text-sm mt-1 text-white">{runInfo.api_version || 'v20.0'}</p>
                </div>
                <div className="rounded-lg bg-brand-surface2 p-4">
                  <p className="text-[10px] uppercase text-brand-muted font-bold">Início do Sync</p>
                  <p className="font-mono text-sm mt-1 text-white">{new Date(runInfo.started_at).toLocaleString()}</p>
                </div>
                <div className="rounded-lg bg-brand-surface2 p-4">
                  <p className="text-[10px] uppercase text-brand-muted font-bold">Total Campanhas Lidas</p>
                  <p className="font-mono text-sm mt-1 text-white">{runInfo.campaigns_processed || 0}</p>
                </div>
              </div>
            )}

            {/* Granular Normalized Data */}
            <div>
              <h3 className="text-sm font-bold text-white mb-3">Métricas Normalizadas vs Dados Brutos</h3>
              <div className="overflow-x-auto rounded-lg border border-brand-line">
                <table className="w-full text-left text-sm text-white">
                  <thead className="bg-brand-surface2 text-xs text-brand-muted uppercase">
                    <tr>
                      <th className="p-3 font-bold">Campanha (ID)</th>
                      <th className="p-3 font-bold">Período</th>
                      <th className="p-3 font-bold">Atribuição</th>
                      <th className="p-3 font-bold">Métrica</th>
                      <th className="p-3 font-bold text-right">Valor Normalizado</th>
                      <th className="p-3 font-bold">Fórmula/Ação Base</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-line bg-brand-surface">
                    {metrics.map(m => {
                      return (
                        <tr key={m.id} className="hover:bg-brand-surface2/30">
                          <td className="p-3 font-mono text-[11px] max-w-[120px] truncate text-brand-soft" title={m.campaign_id}>{m.campaign_id}</td>
                          <td className="p-3 text-[11px] whitespace-nowrap">{m.date_start} até {m.date_stop}</td>
                          <td className="p-3 text-[11px] font-mono text-amber-500/80">{m.attribution_setting || 'default'}</td>
                          <td className="p-3 font-semibold text-blue-400">{m.metric_id}</td>
                          <td className="p-3 font-mono text-right text-brand-green font-bold">{m.metric_value}</td>
                          <td className="p-3 text-[10px] font-mono text-brand-soft max-w-[200px] truncate">
                            [Calculated / Action Sum]
                          </td>
                        </tr>
                      );
                    })}
                    {metrics.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-brand-muted">
                          Nenhuma métrica normalizada gravada neste Sync.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Raw JSON Snapshot reference (Admin Debugging) */}
            <div>
              <h3 className="text-sm font-bold text-white mb-3">Snapshots Brutos da Meta (Raw)</h3>
              <div className="space-y-3">
                {snapshots.slice(0, 5).map(snap => (
                  <details key={snap.id} className="rounded-lg border border-brand-line bg-brand-surface p-4">
                    <summary className="cursor-pointer text-xs font-bold text-white outline-none">
                      Snapshot de Campanha: <span className="font-mono text-blue-400">{snap.campaign_id}</span> ({snap.date_start} - {snap.date_stop})
                    </summary>
                    <div className="mt-4 bg-brand-ink p-4 rounded border border-brand-line overflow-x-auto">
                      <pre className="text-[10px] text-brand-soft font-mono">
                        {JSON.stringify(snap.raw_data, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
                {snapshots.length > 5 && (
                  <p className="text-xs text-brand-muted">+ {snapshots.length - 5} snapshots omitidos.</p>
                )}
                {snapshots.length === 0 && (
                  <p className="text-xs text-brand-muted">Nenhum snapshot bruto gravado para este run ID.</p>
                )}
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
