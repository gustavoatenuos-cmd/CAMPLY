import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Sidebar } from './components/Sidebar';
import { StartupModal } from './components/StartupModal';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildInsights, clearUserData, initialData, setActivityActor } from './data/camplyStore';
import { loadRemoteData, resetRemoteWorkspaceState, saveClientConfiguration, saveRemoteData } from './data/supabaseStore';
import { setSupabaseSession, supabase } from './lib/supabase';
import { CamplyData, ViewId } from './types';
import { runAgentEngine } from './lib/agentEngine';
import { generateAgentSummary } from './lib/claudeService';
import { E2E_USER_ID, isMetaE2EMode, metaE2EWorkspace, resetMetaE2EState, restoreMetaE2EState } from './lib/meta/metaE2ERuntime';
import { resetE2EAnalysisProfiles, upsertClientAnalysisProfile } from './lib/analysis/clientAnalysisProfile';
import type { ClientAnalysisProfile } from './lib/analysis/clientAnalysisProfile';

const ActivityView = React.lazy(() => import('./components/ActivityView').then(m => ({ default: m.ActivityView })));
const AgentSettingsView = React.lazy(() => import('./components/AgentSettingsView').then(m => ({ default: m.AgentSettingsView })));
const CampaignsView = React.lazy(() => import('./components/CampaignsView').then(m => ({ default: m.CampaignsView })));
const ClientsView = React.lazy(() => import('./components/ClientsView').then(m => ({ default: m.ClientsView })));
const FinanceView = React.lazy(() => import('./components/FinanceView').then(m => ({ default: m.FinanceView })));
const IntelligenceView = React.lazy(() => import('./components/IntelligenceView').then(m => ({ default: m.IntelligenceView })));
const AgentChatView = React.lazy(() => import('./components/AgentChatView').then(m => ({ default: m.AgentChatView })));
const MetaIntegrationView = React.lazy(() => import('./components/MetaIntegrationView').then(m => ({ default: m.MetaIntegrationView })));
const PersonalFinanceView = React.lazy(() => import('./components/PersonalFinanceView').then(m => ({ default: m.PersonalFinanceView })));
const ProjectsView = React.lazy(() => import('./components/ProjectsView').then(m => ({ default: m.ProjectsView })));
const OverviewView = React.lazy(() => import('./components/OverviewView').then(m => ({ default: m.OverviewView })));
const CreativeCriticView = React.lazy(() => import('./components/CreativeCriticView').then(m => ({ default: m.CreativeCriticView })));
// Phase 1 — Analytics views
const ClientAnalyticsView = React.lazy(() => import('./components/ClientAnalyticsView').then(m => ({ default: m.ClientAnalyticsView })));
const AlertCenterView = React.lazy(() => import('./components/AlertCenterView').then(m => ({ default: m.AlertCenterView })));


