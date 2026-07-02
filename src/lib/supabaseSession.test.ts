import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseSessionUserId, setSupabaseSession } from './supabase';

describe('Supabase in-memory session transport', () => {
  afterEach(() => setSupabaseSession(null));

  it('keeps the current authenticated user available without calling getSession again', () => {
    setSupabaseSession({
      access_token: 'access-token',
      user: { id: 'user-1' },
    } as Session);

    expect(getSupabaseSessionUserId()).toBe('user-1');
    setSupabaseSession(null);
    expect(getSupabaseSessionUserId()).toBeNull();
  });
});
