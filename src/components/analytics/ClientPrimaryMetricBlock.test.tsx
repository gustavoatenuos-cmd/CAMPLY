import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientPrimaryMetricBlock } from './ClientPrimaryMetricBlock';
import type { EnrichedGlobalClientPerformance } from '../../lib/performance/usePerformanceDashboard';

function unavailableMetric(metricId: string) {
  return {
    metricId,
    value: null,
    available: false,
    currency: null,
    dateStart: null,
    dateStop: null,
    timezone: null,
    sourceLevel: 'aggregated',
    attributionSetting: null,
    classifiedObjective: null,
    destinationType: null,
    syncRunId: null,
    completenessStatus: 'unavailable',
    collectedAt: null,
    clientMetaAssetId: null,
    accountId: null,
    accountName: null,
    campaignId: null,
    adsetId: null,
    adId: null,
  };
}

function availableMetric(metricId: string, value: number) {
  return { ...unavailableMetric(metricId), value, available: true, completenessStatus: 'complete', currency: 'BRL' };
}

describe('ClientPrimaryMetricBlock', () => {
  it('reads the primary conversion metric from performance.analysisProfile, not from performance.client', () => {
    const performance = {
      clientId: 'c1',
      metrics: {
        spend: availableMetric('spend', 500),
        purchases: availableMetric('purchases', 5),
        purchase_roas: availableMetric('purchase_roas', 3),
      },
      metricGroups: [],
      analysisProfile: {
        primaryConversionMetric: 'purchases',
      },
      // Registro local do workspace: propositalmente SEM analysisProfile.
      client: { id: 'c1', name: 'Cliente do Workspace' },
    } as unknown as EnrichedGlobalClientPerformance;

    render(<ClientPrimaryMetricBlock performance={performance} />);

    expect(screen.queryByText('Meta principal não configurada')).not.toBeInTheDocument();
    expect(screen.getByText('Compras')).toBeInTheDocument();
    expect(screen.getByText('CPA')).toBeInTheDocument();
    expect(screen.getByText('ROAS')).toBeInTheDocument();
  });

  it('shows the unconfigured fallback when there is no analysis profile at all', () => {
    const performance = {
      clientId: 'c2',
      metrics: {},
      metricGroups: [],
      analysisProfile: null,
      client: { id: 'c2', name: 'Cliente Sem Perfil' },
    } as unknown as EnrichedGlobalClientPerformance;

    render(<ClientPrimaryMetricBlock performance={performance} />);

    expect(screen.getByText('Meta principal não configurada')).toBeInTheDocument();
  });
});
