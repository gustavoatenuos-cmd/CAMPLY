import { describe, it, expect } from 'vitest';
import { generatePerformanceAlerts } from '../../lib/meta/performanceAnalysisEngine';
describe('performanceAnalysisEngine', () => { it('warns on no spend', () => { 
  const alerts = generatePerformanceAlerts('SALES', { spend: 0, impressions: 0 });
  expect(alerts[0].severity).toBe('warning');
}); });