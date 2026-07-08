import type { GlobalMetricGroup } from './globalPerformanceDashboard';

export interface ObjectiveScopedMetrics {
  sales: {
    spend: number | null;
    purchases: number | null;
    purchaseValue: number | null;
    roas: number | null;
    costPerPurchase: number | null;
  };
  messaging: {
    spend: number | null;
    conversations: number | null;
    costPerConversation: number | null;
  };
  leads: {
    spend: number | null;
    leads: number | null;
    costPerLead: number | null;
  };
  awareness: {
    spend: number | null;
    reach: number | null;
    impressions: number | null;
    cpm: number | null;
    frequency: number | null;
  };
  traffic: {
    spend: number | null;
    linkClicks: number | null;
    linkCtr: number | null;
    cpc: number | null;
  };
  other: {
    spend: number | null;
  };
}

function sumMetric(groups: GlobalMetricGroup[], metricId: string): number | null {
  const validGroups = groups.filter(g => {
    if (metricId === 'spend') return typeof g.spend === 'number' && Number.isFinite(g.spend);
    const m = g.metrics[metricId];
    return m?.available && typeof m.value === 'number' && Number.isFinite(m.value);
  });

  if (validGroups.length === 0) return null;

  return validGroups.reduce((sum, g) => {
    if (metricId === 'spend') return sum + (g.spend as number);
    return sum + (g.metrics[metricId].value as number);
  }, 0);
}

function deriveCost(spend: number | null, results: number | null): number | null {
  if (spend === null || results === null || results <= 0) return null;
  return spend / results;
}

function deriveRoas(spend: number | null, value: number | null): number | null {
  if (spend === null || spend <= 0 || value === null) return null;
  return value / spend;
}

function deriveRatio(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * multiplier;
}

export function buildObjectiveScopedMetrics(groups: GlobalMetricGroup[]): ObjectiveScopedMetrics {
  const salesGroups = groups.filter(g => g.classifiedObjective === 'SALES');
  const messagingGroups = groups.filter(g => g.classifiedObjective === 'MESSAGING');
  const leadsGroups = groups.filter(g => g.classifiedObjective === 'LEADS');
  const awarenessGroups = groups.filter(g => g.classifiedObjective === 'AWARENESS' || g.classifiedObjective === 'REACH');
  const trafficGroups = groups.filter(g => g.classifiedObjective === 'TRAFFIC' || g.classifiedObjective === 'ENGAGEMENT');
  
  const knownObjectives = new Set(['SALES', 'MESSAGING', 'LEADS', 'AWARENESS', 'REACH', 'TRAFFIC', 'ENGAGEMENT']);
  const otherGroups = groups.filter(g => !g.classifiedObjective || !knownObjectives.has(g.classifiedObjective));

  // SALES
  const salesSpend = sumMetric(salesGroups, 'spend');
  const purchases = sumMetric(salesGroups, 'purchases');
  const purchaseValue = sumMetric(salesGroups, 'purchase_value');

  // MESSAGING
  const messagingSpend = sumMetric(messagingGroups, 'spend');
  const conversations = sumMetric(messagingGroups, 'messaging_conversations_started_total');

  // LEADS
  const leadsSpend = sumMetric(leadsGroups, 'spend');
  const leads = sumMetric(leadsGroups, 'leads');

  // AWARENESS
  const awarenessSpend = sumMetric(awarenessGroups, 'spend');
  const reach = sumMetric(awarenessGroups, 'reach');
  const impressions = sumMetric(awarenessGroups, 'impressions');

  // TRAFFIC
  const trafficSpend = sumMetric(trafficGroups, 'spend');
  const linkClicks = sumMetric(trafficGroups, 'link_clicks');
  const trafficImpressions = sumMetric(trafficGroups, 'impressions');

  return {
    sales: {
      spend: salesSpend,
      purchases,
      purchaseValue,
      roas: deriveRoas(salesSpend, purchaseValue),
      costPerPurchase: deriveCost(salesSpend, purchases),
    },
    messaging: {
      spend: messagingSpend,
      conversations,
      costPerConversation: deriveCost(messagingSpend, conversations),
    },
    leads: {
      spend: leadsSpend,
      leads,
      costPerLead: deriveCost(leadsSpend, leads),
    },
    awareness: {
      spend: awarenessSpend,
      reach,
      impressions,
      cpm: deriveRatio(awarenessSpend, impressions, 1000),
      frequency: deriveRatio(impressions, reach),
    },
    traffic: {
      spend: trafficSpend,
      linkClicks,
      linkCtr: deriveRatio(linkClicks, trafficImpressions, 100),
      cpc: deriveCost(trafficSpend, linkClicks),
    },
    other: {
      spend: sumMetric(otherGroups, 'spend'),
    }
  };
}
