import { describe, it, expect } from 'vitest';
import { normalizeMetaMetrics } from '../../lib/meta/metaNormalizer';
describe('metaNormalizer', () => { it('normalizes sales from actions', () => { 
  const res = normalizeMetaMetrics([{ actions: [{action_type: 'purchase', value: '2'}] }], 'SALES', 'c1');
  expect(res.purchases).toBe(2); 
}); });