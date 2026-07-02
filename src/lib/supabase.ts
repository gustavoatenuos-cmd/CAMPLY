import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

let activeAccessToken: string | null = null;
let activeUserId: string | null = null;

export function setSupabaseSession(session: Session | null): void {
  activeAccessToken = session?.access_token || null;
  activeUserId = session?.user.id || null;
}

export function getSupabaseSessionUserId(): string | null {
  return activeUserId;
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabasePublishableKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

// Database and Edge Function requests must not wait on auth.getSession().
// The auth client above owns refresh/persistence and keeps this in-memory token
// current through App's onAuthStateChange listener.
export const supabaseData = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabasePublishableKey as string, {
      accessToken: async () => activeAccessToken,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
