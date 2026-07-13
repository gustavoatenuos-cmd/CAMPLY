export type ObjectiveMetricFormat = 'currency' | 'number' | 'percent';

export interface ObjectiveMetricCell {
  metricId: string;
  label: string;
  format: ObjectiveMetricFormat;
}

const spend: ObjectiveMetricCell = { metricId: 'spend', label: 'Gasto', format: 'currency' };
const impressions: ObjectiveMetricCell = { metricId: 'impressions', label: 'Impressões', format: 'number' };
const reach: ObjectiveMetricCell = { metricId: 'reach', label: 'Alcance', format: 'number' };
const clicks: ObjectiveMetricCell = { metricId: 'clicks', label: 'Cliques', format: 'number' };
const cpm: ObjectiveMetricCell = { metricId: 'cpm', label: 'CPM', format: 'currency' };
const linkCpc: ObjectiveMetricCell = { metricId: 'link_cpc', label: 'CPC', format: 'currency' };
const linkCtr: ObjectiveMetricCell = { metricId: 'link_ctr', label: 'CTR', format: 'percent' };
const leads: ObjectiveMetricCell = { metricId: 'leads', label: 'Leads', format: 'number' };
const costPerLead: ObjectiveMetricCell = { metricId: 'cost_per_lead', label: 'CPL', format: 'currency' };
const purchases: ObjectiveMetricCell = { metricId: 'purchases', label: 'Compras', format: 'number' };
const costPerPurchase: ObjectiveMetricCell = { metricId: 'cost_per_purchase', label: 'CPA', format: 'currency' };
const purchaseRoas: ObjectiveMetricCell = { metricId: 'purchase_roas', label: 'ROAS', format: 'number' };
const conversations: ObjectiveMetricCell = {
  metricId: 'messaging_conversations_started_total',
  label: 'Conversas',
  format: 'number',
};
const costPerConversation: ObjectiveMetricCell = {
  metricId: 'cost_per_messaging_conversation',
  label: 'Custo/conversa',
  format: 'currency',
};

const GENERIC_FALLBACK_CELLS: ObjectiveMetricCell[] = [spend, impressions, reach, clicks];

const MESSAGING_CELLS: ObjectiveMetricCell[] = [spend, conversations, costPerConversation];

export const OBJECTIVE_METRIC_CELLS: Record<string, ObjectiveMetricCell[]> = {
  SALES: [spend, purchases, costPerPurchase, purchaseRoas],
  LEADS: [spend, leads, costPerLead],
  WHATSAPP: MESSAGING_CELLS,
  MESSENGER: MESSAGING_CELLS,
  INSTAGRAM_DIRECT: MESSAGING_CELLS,
  MESSAGING_OTHER: MESSAGING_CELLS,
  TRAFFIC: [spend, clicks, linkCpc, linkCtr],
  // Engagement/awareness campaigns are never scored on sales-style conversion metrics.
  ENGAGEMENT: [spend, impressions, reach, cpm],
  AWARENESS: [spend, reach, impressions, cpm],
  PROFILE_VISITS: GENERIC_FALLBACK_CELLS,
  VIDEO: GENERIC_FALLBACK_CELLS,
  APP: GENERIC_FALLBACK_CELLS,
  OTHER: GENERIC_FALLBACK_CELLS,
  UNCLASSIFIED: GENERIC_FALLBACK_CELLS,
  MIXED: GENERIC_FALLBACK_CELLS,
};

export function resolveObjectiveMetricCells(classifiedObjective: string | null): ObjectiveMetricCell[] {
  if (!classifiedObjective) return GENERIC_FALLBACK_CELLS;
  return OBJECTIVE_METRIC_CELLS[classifiedObjective] || GENERIC_FALLBACK_CELLS;
}
