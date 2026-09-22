import { useState, useEffect, useCallback } from 'react';
import { loadGlobalPerformanceDashboard, type GlobalClientPerformance } from './globalPerformanceDashboard';
import { loadAnalyticsCapabilities, type DashboardPeriod } from './analyticsCapabilities';
import { isClientOperationallyActive } from '../../data/receivablesForecast';
import type { CamplyData } from '../../types';

export interface EnrichedGlobalClientPerformance extends GlobalClientPerformance {
  client?: any; // Replace with proper Client type if available
}

export interface UsePerformanceDashboardResult {
  clients: EnrichedGlobalClientPerformance[];
  loading: boolean;
  error: string | null;
  period: DashboardPeriod;
  setPeriod: (period: DashboardPeriod) => void;
  reload: () => Promise<void>;
}

export function selectOperationalDashboardClients(
  result: GlobalClientPerformance[],
  workspaceData: CamplyData
): EnrichedGlobalClientPerformance[] {
  return result.filter(c => {
    const workspaceClient = workspaceData.clients.find(w => w.id === c.clientId);
    if (!workspaceClient) return true;
    const project = workspaceData.projects.find(item => item.id === workspaceClient.projectId);
    return isClientOperationallyActive(workspaceClient, project);
  }).map(c => {
    const workspaceClient = workspaceData.clients.find(w => w.id === c.clientId);
    return workspaceClient
      ? { ...c, clientName: workspaceClient.company || workspaceClient.name || c.clientName, client: workspaceClient }
      : { ...c, client: undefined };
  });
}

export function usePerformanceDashboard(workspaceData: CamplyData, defaultPeriod: DashboardPeriod = 'last_30d'): UsePerformanceDashboardResult {
  const [period, setPeriod] = useState<DashboardPeriod>(defaultPeriod);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<EnrichedGlobalClientPerformance[]>([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const capabilities = await loadAnalyticsCapabilities();
      if (!capabilities) {
        setError('Capacidades analíticas não disponíveis.');
        setLoading(false);
        return;
      }

      const result = await loadGlobalPerformanceDashboard({
        period,
        dashboardRpc: (capabilities.mode === 'analytics' ? capabilities.capabilities.dashboardRpc : '') as any,
      });

      setClients(selectOperationalDashboardClients(result, workspaceData));
    } catch (err) {
      console.error('[usePerformanceDashboard] Erro ao carregar dashboard:', err);
      setError('Falha ao carregar métricas de performance.');
    } finally {
      setLoading(false);
    }
  }, [period, workspaceData.clients]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return {
    clients,
    loading,
    error,
    period,
    setPeriod,
    reload: loadDashboard,
  };
}
