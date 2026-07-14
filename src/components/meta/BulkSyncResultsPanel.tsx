import type { BulkSyncAccountResult } from '../../lib/meta/bulkSyncDiagnostics';
import { SyncStatusBadge } from './SyncStatusBadge';

interface BulkSyncResultsPanelProps {
  results: BulkSyncAccountResult[];
  onRetry: (result: BulkSyncAccountResult) => void;
  retryDisabled?: boolean;
}

export function BulkSyncResultsPanel({ results, onRetry, retryDisabled = false }: BulkSyncResultsPanelProps) {
  if (results.length === 0) return null;

  return (
    <div data-testid="meta-bulk-sync-results" className="mt-4 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-green">Resultado da sincronização</p>
      {results.map((result) => {
        const detail = result.error || result.message;
        return (
          <div
            key={result.clientMetaAssetId}
            data-testid="meta-bulk-sync-result-row"
            className="flex flex-col gap-2 rounded-xl border border-brand-line bg-brand-ink/50 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-bold text-white">{result.clientName}</p>
              <p className="truncate text-xs text-brand-muted">{result.accountName} · {result.adAccountId}</p>
              {detail && <p className="mt-1 text-xs text-brand-soft">{detail}</p>}
              {result.runId && <p className="mt-1 text-[10px] text-brand-muted">Run: {result.runId}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SyncStatusBadge status={result.status} />
              {result.status === 'failed' && (
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
