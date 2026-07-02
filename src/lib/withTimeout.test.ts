import { describe, expect, it } from 'vitest';
import { OperationTimedOutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  it('returns the original operation result', async () => {
    await expect(withTimeout(Promise.resolve('saved'), 50, 'timeout')).resolves.toBe('saved');
  });

  it('stops an indefinitely pending UI read', async () => {
    const pending = new Promise<never>(() => undefined);
    await expect(withTimeout(pending, 5, 'Leitura demorou demais.')).rejects.toEqual(
      new OperationTimedOutError('Leitura demorou demais.')
    );
  });
});
