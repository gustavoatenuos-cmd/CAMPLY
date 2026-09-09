import React, { useMemo, useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthGate } from './components/AuthGate';
import { AppShell } from './components/layout/AppShell';
import { buildInsights, initialData, loadData, clearUserData, setActivityActor } from './data/camplyStore';
import { CamplyData, ViewId } from './types';
import { isMetaE2EMode, metaE2EWorkspace, E2E_USER_ID } from './lib/meta/metaE2ERuntime';
import { useAuth } from './shared/hooks/useAuth';
import { useRemoteSync } from './shared/hooks/useRemoteSync';
import { useAgentEngine } from './shared/hooks/useAgentEngine';

function initialActiveView(): ViewId {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('meta_sync') || params.has('meta_error')) return 'metaIntegration';
  }
  return 'today';
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>(() => initialActiveView());
  const [data, setData] = useState<CamplyData>(() => isMetaE2EMode ? metaE2EWorkspace : initialData);

  const handleSessionChange = (nextSession: Session | null, isNewUser: boolean) => {
    if (nextSession) {
      if (isNewUser) {
        setData(loadData(nextSession.user.id));
      }
      const profileName = nextSession.user.user_metadata?.name;
      setActivityActor(
        typeof profileName === 'string' && profileName.trim()
          ? profileName
          : nextSession.user.email || null
      );
    } else {
      if (!isMetaE2EMode) setData(initialData);
    }
  };

  const {
    session,
    authReady,
    authenticated,
    authTransitionRef,
    setMockSession,
    signOut
  } = useAuth(handleSessionChange);

  // Fallback if E2E mode
  useEffect(() => {
    if (isMetaE2EMode) {
      setActivityActor('Usuário E2E');
    }
  }, []);

  const {
    remoteLoaded,
    remoteLoadError,
    syncError,
    syncErrorDismissed,
    setSyncErrorDismissed,
    persistClientData,
    retryRemoteLoad,
    resetSyncState
  } = useRemoteSync(authenticated, data, setData, authTransitionRef);

  const { updateData } = useAgentEngine(authenticated, remoteLoaded, setData);

  const insights = useMemo(() => buildInsights(data), [data]);

  const handleSignOut = async () => {
    const userId = await signOut();
    clearUserData(userId);
    resetSyncState();
    setData(initialData);
  };

  if (!authReady) {
    return <div className="grid min-h-screen place-items-center bg-brand-ink text-brand-soft">Validando sessão...</div>;
  }

  if (!authenticated) {
    return <AuthGate onMockLogin={isMetaE2EMode ? setMockSession : undefined} />;
  }

  return (
    <AppShell
      session={session}
      data={data}
      insights={insights}
      activeView={activeView}
      setActiveView={setActiveView}
      updateData={updateData}
      persistClientData={persistClientData}
      onSignOut={handleSignOut}
      remoteLoadError={remoteLoadError}
      syncError={syncError}
      syncErrorDismissed={syncErrorDismissed}
      setSyncErrorDismissed={setSyncErrorDismissed}
      retryRemoteLoad={retryRemoteLoad}
    />
  );
}
