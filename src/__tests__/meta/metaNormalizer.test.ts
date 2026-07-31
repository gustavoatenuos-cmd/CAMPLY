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
    expect(res.spend?.value).toBe(100);
    expect(res.purchases?.value).toBe(3);
    expect(res.purchase_value?.value).toBe(250.50);
    expect(res.purchase_roas?.value).toBeCloseTo(2.505);
  });

  it('normalizes WHATSAPP and checks missing conversions', () => {
    const raw = [{
      spend: '50',
      actions: [
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' }
      ]
    }];
    const res = normalizeMetaMetrics(raw, 'WHATSAPP', 'test-2');
    expect(res.whatsapp_conversations_started?.value).toBe(5);
  });
    
  it('returns unmapped_action_type for unrecognized actions', () => {
    const raw = [{
      spend: '50',
      actions: [
        { action_type: 'some_unknown_action', value: '1' }
      ]
    }];
    const res = normalizeMetaMetrics(raw, 'LEADS', 'test-3');
    expect(res.leads?.completenessStatus).toBe('unmapped_action_type');
  });
  
  it('deduplicates standard events prioritizing custom action types', () => {
    const raw = [{
      spend: '100',
      actions: [
        { action_type: 'offsite_conversion.custom.1234', value: '10' },
        { action_type: 'lead', value: '5' } 
      ]
    }];
    const res = normalizeMetaMetrics(raw, 'LEADS', 'test-4');
    expect(res.leads?.value).toBe(5);
  });
});
