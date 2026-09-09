import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, setSupabaseSession } from '../../lib/supabase';
import { isMetaE2EMode, restoreMetaE2EState, resetMetaE2EState, E2E_USER_ID, metaE2EWorkspace } from '../../lib/meta/metaE2ERuntime';
import { resetE2EAnalysisProfiles } from '../../lib/analysis/clientAnalysisProfile';

export function useAuth(onSessionChange: (session: Session | null, isNewUser: boolean) => void) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const sessionUserIdRef = useRef<string | null>(null);
  const authTransitionRef = useRef(false);

  useEffect(() => {
    if (isMetaE2EMode) {
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('e2eReset') === '1') {
        resetMetaE2EState();
        resetE2EAnalysisProfiles();
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        restoreMetaE2EState();
      }
      setSession(null);
      setSupabaseSession(null);
      setAuthReady(true);
      return;
    }

    if (!supabase) {
      setSupabaseSession(null);
      setAuthReady(true);
      return;
    }

    authTransitionRef.current = true;
    void supabase.auth.getSession().then(({ data }) => {
      setSupabaseSession(data.session);
      const userId = data.session?.user.id || null;
      sessionUserIdRef.current = userId;
      setSession(data.session);
      onSessionChange(data.session, true);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authTransitionRef.current = true;
      setSupabaseSession(nextSession);
      const nextUserId = nextSession?.user.id || null;
      const isNewUser = sessionUserIdRef.current !== nextUserId;
      if (isNewUser) {
        sessionUserIdRef.current = nextUserId;
      }
      setSession(nextSession);
      onSessionChange(nextSession, isNewUser);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setMockSession = () => {
    if (isMetaE2EMode) {
      sessionUserIdRef.current = E2E_USER_ID;
      const mockSession = { user: { id: E2E_USER_ID } } as Session;
      setSession(mockSession);
      onSessionChange(mockSession, true);
    }
  };

  const signOut = async () => {
    const userId = session?.user.id;
    setSupabaseSession(null);
    if (isMetaE2EMode) {
      resetMetaE2EState();
      resetE2EAnalysisProfiles();
      setSession(null);
      onSessionChange(null, true);
      return userId;
    }
    await supabase?.auth.signOut();
    return userId;
  };

  return {
    session,
    authReady,
    authenticated: Boolean(session),
    authTransitionRef,
    setMockSession,
    signOut
  };
}
