import { useState, useEffect, useCallback } from 'react';
import { loadGlobalPerformanceDashboard, type GlobalClientPerformance } from './globalPerformanceDashboard';
import { loadAnalyticsCapabilities, type DashboardPeriod } from './analyticsCapabilities';
import { isClientOperationallyActive } from '../../data/receivablesForecast';
import type { CamplyData, Client } from '../../types';

export interface EnrichedGlobalClientPerformance extends GlobalClientPerformance {
  client?: Client;
}

export interface UsePerformanceDashboardResult {
  clients: EnrichedGlobalClientPerformance[];
  loading: boolean;
  error: string | null;
  period: DashboardPeriod;
  setPeriod: (period: DashboardPeriod) => void;
  reload: () => Promise<void>;
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

      const enrichedResult = result.flatMap(c => {
        const workspaceClient = workspaceData.clients.find(w => w.id === c.clientId);
        const workspaceProject = workspaceClient?.projectId
          ? workspaceData.projects.find(project => project.id === workspaceClient.projectId)
          : undefined;

        if (workspaceClient && !isClientOperationallyActive(workspaceClient, workspaceProject)) {
          return [];
        }

        return [workspaceClient
          ? { ...c, clientName: workspaceClient.company || workspaceClient.name || c.clientName, client: workspaceClient }
          : { ...c, client: undefined }];
      });

      setClients(enrichedResult);
    } catch (err) {
      console.error('[usePerformanceDashboard] Erro ao carregar dashboard:', err);
      setError('Falha ao carregar métricas de performance.');
    } finally {
      setLoading(false);
    }
  }, [period, workspaceData.clients, workspaceData.projects]);

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
