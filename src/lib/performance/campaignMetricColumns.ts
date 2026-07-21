import { deriveCostMetric, type TraceableMetric } from './traceableMetrics';
import type { MetricContract } from './globalPerformanceDashboard';

export type CampaignMetricFormat = 'currency' | 'number' | 'percent' | 'ratio';

export interface CampaignMetricColumn {
  label: string;
  metric: MetricContract | undefined;
  format: CampaignMetricFormat;
}

const MESSAGING_OBJECTIVES = new Set([
  'WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'MESSAGING_OTHER', 'MESSAGING',
]);

// Includes both campaign-level raw objectives (OUTCOME_*) and ad set-level
// optimization goals, since get_meta_performance_hierarchy does not resolve a
// classifiedObjective for adset/ad rows — those nodes only carry the raw
// optimization_goal string in `objective`.
const SALES_RAW_OBJECTIVES = new Set(['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES', 'OFFSITE_CONVERSIONS']);
const LEADS_RAW_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION']);
const MESSAGING_RAW_OBJECTIVES = new Set(['MESSAGES', 'CONVERSATIONS']);
const TRAFFIC_RAW_OBJECTIVES = new Set(['OUTCOME_TRAFFIC', 'LINK_CLICKS']);
const AWARENESS_RAW_OBJECTIVES = new Set(['OUTCOME_AWARENESS', 'BRAND_AWARENESS', 'REACH']);
const ENGAGEMENT_RAW_OBJECTIVES = new Set(['OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'EVENT_RESPONSES']);

function messagingConversationMetric(
  metrics: Record<string, MetricContract>,
  classifiedObjective: string | null
): TraceableMetric | undefined {
  if (classifiedObjective === 'WHATSAPP') return metrics.whatsapp_conversations_started;
  if (classifiedObjective === 'MESSENGER') return metrics.messenger_conversations_started;
  if (classifiedObjective === 'INSTAGRAM_DIRECT') return metrics.instagram_direct_conversations_started;
  return metrics.messaging_conversations_started_total || metrics.messaging_conversations_started_generic;
}

/**
 * Maps a campaign's classifiedObjective (falling back to Meta's raw objective)
 * to the metric columns that are actually meaningful for it. Purchases/CPA/ROAS
 * only make sense for SALES campaigns — showing them for ENGAGEMENT, AWARENESS,
 * TRAFFIC, etc. reads as a data bug (empty or misleading cells) rather than "this
 * objective doesn't track purchases".
 */
export function resolveCampaignMetricColumns(
  classifiedObjective: string | null | undefined,
  rawObjective: string | null | undefined,
  metrics: Record<string, MetricContract>
): CampaignMetricColumn[] {
  const objective = classifiedObjective || '';
  const raw = rawObjective || '';
  const spend = metrics.spend;

  if (objective === 'SALES' || SALES_RAW_OBJECTIVES.has(raw)) {
    const purchases = metrics.purchases;
    return [
      { label: 'Compras', metric: purchases, format: 'number' },
      { label: 'CPA', metric: deriveCostMetric('cost_per_purchase', spend, purchases), format: 'currency' },
      { label: 'ROAS', metric: metrics.purchase_roas, format: 'ratio' },
    ];
  }

  if (MESSAGING_OBJECTIVES.has(objective) || MESSAGING_RAW_OBJECTIVES.has(raw)) {
    const conversations = messagingConversationMetric(metrics, objective);
    return [
      { label: 'Conversas', metric: conversations, format: 'number' },
      { label: 'Custo / Conversa', metric: deriveCostMetric('cost_per_messaging_conversation', spend, conversations), format: 'currency' },
    ];
  }

  if (objective === 'LEADS' || LEADS_RAW_OBJECTIVES.has(raw)) {
    const leads = metrics.leads;
    return [
      { label: 'Leads', metric: leads, format: 'number' },
      { label: 'CPL', metric: deriveCostMetric('cost_per_lead', spend, leads), format: 'currency' },
    ];
  }

  if (objective === 'TRAFFIC' || TRAFFIC_RAW_OBJECTIVES.has(raw)) {
    const clicks = metrics.link_clicks || metrics.clicks;
    return [
      { label: 'Cliques', metric: clicks, format: 'number' },
      { label: 'CPC', metric: metrics.link_cpc || deriveCostMetric('cpc', spend, clicks), format: 'currency' },
      { label: 'CTR', metric: metrics.link_ctr, format: 'percent' },
    ];
  }

  if (objective === 'ENGAGEMENT' || ENGAGEMENT_RAW_OBJECTIVES.has(raw)) {
    return [
      { label: 'Impressões', metric: metrics.impressions, format: 'number' },
      { label: 'Alcance', metric: metrics.reach, format: 'number' },
      { label: 'CPM', metric: metrics.cpm, format: 'currency' },
    ];
  }

  if (objective === 'AWARENESS' || AWARENESS_RAW_OBJECTIVES.has(raw)) {
    return [
      { label: 'Alcance', metric: metrics.reach, format: 'number' },
      { label: 'Impressões', metric: metrics.impressions, format: 'number' },
      { label: 'CPM', metric: metrics.cpm, format: 'currency' },
    ];
  }

  // VIDEO/APP/PROFILE_VISITS/MIXED/UNCLASSIFIED/unknown: fall back to reach
  // metrics that are always tracked. Never default to purchase-based columns —
  // that misrepresents campaigns that were never optimized for sales.
  return [
    { label: 'Impressões', metric: metrics.impressions, format: 'number' },
    { label: 'Cliques', metric: metrics.link_clicks || metrics.clicks, format: 'number' },
  ];
}
