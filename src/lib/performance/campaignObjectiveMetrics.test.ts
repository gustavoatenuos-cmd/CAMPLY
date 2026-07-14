import { describe, it, expect } from 'vitest';
import { resolveObjectiveMetricCells } from './campaignObjectiveMetrics';

function metricIds(objective: string | null): string[] {
  return resolveObjectiveMetricCells(objective).map((cell) => cell.metricId);
}

describe('resolveObjectiveMetricCells', () => {
  it('shows Gasto/Compras/CPA/ROAS for SALES', () => {
    expect(metricIds('SALES')).toEqual(['spend', 'purchases', 'cost_per_purchase', 'purchase_roas']);
  });

  it('shows Gasto/Leads/CPL for LEADS', () => {
    expect(metricIds('LEADS')).toEqual(['spend', 'leads', 'cost_per_lead']);
  });

  it('shows Gasto/Conversas/Custo-por-conversa for every messaging destination', () => {
    const expected = ['spend', 'messaging_conversations_started_total', 'cost_per_messaging_conversation'];
    expect(metricIds('WHATSAPP')).toEqual(expected);
    expect(metricIds('MESSENGER')).toEqual(expected);
    expect(metricIds('INSTAGRAM_DIRECT')).toEqual(expected);
    expect(metricIds('MESSAGING_OTHER')).toEqual(expected);
  });

  it('shows Gasto/Cliques/CPC/CTR for TRAFFIC', () => {
    expect(metricIds('TRAFFIC')).toEqual(['spend', 'clicks', 'link_cpc', 'link_ctr']);
  });

  it('shows engagement metrics for ENGAGEMENT and never sales metrics', () => {
    const ids = metricIds('ENGAGEMENT');
    expect(ids).toEqual(['spend', 'impressions', 'reach', 'cpm']);
    expect(ids).not.toContain('purchases');
    expect(ids).not.toContain('cost_per_purchase');
    expect(ids).not.toContain('purchase_roas');
  });

  it('shows Gasto/Alcance/Impressões/CPM for AWARENESS', () => {
    expect(metricIds('AWARENESS')).toEqual(['spend', 'reach', 'impressions', 'cpm']);
  });

  it('falls back to a generic spend/impressions/reach/clicks set for unmapped objectives', () => {
    const fallback = ['spend', 'impressions', 'reach', 'clicks'];
    expect(metricIds('PROFILE_VISITS')).toEqual(fallback);
    expect(metricIds('VIDEO')).toEqual(fallback);
    expect(metricIds('APP')).toEqual(fallback);
    expect(metricIds('OTHER')).toEqual(fallback);
    expect(metricIds('UNCLASSIFIED')).toEqual(fallback);
    expect(metricIds(null)).toEqual(fallback);
    expect(metricIds('SOMETHING_UNKNOWN')).toEqual(fallback);
  });
});
