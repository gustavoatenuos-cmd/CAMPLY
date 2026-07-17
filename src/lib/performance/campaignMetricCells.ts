import { deriveCostMetric, deriveScopedMetric, type TraceableMetric } from './traceableMetrics';
import type { MetricContract } from './globalPerformanceDashboard';

export interface CampaignMetricCell {
  key: string;
  label: string;
  value: string;
  metric: MetricContract | undefined;
}

function metricValue(metric: TraceableMetric | undefined): number | null {
  return metric?.available && typeof metric.value === 'number' ? metric.value : null;
}

function formatCurrency(value: number | null, currencyCode: string | null): string {
  if (value === null) return '—';
  if (!currencyCode) return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(value);
  } catch {
    return `${currencyCode} ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  }
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function formatRoas(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}x`;
}

function cell(key: string, label: string, value: string, metric: TraceableMetric | undefined): CampaignMetricCell {
  return { key, label, value, metric };
}

function spendCell(metrics: Record<string, MetricContract>, currencyCode: string | null): CampaignMetricCell {
  return cell('spend', 'Gasto', formatCurrency(metricValue(metrics.spend), currencyCode), metrics.spend);
}

/**
 * Single source of truth for "which metric cells does this campaign's card/row
 * show" - keyed off the already-classified objective so ENGAGEMENT/AWARENESS
 * campaigns never render Compras/CPA/ROAS and SALES campaigns never render
 * engagement-only fields. Every consumer (drawer, hierarchical table, explorer)
 * must call this instead of re-deriving its own column list.
 */
export function getCampaignMetricCellsByObjective(
  classifiedObjective: string | null | undefined,
  metrics: Record<string, MetricContract>,
  currencyCode: string | null
): CampaignMetricCell[] {
  const spend = spendCell(metrics, currencyCode);

  switch (classifiedObjective) {
    case 'SALES': {
      const cpa = deriveCostMetric('cpa', metrics.spend, metrics.purchases);
      return [
        spend,
        cell('purchases', 'Compras', formatNumber(metricValue(metrics.purchases)), metrics.purchases),
        cell('cpa', 'CPA', formatCurrency(metricValue(cpa), currencyCode), cpa),
        cell('purchase_value', 'Valor de compra', formatCurrency(metricValue(metrics.purchase_value), currencyCode), metrics.purchase_value),
        cell('purchase_roas', 'ROAS', formatRoas(metricValue(metrics.purchase_roas)), metrics.purchase_roas),
      ];
    }

    case 'LEADS': {
      const cpl = deriveCostMetric('cost_per_lead', metrics.spend, metrics.leads);
      return [
        spend,
        cell('leads', 'Leads', formatNumber(metricValue(metrics.leads)), metrics.leads),
        cell('cost_per_lead', 'CPL', formatCurrency(metricValue(cpl), currencyCode), cpl),
      ];
    }

    case 'WHATSAPP':
    case 'MESSENGER':
    case 'INSTAGRAM_DIRECT':
    case 'MESSAGING_OTHER': {
      const conversations = metrics.messaging_conversations_started_total;
      const costPerConversation = metrics.cost_per_messaging_conversation?.available
        ? metrics.cost_per_messaging_conversation
        : deriveCostMetric('cost_per_messaging_conversation', metrics.spend, conversations);
      return [
        spend,
        cell('conversations', 'Conversas', formatNumber(metricValue(conversations)), conversations),
        cell('cost_per_conversation', 'Custo p/ Conversa', formatCurrency(metricValue(costPerConversation), currencyCode), costPerConversation),
      ];
    }

    case 'ENGAGEMENT': {
      const ctr = deriveScopedMetric('ctr', metrics.clicks, metrics.impressions, 100);
      const cpc = deriveCostMetric('cpc', metrics.spend, metrics.clicks);
      return [
        spend,
        cell('reach', 'Alcance', formatNumber(metricValue(metrics.reach)), metrics.reach),
        cell('impressions', 'Impressões', formatNumber(metricValue(metrics.impressions)), metrics.impressions),
        cell('clicks', 'Cliques', formatNumber(metricValue(metrics.clicks)), metrics.clicks),
        cell('ctr', 'CTR', formatPercent(metricValue(ctr)), ctr),
        cell('cpc', 'CPC', formatCurrency(metricValue(cpc), currencyCode), cpc),
      ];
    }

    case 'AWARENESS': {
      const cpm = metrics.cpm?.available ? metrics.cpm : deriveScopedMetric('cpm', metrics.spend, metrics.impressions, 1000);
      return [
        spend,
        cell('reach', 'Alcance', formatNumber(metricValue(metrics.reach)), metrics.reach),
        cell('impressions', 'Impressões', formatNumber(metricValue(metrics.impressions)), metrics.impressions),
        cell('cpm', 'CPM', formatCurrency(metricValue(cpm), currencyCode), cpm),
      ];
    }

    case 'VIDEO': {
      return [
        spend,
        cell('video_views', 'Visualizações', formatNumber(metricValue(metrics.video_views)), metrics.video_views),
        cell('thru_plays', 'ThruPlays', formatNumber(metricValue(metrics.thru_plays)), metrics.thru_plays),
      ];
    }

    case 'TRAFFIC': {
      const linkCtr = metrics.link_ctr?.available ? metrics.link_ctr : deriveScopedMetric('link_ctr', metrics.link_clicks, metrics.impressions, 100);
      const linkCpc = metrics.link_cpc?.available ? metrics.link_cpc : deriveCostMetric('link_cpc', metrics.spend, metrics.link_clicks);
      return [
        spend,
        cell('link_clicks', 'Cliques no link', formatNumber(metricValue(metrics.link_clicks)), metrics.link_clicks),
        cell('link_ctr', 'CTR', formatPercent(metricValue(linkCtr)), linkCtr),
        cell('link_cpc', 'CPC', formatCurrency(metricValue(linkCpc), currencyCode), linkCpc),
      ];
    }

    case 'PROFILE_VISITS': {
      const costPerVisit = deriveCostMetric('cost_per_profile_visit', metrics.spend, metrics.profile_visits);
      return [
        spend,
        cell('profile_visits', 'Visitas ao Perfil', formatNumber(metricValue(metrics.profile_visits)), metrics.profile_visits),
        cell('cost_per_profile_visit', 'Custo p/ Visita', formatCurrency(metricValue(costPerVisit), currencyCode), costPerVisit),
      ];
    }

    // 'APP', 'MIXED', 'UNCLASSIFIED', null, undefined and any unrecognized
    // value fall back to the objective-agnostic pair - never guess a
    // conversion metric that the classifier hasn't actually confirmed.
    default: {
      return [
        spend,
        cell('impressions', 'Impressões', formatNumber(metricValue(metrics.impressions)), metrics.impressions),
      ];
    }
  }
}
