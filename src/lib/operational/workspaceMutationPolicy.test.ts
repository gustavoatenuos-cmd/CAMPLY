import { describe, expect, it } from 'vitest';
import { canMutateWorkspace, WORKSPACE_READ_ONLY_MESSAGE } from './workspaceMutationPolicy';

describe('workspace mutation policy', () => {
  it('allows mutations after the remote workspace was loaded', () => {
    expect(canMutateWorkspace(null)).toBe(true);
  });

  it('blocks mutations while the remote workspace is unavailable', () => {
    expect(canMutateWorkspace('database unavailable')).toBe(false);
    expect(WORKSPACE_READ_ONLY_MESSAGE).toContain('somente leitura');
  });
});
