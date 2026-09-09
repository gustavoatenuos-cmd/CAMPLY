import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import type { PerformanceEvaluation, PerformanceStatus } from '../../lib/performance/types';
import { PerformanceStatusBadge } from './PerformanceStatusBadge';
import { metricLabels } from '../../lib/analysis/clientAnalysisProfile';

function metricLabel(metricId: string): string {
  const labels: Record<string, string> = {
    whatsapp_conversations_started: 'conversas no WhatsApp',
    messaging_conversations_started_total: 'conversas',
    messenger_conversations_started: 'conversas no Messenger',
    instagram_direct_conversations_started: 'conversas no Instagram',
    leads: 'leads',
    purchases: 'compras',
    cost_per_messaging_conversation: 'custo por conversa',
    cost_per_lead: 'custo por lead',
    cost_per_purchase: 'custo por compra',
    cpm: 'CPM',
    link_ctr: 'CTR de link',
    frequency: 'frequência',
    purchase_roas: 'ROAS',
    landing_page_views: 'visitas à página',
  };
  return metricLabels[metricId] || labels[metricId] || metricId.split('_').join(' ');
}

function formatCurrency(value: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  }
}

function formatMetricValue(metricId: string, value: number | null, currency = 'BRL'): string {
  if (value === null) return 'sem valor confiável';
  if (
    metricId === 'spend'
    || metricId === 'cpm'
    || metricId.startsWith('cost_per_')
    || metricId === 'link_cpc'
    || metricId === 'cpa'
    || metricId === 'purchase_value'
  ) {
    return formatCurrency(value, currency);
  }
  if (metricId.includes('ctr')) {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function expectationText(evaluation: PerformanceEvaluation, currency: string): string {
  if (evaluation.targetKind === 'target_range' && evaluation.targetMin != null && evaluation.targetMax != null) {
    return `entre ${formatMetricValue(evaluation.metricId, evaluation.targetMin, currency)} e ${formatMetricValue(evaluation.metricId, evaluation.targetMax, currency)}`;
  }
  if (['maximum_metric', 'cost_per_result'].includes(evaluation.targetKind)) {
    return `até ${formatMetricValue(evaluation.metricId, evaluation.targetValue, currency)}`;
  }
  if (['minimum_metric', 'minimum_results'].includes(evaluation.targetKind)) {
    return `mínimo ${formatMetricValue(evaluation.metricId, evaluation.targetValue, currency)}`;
  }
  return formatMetricValue(evaluation.metricId, evaluation.targetValue, currency);
}

function statusEvidence(evaluation: PerformanceEvaluation): string {
  if (evaluation.status === 'partial_data') return 'A leitura ainda está parcial; sincronize de novo antes de decidir.';
  if (evaluation.actualValue === null) return 'Ainda não há valor confiável para esta métrica.';
  if (evaluation.differencePercent === null) return 'Meta e realizado foram comparados, mas sem diferença percentual confiável.';
  const abs = Math.abs(evaluation.differencePercent).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (evaluation.status === 'critical') return `Desvio crítico de ${abs}% em relação ao esperado.`;
  if (evaluation.status === 'attention') return `Desvio de atenção de ${abs}% em relação ao esperado.`;
  return 'Dentro da expectativa configurada.';
}

function evaluationDescription(client: GlobalClientPerformance, evaluation: PerformanceEvaluation): string {
  const account = client.accounts.find((item) => item.clientMetaAssetId === evaluation.clientMetaAssetId);
  const scope = evaluation.campaignId ? 'Campanha' : 'Conta';
  const currencyCode = account?.currency || 'BRL';
  const actual = formatMetricValue(evaluation.metricId, evaluation.actualValue, currencyCode);
  const target = expectationText(evaluation, currencyCode);
  return `${scope}: ${metricLabel(evaluation.metricId)} realizado em ${actual}; esperado ${target}. ${statusEvidence(evaluation)}`;
}

function recommendationFor(evaluation: PerformanceEvaluation): string {
  if (evaluation.status === 'partial_data') return 'Conclua uma sincronização completa antes de otimizar.';
  if (evaluation.metricId === 'link_ctr') return 'Revise criativo, oferta e aderência da mensagem ao público.';
  if (evaluation.metricId === 'cpm') return 'Revise público, posicionamentos e pressão do leilão.';
  if (evaluation.metricId === 'frequency') return 'Renove criativos ou amplie o público para controlar a frequência.';
  if (evaluation.metricId.startsWith('cost_per_')) return 'Abra campanhas e conjuntos com maior consumo e revise criativo, público e conversão.';
  if (evaluation.metricId === 'purchase_roas') return 'Revise valor de compra, custo de aquisição e campanhas que concentram o investimento.';
  return 'Abra a conta e identifique a campanha responsável pelo maior desvio antes de alterar orçamento.';
}

export function PriorityDeviations({
  priorities,
}: {
  priorities: Array<{ client: GlobalClientPerformance; evaluation: PerformanceEvaluation }>;
}) {
  return (
    <article className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Desvios de metas</p>
          <h2 className="mt-1 text-xl font-black text-white">Comparações que sustentam as decisões</h2>
        </div>
        <AlertTriangle className="text-brand-green drop-shadow-[0_0_8px_rgba(0,229,153,0.8)]" size={22} />
      </div>
      <div className="mt-4 space-y-3">
        {priorities.length > 0 ? priorities.map(({ client, evaluation }, index) => (
          <motion.div 
            whileHover={{ scale: 1.01 }}
            key={`${client.clientId}:${evaluation.clientMetaAssetId}:${evaluation.campaignId || 'account'}:${evaluation.metricId}:${index}`} 
            className="rounded-xl border border-white/[0.03] bg-brand-surface2/40 p-4 transition-colors hover:border-brand-green/20"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-bold text-white">{index + 1}. {client.clientName}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-brand-green">{client.analysisProfile?.customVertical || client.analysisProfile?.vertical || 'Segmento não configurado'} · {metricLabel(evaluation.metricId)}</p>
                <p className="mt-1 text-sm text-brand-muted">{evaluationDescription(client, evaluation)}</p>
                <p className="mt-2 text-xs text-brand-soft">
                  Confiança: {evaluation.confidence.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% · Investigar {evaluation.campaignId ? 'a campanha e seus conjuntos' : 'a conta e as campanhas responsáveis'}.
                </p>
                <p className="mt-2 text-sm font-semibold text-white">Ação recomendada: <span className="text-brand-green drop-shadow-[0_0_4px_rgba(0,229,153,0.3)]">{recommendationFor(evaluation)}</span></p>
              </div>
              <PerformanceStatusBadge status={evaluation.status} />
            </div>
          </motion.div>
        )) : (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-brand-muted">
            Nenhuma prioridade conclusiva para o período. Clientes sem dados continuam visíveis na tabela.
          </div>
        )}
      </div>
    </article>
  );
}
