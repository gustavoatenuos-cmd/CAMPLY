import type { GlobalMetricGroup } from './globalPerformanceDashboard';
import { aggregateMetricTotal, aggregateRatio, type MetricAggregate } from './aggregateMetrics';

/**
 * Objetivos comerciais "compráveis": cada um define seu próprio numerador de
 * gasto, para que CPA, CPL, custo por conversa e ROAS nunca dividam por um
 * resultado obtido com o dinheiro de campanhas de outro objetivo.
 */
export type CostObjective = 'SALES' | 'LEADS' | 'MESSAGING';

const MESSAGING_CLASSIFICATIONS = new Set(['WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER']);

function matchesCostObjective(classifiedObjective: string | null, objective: CostObjective): boolean {
  if (!classifiedObjective) return false;
  if (objective === 'MESSAGING') return MESSAGING_CLASSIFICATIONS.has(classifiedObjective);
  return classifiedObjective === objective;
}

/**
 * Campanhas cujo `classifiedObjective` bate exatamente com o objetivo pedido.
 * Campanhas `MIXED` ou `UNCLASSIFIED` ficam de fora dos três buckets —
 * não há como atribuir seu gasto a um único objetivo com segurança.
 */
export function groupsForCostObjective(
  groups: GlobalMetricGroup[] | null | undefined,
  objective: CostObjective
): GlobalMetricGroup[] {
  return (groups ?? []).filter((group) => matchesCostObjective(group.classifiedObjective, objective));
}

export interface ObjectiveScopedCosts {
  /** CPA compra = spend das campanhas SALES / compras dessas mesmas campanhas. */
  costPerPurchase: MetricAggregate;
  /** ROAS = valor de compra das campanhas SALES / spend dessas mesmas campanhas. */
  purchaseRoas: MetricAggregate;
  /** CPL = spend das campanhas LEADS / leads dessas mesmas campanhas. */
  costPerLead: MetricAggregate;
  /** Custo por conversa = spend das campanhas de mensageria / conversas dessas mesmas campanhas. */
  costPerMessagingConversation: MetricAggregate;
}

/**
 * CPA, CPL, custo por conversa e ROAS agregados a partir de `metricGroups`
 * (métricas por campanha, já segmentadas por objetivo pelo classificador da
 * Meta), nunca do gasto total da conta/cliente. Quando não há campanhas
 * suficientes de um objetivo no recorte, o agregado correspondente volta
 * `available: false` — o chamador deve exibir indisponível, não inventar
 * um número a partir de gasto de outro objetivo.
 */
export function calculateObjectiveScopedCosts(groups: GlobalMetricGroup[] | null | undefined): ObjectiveScopedCosts {
  const salesGroups = groupsForCostObjective(groups, 'SALES');
  const salesSpend = aggregateMetricTotal(salesGroups.map((group) => group.metrics.spend), { monetary: true });
  const purchases = aggregateMetricTotal(salesGroups.map((group) => group.metrics.purchases));
  const purchaseValue = aggregateMetricTotal(salesGroups.map((group) => group.metrics.purchase_value), { monetary: true });

  const leadsGroups = groupsForCostObjective(groups, 'LEADS');
  const leadsSpend = aggregateMetricTotal(leadsGroups.map((group) => group.metrics.spend), { monetary: true });
  const leads = aggregateMetricTotal(leadsGroups.map((group) => group.metrics.leads));

  const messagingGroups = groupsForCostObjective(groups, 'MESSAGING');
  const messagingSpend = aggregateMetricTotal(messagingGroups.map((group) => group.metrics.spend), { monetary: true });
  const conversations = aggregateMetricTotal(
    messagingGroups.map((group) => group.metrics.messaging_conversations_started_total)
  );

  return {
    costPerPurchase: aggregateRatio(salesSpend, purchases),
    purchaseRoas: aggregateRatio(purchaseValue, salesSpend),
    costPerLead: aggregateRatio(leadsSpend, leads),
    costPerMessagingConversation: aggregateRatio(messagingSpend, conversations),
  };
}

/** Agregado vazio para os quatro custos — mesmo formato de `calculateObjectiveScopedCosts([])`. */
export function emptyObjectiveScopedCosts(): ObjectiveScopedCosts {
  return calculateObjectiveScopedCosts([]);
}
