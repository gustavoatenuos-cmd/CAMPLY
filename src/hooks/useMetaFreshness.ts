import { useEffect, useRef, useState } from 'react';
import {
  loadMetaFreshnessStatus,
  refreshStaleMetaStructure,
  type MetaFreshnessSnapshot,
} from '../lib/meta/metaFreshnessService';

export type MetaFreshnessPhase = 'idle' | 'checking' | 'refreshing' | 'fresh' | 'attention';

export interface MetaFreshnessState {
  phase: MetaFreshnessPhase;
  completed: number;
  total: number;
  failed: number;
  snapshot: MetaFreshnessSnapshot | null;
}

const INITIAL: MetaFreshnessState = {
  phase: 'idle',
  completed: 0,
  total: 0,
  failed: 0,
  snapshot: null,
};

export function useMetaFreshness(enabled: boolean, userId?: string | null): MetaFreshnessState {
  const [state, setState] = useState<MetaFreshnessState>(INITIAL);
  const runKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      runKeyRef.current = null;
      setState(INITIAL);
      return;
    }

    const key = \`\${userId}:\${new Date().toISOString().slice(0, 10)}\`;
    if (runKeyRef.current === key) return;
    runKeyRef.current = key;

    let active = true;

    const run = async () => {
      setState({ ...INITIAL, phase: 'checking' });
      const snapshot = await loadMetaFreshnessStatus();
      if (!active) return;

      const stale = snapshot.items.filter((item) => item.needsStructureRefresh);
      if (snapshot.state !== 'ready') {
        setState({ ...INITIAL, phase: 'attention', snapshot });
        return;
      }
      if (stale.length === 0) {
        setState({ ...INITIAL, phase: 'fresh', snapshot });
        return;
      }

      setState({
        phase: 'refreshing',
        completed: 0,
        total: stale.length,
        failed: 0,
        snapshot,
      });

      const result = await refreshStaleMetaStructure(snapshot, (completed, total) => {
        if (!active) return;
        setState((current) => ({ ...current, completed, total }));
      });
      if (!active) return;

      const refreshed = await loadMetaFreshnessStatus();
      if (!active) return;

      const remaining = refreshed.items.filter((item) => item.needsStructureRefresh).length;
      setState({
        phase: remaining === 0 ? 'fresh' : 'attention',
        completed: result.attempted,
        total: result.attempted,
        failed: result.failed,
        snapshot: refreshed,
      });
    };

    void run();

    return () => {
      active = false;
    };
  }, [enabled, userId]);

  return state;
}