function initialActiveView(): ViewId {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('meta_sync') || params.has('meta_error')) return 'metaIntegration';
  }
  return 'today';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>(() => initialActiveView());
  const [data, setData] = useState<CamplyData>(() => isMetaE2EMode ? metaE2EWorkspace : initialData);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [claudeSummary, setClaudeSummary] = useState<string | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);
  const skipNextRemoteSaveRef = useRef(false);

  useEffect(() => {
    if (isMetaE2EMode) {
      if (new URLSearchParams(window.location.search).get('e2eReset') === '1') {
        resetMetaE2EState();
        resetE2EAnalysisProfiles();
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        restoreMetaE2EState();
      }
      setSession(null);
      setSupabaseSession(null);
      setAuthReady(true);
      setRemoteLoaded(true);
      return;
    }
    if (!supabase) {
      setSupabaseSession(null);
      setAuthReady(true);
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSupabaseSession(data.session);
      sessionUserIdRef.current = data.session?.user.id || null;
      resetRemoteWorkspaceState();
      setRemoteLoaded(false);
      setSession(data.session);
      setData(initialData);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSupabaseSession(nextSession);
      const nextUserId = nextSession?.user.id || null;
      if (sessionUserIdRef.current !== nextUserId) {
        resetRemoteWorkspaceState();
        setRemoteLoaded(false);
        sessionUserIdRef.current = nextUserId;
      }
      setSession(nextSession);
      setData(initialData);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const authenticated = Boolean(session);

  useEffect(() => {
    if (isMetaE2EMode) {
      setActivityActor('Usuário E2E');
      return;
    }
    const profileName = session?.user.user_metadata?.name;
    setActivityActor(
      typeof profileName === 'string' && profileName.trim()
        ? profileName
        : session?.user.email || null
    );
  }, [session]);

  useEffect(() => {
    if (!authenticated || isMetaE2EMode) return;

    let active = true;

    loadRemoteData().then((remoteData) => {
      if (!active) return;
      if (remoteData) setData(remoteData);
      setRemoteLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [authenticated, session?.user.id]);

  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;
    if (skipNextRemoteSaveRef.current) {
      skipNextRemoteSaveRef.current = false;
      setSyncError(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveRemoteData(data).then((saved) => {
        setSyncError(saved
          ? null
          : 'Não foi possível salvar uma alteração do CRM no banco. Recarregue antes de editar novamente. A sincronização das contas Meta não foi alterada.');
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [authenticated, data, remoteLoaded]);

  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;
    setData((current) => {
      const { newAlerts, newLogs } = runAgentEngine(current);
      if (newAlerts.length > 0 || newLogs.length > 0) {
        return {
          ...current,
          agentAlerts: [...newAlerts, ...current.agentAlerts],
          agentLogs: [...newLogs, ...current.agentLogs],
        };
      }
      return current;
    });
  }, [authenticated, remoteLoaded]);

  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;
    let active = true;

    setClaudeLoading(true);
    const timeout = window.setTimeout(() => {
      void generateAgentSummary(data).then((result) => {
        if (!active) return;
        if (result) {
          setClaudeSummary(result.summary_text);
        }
        setClaudeLoading(false);
      }).catch(() => {
        if (active) setClaudeLoading(false);
      });
    }, 1_000);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [authenticated, data, remoteLoaded]);

  const insights = useMemo(() => buildInsights(data), [data]);

  const updateData = (updater: (data: CamplyData) => CamplyData) => {
    setData((current) => {
      const next = updater(current);
      const { newAlerts, newLogs } = runAgentEngine(next);
      if (newAlerts.length > 0 || newLogs.length > 0) {
        return {
          ...next,
          agentAlerts: [...newAlerts, ...next.agentAlerts],
          agentLogs: [...newLogs, ...next.agentLogs],
        };
      }
      return next;
    });
  };

  const persistClientData = async (nextData: CamplyData, clientId: string, profile: ClientAnalysisProfile, idempotencyKey: string) => {
    if (isMetaE2EMode) {
      await upsertClientAnalysisProfile(profile);
      skipNextRemoteSaveRef.current = true;
      setData(nextData);
      return;
    }

    if (!authenticated) {
      skipNextRemoteSaveRef.current = true;
      setData(nextData);
      return;
    }

    await saveClientConfiguration(nextData, clientId, profile, idempotencyKey);
    skipNextRemoteSaveRef.current = true;
    setData(nextData);
    setSyncError(null);
  };

  if (!authReady) {
    return <div className="grid min-h-screen place-items-center bg-brand-ink text-brand-soft">Validando sessão...</div>;
  }

  if (!authenticated) {
    return <AuthGate onMockLogin={isMetaE2EMode ? () => {
      sessionUserIdRef.current = E2E_USER_ID;
      setData(metaE2EWorkspace);
      setSession({ user: { id: E2E_USER_ID } } as Session);
      setRemoteLoaded(true);
    } : undefined} />;
  }

  const agentAlertCount = (data.agentAlerts || []).filter(a => a.status === 'active').length;

  return (
    <div className="flex h-dvh min-h-screen flex-col overflow-hidden bg-brand-ink text-white xl:flex-row">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        alertCount={agentAlertCount}
        onSignOut={() => {
          const userId = session?.user.id;
          setSupabaseSession(null);
          clearUserData(userId);
          resetRemoteWorkspaceState();
          setRemoteLoaded(false);
          setData(initialData);
          if (isMetaE2EMode) {
            resetMetaE2EState();
            resetE2EAnalysisProfiles();
            setSession(null);
            return;
          }
          void supabase?.auth.signOut();
        }}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {syncError && (
          <div role="alert" className="border-b border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
            {syncError}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ErrorBoundary key={activeView} viewName={activeView}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-brand-soft">Carregando tela...</div>}>
              {activeView === 'today' && (
                <OverviewView
                  data={data}
                  insights={insights}
                  updateData={updateData}
                  setActiveView={setActiveView}
                />
              )}
              {activeView === 'campaigns' && <CampaignsView data={data} updateData={updateData} />}
              {activeView === 'clients' && <ClientsView data={data} updateData={updateData} persistClientData={persistClientData} />}
              {activeView === 'mediaFinance' && <FinanceView data={data} />}
              {activeView === 'projects' && <ProjectsView data={data} updateData={updateData} persistClientData={persistClientData} />}
              {activeView === 'personalFinance' && <PersonalFinanceView data={data} updateData={updateData} />}
              {activeView === 'activity' && <ActivityView data={data} />}
              {activeView === 'intelligence' && <IntelligenceView data={data} insights={insights} />}
              {activeView === 'agentSettings' && <AgentSettingsView data={data} updateData={updateData} />}
              {activeView === 'agentChat' && <AgentChatView data={data} updateData={updateData} />}
              {activeView === 'creativeCritic' && <CreativeCriticView data={data} />}
              {activeView === 'metaIntegration' && <MetaIntegrationView data={data} updateData={updateData} />}
              {/* Phase 1 — Analytics views */}
              {activeView === 'clientAnalytics' && <ClientAnalyticsView data={data} updateData={updateData} />}
              {activeView === 'alertCenter' && <AlertCenterView data={data} updateData={updateData} />}

            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <StartupModal data={data} setActiveView={setActiveView} claudeSummary={claudeSummary} claudeLoading={claudeLoading} />
    </div>
  );
}
