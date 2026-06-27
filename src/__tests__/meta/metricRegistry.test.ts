import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY } from '../../lib/meta/metricRegistry';

describe('Metric Registry', () => {
  it('should have basic metrics registered', () => {
    expect(METRIC_REGISTRY.spend).toBeDefined();
    expect(METRIC_REGISTRY.impressions).toBeDefined();
    expect(METRIC_REGISTRY.purchases).toBeDefined();
    expect(METRIC_REGISTRY.whatsapp_conversations_started).toBeDefined();
  });

  it('should format whatsapp metric correctly', () => {
    const wa = METRIC_REGISTRY.whatsapp_conversations_started;
    expect(wa.compatibleObjectives).toContain('WHATSAPP');
    expect(wa.source).toBe('actions');
    expect(wa.acceptedActionTypes).toContain('onsite_conversion.messaging_conversation_started_7d');
  });

  it('should correctly define deduplication rules', () => {
    const purchases = METRIC_REGISTRY.purchases;
    expect(purchases.deduplicationRule).toBe('priority_alias');
  });
});
