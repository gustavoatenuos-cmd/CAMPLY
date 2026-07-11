import React from 'react';
import { type EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';
import { deriveCostMetric } from '../../lib/performance/traceableMetrics';

interface ClientPrimaryMetricBlockProps {
  performance: EnrichedGlobalClientPerformance;
}

export function ClientPrimaryMetricBlock({ performance }: ClientPrimaryMetricBlockProps) {
  // performance.client é o registro local do workspace (sem perfil analítico);
  // o perfil comercial de fato vem do nível superior, populado a partir de
  // client_analysis_profiles em globalPerformanceDashboard.ts.
  const profile = performance.analysisProfile;
  const metrics = performance.metrics;

  if (!profile?.primaryConversionMetric) {
    return (
      <div className="flex items-center text-sm text-gray-500 italic py-2">
        Meta principal não configurada
      </div>
    );
  }

  const primary = profile.primaryConversionMetric;

  // Helpers to safely render traceable metrics
  const formatValue = (value: number | undefined | null, type: 'currency' | 'number' | 'percent' | 'multiplier' = 'number') => {
    if (value === undefined || value === null) return '-';
    
    if (type === 'currency') {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    }
    if (type === 'percent') {
      return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 }).format(value / 100);
    }
    if (type === 'multiplier') {
      return `${value.toFixed(2)}x`;
    }
    return new Intl.NumberFormat('pt-BR').format(value);
  };

  const renderSales = () => {
    const purchases = metrics?.purchases?.value ?? 0;
    const cpa = deriveCostMetric('cost_per_purchase', metrics?.spend, metrics?.purchases);
    const roas = metrics?.purchase_roas?.value ?? 0;

    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-gray-600 mb-1">
          <span className="font-medium">Meta configurada:</span>
          <span>Compras / CPA / ROAS</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Compras</span>
            <span className="font-semibold">{formatValue(purchases)}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">CPA</span>
            <span className="font-semibold">{formatValue(cpa?.value, 'currency')}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">ROAS</span>
            <span className="font-semibold">{formatValue(roas, 'multiplier')}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderLeads = () => {
    const leads = metrics?.leads?.value ?? 0;
    const cpl = deriveCostMetric('cost_per_lead', metrics?.spend, metrics?.leads);

    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-gray-600 mb-1">
          <span className="font-medium">Meta configurada:</span>
          <span>Leads</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Leads reais</span>
            <span className="font-semibold">{formatValue(leads)}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Custo / Lead</span>
            <span className="font-semibold">{formatValue(cpl?.value, 'currency')}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderConversations = () => {
    const convs = metrics?.messaging_conversations_started_total?.value ?? 0;
    const cpc = deriveCostMetric('cost_per_messaging_conversation_started', metrics?.spend, metrics?.messaging_conversations_started_total);

    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-gray-600 mb-1">
          <span className="font-medium">Meta configurada:</span>
          <span>Conversas</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Conversas</span>
            <span className="font-semibold">{formatValue(convs)}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Custo / Conv.</span>
            <span className="font-semibold">{formatValue(cpc?.value, 'currency')}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderAwareness = () => {
    const reach = metrics?.reach?.value ?? 0;
    const cpm = metrics?.cpm?.value ?? 0;
    const frequency = metrics?.frequency?.value ?? 0;

    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-gray-600 mb-1">
          <span className="font-medium">Meta configurada:</span>
          <span>Alcance</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Alcance</span>
            <span className="font-semibold">{formatValue(reach)}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">CPM</span>
            <span className="font-semibold">{formatValue(cpm, 'currency')}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Freq.</span>
            <span className="font-semibold">{formatValue(frequency, 'multiplier')}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderTraffic = () => {
    const clicks = metrics?.link_clicks?.value ?? 0;
    const ctr = metrics?.link_ctr?.value ?? 0;
    const cpc = deriveCostMetric('cpc', metrics?.spend, metrics?.link_clicks);

    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center text-gray-600 mb-1">
          <span className="font-medium">Meta configurada:</span>
          <span>Tráfego</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">Cliques (Link)</span>
            <span className="font-semibold">{formatValue(clicks)}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">CPC</span>
            <span className="font-semibold">{formatValue(cpc?.value, 'currency')}</span>
          </div>
          <div className="bg-gray-50 p-2 rounded flex flex-col">
            <span className="text-xs text-gray-500">CTR (Link)</span>
            <span className="font-semibold">{formatValue(ctr, 'percent')}</span>
          </div>
        </div>
      </div>
    );
  };

  if (['purchases', 'compra_site', 'compra_checkout', 'pedido_realizado'].includes(primary)) {
    return renderSales();
  }
  if (['messaging_conversations_started_total', 'conversa_iniciada', 'whatsapp', 'mensagem_direct'].includes(primary)) {
    return renderConversations();
  }
  if (['leads', 'lead_gerado', 'agendamento_realizado', 'orcamento_solicitado', 'cadastro_preenchido', 'ligacao_recebida', 'rota_solicitada'].includes(primary)) {
    return renderLeads();
  }
  if (['reach', 'alcance'].includes(primary)) {
    return renderAwareness();
  }
  if (['traffic', 'cliques', 'visitas_site'].includes(primary)) {
    return renderTraffic();
  }

  // Fallback for unrecognized primary metrics
  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between items-center text-gray-600 mb-1">
        <span className="font-medium">Meta configurada:</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
          {primary}
        </span>
      </div>
    </div>
  );
}
