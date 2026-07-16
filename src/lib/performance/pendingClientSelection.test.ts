/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readPendingClientSelection, setPendingClientSelection } from './pendingClientSelection';

describe('pendingClientSelection', () => {
  afterEach(() => window.sessionStorage.clear());

  it('returns null when nothing was set', () => {
    expect(readPendingClientSelection()).toBeNull();
  });

  it('returns the last client id that was set', () => {
    setPendingClientSelection('client-1');
    expect(readPendingClientSelection()).toBe('client-1');
    setPendingClientSelection('client-2');
    expect(readPendingClientSelection()).toBe('client-2');
  });
});
