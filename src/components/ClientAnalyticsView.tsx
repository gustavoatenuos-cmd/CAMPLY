import React from 'react';
import { usePerformanceDashboard } from '../lib/performance/usePerformanceDashboard';
import { readPendingAnalyticsPeriod, setPendingClientSelection } from '../lib/performance/pendingClientSelection';
import { ClientAnalyticsBoard } from './analytics/ClientAnalyticsBoard';
import type { CamplyData, ViewId } from '../types';

interface ClientAnalyticsViewProps {
  data: CamplyData;
  updateData?: (updater: (data: CamplyData) => CamplyData) => void;
  setActiveView?: (view: ViewId) => void;
}

export function ClientAnalyticsView({ data, updateData, setActiveView }: ClientAnalyticsViewProps) {
  // Herda o período que o usuário tinha selecionado no Dashboard ao clicar em
  // "Ver análise" (ver setPendingAnalyticsPeriod em OverviewView) - sem isso,
  // esta tela sempre abriria no período padrão do hook, diferente do que o
  // usuário estava olhando.
  const { clients, period, loading, error } = usePerformanceDashboard(data, readPendingAnalyticsPeriod() ?? undefined);

  const handleEditClient = setActiveView
    ? (clientId: string) => {
        setPendingClientSelection(clientId);
        setActiveView('clients');
      }
    : undefined;

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
        onEditClient={handleEditClient}
      />
    </div>
  );
}
