import { useEffect, useCallback } from 'react';
import type { CamplyData } from '../../types';
import { runAgentEngine } from '../../lib/agentEngine';
import { isMetaE2EMode } from '../../lib/meta/metaE2ERuntime';

export function useAgentEngine(
  authenticated: boolean,
  remoteLoaded: boolean,
  setData: (updater: (current: CamplyData) => CamplyData) => void
) {
  // Initial Agent Run when remote loads
  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;
    setData((current) => {
      const { newAlerts, newLogs } = runAgentEngine(current);
      if (newAlerts.length > 0 || newLogs.length > 0) {
        return {
          ...current,
          agentAlerts: [...newAlerts, ...current.agentAlerts],
          agentLogs: [...newLogs, ...current.agentLogs],
        };
      }
      return current;
    });
  }, [authenticated, remoteLoaded, setData]);

  // Wrapped update function that runs the agent engine on every change
  const updateData = useCallback((updater: (data: CamplyData) => CamplyData) => {
    setData((current) => {
      const next = updater(current);
      const { newAlerts, newLogs } = runAgentEngine(next);
      if (newAlerts.length > 0 || newLogs.length > 0) {
        return {
          ...next,
          agentAlerts: [...newAlerts, ...next.agentAlerts],
          agentLogs: [...newLogs, ...next.agentLogs],
        };
      }
      return next;
    });
  }, [setData]);

  return { updateData };
}
