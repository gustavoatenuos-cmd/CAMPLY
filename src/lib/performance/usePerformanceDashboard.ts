import { useState, useEffect, useCallback } from 'react';
import { loadGlobalPerformanceDashboard, type GlobalClientPerformance } from './globalPerformanceDashboard';
import { loadAnalyticsCapabilities, type DashboardPeriod } from './analyticsCapabilities';
import type { CamplyData } from '../../types';

export interface UsePerformanceDashboardResult {
  clients: GlobalClientPerformance[];
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
  const [clients, setClients] = useState<GlobalClientPerformance[]>([]);

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

      const enrichedResult = result.map(c => {
        const workspaceClient = workspaceData.clients.find(w => w.id === c.clientId);
        return workspaceClient 
          ? { ...c, clientName: workspaceClient.company || workspaceClient.name || c.clientName }
          : c;
      });

      setClients(enrichedResult);
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
