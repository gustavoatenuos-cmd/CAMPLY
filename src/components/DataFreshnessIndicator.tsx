import { Check, LoaderCircle, RefreshCw } from 'lucide-react';
import type { MetaFreshnessState } from '../hooks/useMetaFreshness';

export function DataFreshnessIndicator({ state }: { state: MetaFreshnessState }) {
  if (state.phase === 'idle') return null;

  if (state.phase === 'checking') {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-brand-muted">
        <LoaderCircle size={13} className="animate-spin" />
        Verificando atualização automática
      </div>
    );
  }

  if (state.phase === 'refreshing') {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-brand-soft">
        <LoaderCircle size={13} className="animate-spin" />
        Atualizando automaticamente {state.completed}/{state.total}
      </div>
    );
  }

  if (state.phase === 'attention') {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-amber-300">
        <RefreshCw size={13} />
        Nova tentativa automática em breve
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 text-xs text-brand-muted">
      <Check size={13} />
      Atualização automática ativa
    </div>
  );
}
