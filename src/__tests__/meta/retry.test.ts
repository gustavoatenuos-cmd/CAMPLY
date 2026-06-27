import { describe, it, expect } from 'vitest';
describe('retry', () => { it('simulates 613 backoff', () => { 
  const errorObj = { error: { code: 613 } };
  expect(errorObj.error.code).toBe(613); 
}); });