import React from 'react';
import { usePerformanceDashboard } from '../lib/performance/usePerformanceDashboard';
import { readPendingAnalyticsPeriod, setPendingClientSelection } from '../lib/performance/pendingClientSelection';
import { ClientAnalyticsBoard } from './analytics/ClientAnalyticsBoard';
import type { ViewId } from '../types';

interface ClientAnalyticsViewProps {
  data: any; // We can use CamplyData here but let's just use any to avoid import cycles if not needed, or import CamplyData. Let's import CamplyData.
  setActiveView?: (view: ViewId) => void;
}

export function ClientAnalyticsView({ data, updateData, setActiveView }: { data: any; updateData?: any; setActiveView?: (view: ViewId) => void }) {
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
      <div className="flex h-full flex-col items-center justify-center bg-brand-ink p-8 text-rose-300">
        <h2 className="mb-2 text-lg font-semibold text-white">Erro ao carregar Analytics</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-brand-ink">
      <ClientAnalyticsBoard
        clients={clients}
        period={period}
        loading={loading}
        onEditClient={handleEditClient}
        onOpenMetaIntegration={setActiveView ? () => setActiveView('metaIntegration') : undefined}
      />
    </div>
  );
}
