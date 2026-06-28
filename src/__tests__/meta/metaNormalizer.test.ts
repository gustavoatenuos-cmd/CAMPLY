// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { normalizeMetaMetrics } from '../../lib/meta/metaNormalizer';

describe('metaNormalizer', () => {
  it('normalizes SALES from action_values', () => {
    const raw = [{
      spend: '100',
      action_values: [
        { action_type: 'purchase', value: '250.50' }
      ],
      actions: [
        { action_type: 'purchase', value: '3' }
      ]
    }];
    const res = normalizeMetaMetrics(raw, 'SALES', 'test-1');
    expect(res.spend).toBe(100);
    expect(res.purchases).toBe(3);
    expect(res.purchase_value).toBe(250.50);
    expect(res.purchase_roas).toBeCloseTo(2.505);
  });

  it('normalizes WHATSAPP and checks missing conversions', () => {
    const raw = [{
      spend: '50',
      actions: [
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' }
      ]
    }];
    const res = normalizeMetaMetrics(raw, 'WHATSAPP', 'test-2');
    expect(res.whatsapp_conversations_started).toBe(5);
    
  });
});
