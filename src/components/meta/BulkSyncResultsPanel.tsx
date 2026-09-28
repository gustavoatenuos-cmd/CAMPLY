import type { BulkSyncAccountResult } from '../../lib/meta/bulkSyncDiagnostics';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { describeBulkSyncResult, type MetaSyncHealth } from '../../lib/meta/metaSyncHealth';


function toneClasses(health: MetaSyncHealth): string {
  switch (health.tone) {
    case 'success':
      return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200';
    case 'warning':
      return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
    case 'danger':
      return 'border-rose-400/20 bg-rose-400/10 text-rose-200';
    case 'info':
      return 'border-sky-400/20 bg-sky-400/10 text-sky-200';
    default:
      return 'border-brand-line bg-white/[0.04] text-brand-muted';
  }
}

interface BulkSyncResultsPanelProps {
  results: BulkSyncAccountResult[];
  onRetry: (result: BulkSyncAccountResult) => void;
  retryDisabled?: boolean;
}

export function BulkSyncResultsPanel({ results, onRetry, retryDisabled = false }: BulkSyncResultsPanelProps) {
  if (results.length === 0) return null;

  return (
    <div data-testid="meta-bulk-sync-results" className="mt-4 space-y-2">
      <p className="text-xs font-semibold text-brand-soft">Diagnóstico técnico da reconstrução</p>
      {results.map((result) => {
        const health = describeBulkSyncResult(result);
        return (
          <div
            key={result.clientMetaAssetId}
            data-testid="meta-bulk-sync-result-row"
            className="flex flex-col gap-2 rounded-xl border border-brand-line bg-brand-ink/50 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-bold text-white">{result.clientName}</p>
              <p className="truncate text-xs text-brand-muted">{result.accountName} · {result.adAccountId}</p>
              <p className="mt-1 text-xs text-brand-soft">{health.detail}</p>
              {result.errorCode && <p className="mt-1 text-[10px] text-brand-muted">Código: {result.errorCode}</p>}
              {result.runId && <p className="mt-1 text-[10px] text-brand-muted">Run: {result.runId}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${toneClasses(health)}`}>
                {health.state === 'updated' && <CheckCircle2 size={13} />}
                {health.state === 'delayed' && <RefreshCw size={13} />}
                {health.state === 'needs_retry' && <AlertTriangle size={13} />}
                {health.state === 'running' && <RefreshCw size={13} className="animate-spin" />}
                {health.label}
              </span>
              {health.retryRecommended && (
                <button
                  type="button"
                  data-testid="meta-bulk-sync-retry"
                  disabled={retryDisabled}
                  onClick={() => onRetry(result)}
                  className="rounded-lg border border-brand-line px-2.5 py-1 text-[11px] font-bold text-brand-soft disabled:opacity-60"
                >
                  Tentar novamente
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
