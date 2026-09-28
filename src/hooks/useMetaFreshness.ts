import { useEffect, useState } from 'react';
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

export const META_BACKGROUND_CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const META_FOCUS_RECHECK_MIN_INTERVAL_MS = 2 * 60 * 1000;

export function useMetaFreshness(enabled: boolean, userId?: string | null): MetaFreshnessState {
  const [state, setState] = useState<MetaFreshnessState>(INITIAL);

  useEffect(() => {
    if (!enabled || !userId) {
      setState(INITIAL);
      return;
    }

    let active = true;
    let inFlight = false;
    let lastCheckAt = 0;

    const run = async (showChecking = false) => {
      if (!active || inFlight) return;

      const now = Date.now();
      if (!showChecking && now - lastCheckAt < META_FOCUS_RECHECK_MIN_INTERVAL_MS) return;

      inFlight = true;
      lastCheckAt = now;

      if (showChecking) {
        setState((current) => ({
          ...current,
          phase: current.phase === 'idle' ? 'checking' : current.phase,
        }));
      }

      try {
        const snapshot = await loadMetaFreshnessStatus();
        if (!active) return;

        const stale = snapshot.items.filter((item) => item.needsStructureRefresh);
        if (snapshot.state !== 'ready') {
          setState({
            phase: 'attention',
            completed: 0,
            total: 0,
            failed: 0,
            snapshot,
          });
          return;
        }

        if (stale.length === 0) {
          setState({
            phase: 'fresh',
            completed: 0,
            total: 0,
            failed: 0,
            snapshot,
          });
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
      } catch (error) {
        if (!active) return;
        console.warn('[MetaFreshness] automatic refresh cycle failed', error);
        setState((current) => ({
          ...current,
          phase: 'attention',
        }));
      } finally {
        inFlight = false;
      }
    };

    void run(true);

    const intervalId = window.setInterval(() => {
      void run(false);
    }, META_BACKGROUND_CHECK_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void run(false);
    };

    const handleOnline = () => {
      void run(false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [enabled, userId]);

  return state;
}
