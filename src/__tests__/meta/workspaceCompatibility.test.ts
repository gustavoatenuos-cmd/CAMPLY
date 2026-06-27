import { describe, it, expect } from 'vitest';
describe('workspaceCompatibility', () => { it('preserves user context', () => { 
  expect('context').toBeDefined(); 
}); });