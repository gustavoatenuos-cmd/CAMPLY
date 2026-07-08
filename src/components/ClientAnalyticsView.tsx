import React from 'react';
import { usePerformanceDashboard } from '../lib/performance/usePerformanceDashboard';
import { ClientAnalyticsBoard } from './analytics/ClientAnalyticsBoard';

interface ClientAnalyticsViewProps {
  data: any; // We can use CamplyData here but let's just use any to avoid import cycles if not needed, or import CamplyData. Let's import CamplyData.
}

export function ClientAnalyticsView({ data, updateData }: { data: any; updateData?: any }) {
  const { clients, period, loading, error } = usePerformanceDashboard(data);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-500 bg-red-50 p-8">
        <h2 className="text-xl font-bold mb-2">Erro ao carregar Analytics</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <ClientAnalyticsBoard 
        clients={clients} 
        period={period} 
        loading={loading} 
      />
    </div>
  );
}
