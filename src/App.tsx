import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AlertCircle, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { StartupModal } from './components/StartupModal';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildInsights, clearUserData, initialData, loadData, saveData, setActivityActor } from './data/camplyStore';
import { hasNewerRemoteVersion, loadRemoteData, resetRemoteWorkspaceState, saveRemoteData, saveRemoteDataAndConfirmClient } from './data/supabaseStore';
import { setSupabaseSession, supabase } from './lib/supabase';
import { CamplyData, ViewId } from './types';
import { runAgentEngine } from './lib/agentEngine';
import { generateAgentSummary } from './lib/claudeService';
import { E2E_USER_ID, isMetaE2EMode, metaE2EWorkspace, resetMetaE2EState, restoreMetaE2EState } from './lib/meta/metaE2ERuntime';
import { resetE2EAnalysisProfiles } from './lib/analysis/clientAnalysisProfile';

const ActivityView = React.lazy(() => import('./components/ActivityView').then(m => ({ default: m.ActivityView })));
const AgentSettingsView = React.lazy(() => import('./components/AgentSettingsView').then(m => ({ default: m.AgentSettingsView })));
const CampaignsView = React.lazy(() => import('./components/CampaignsView').then(m => ({ default: m.CampaignsView })));
const ClientsView = React.lazy(() => import('./components/ClientsView').then(m => ({ default: m.ClientsView })));
const FinanceView = React.lazy(() => import('./components/FinanceView').then(m => ({ default: m.FinanceView })));
const IntelligenceView = React.lazy(() => import('./components/IntelligenceView').then(m => ({ default: m.IntelligenceView })));

const MetaIntegrationView = React.lazy(() => import('./components/MetaIntegrationView').then(m => ({ default: m.MetaIntegrationView })));
const PersonalFinanceView = React.lazy(() => import('./components/PersonalFinanceView').then(m => ({ default: m.PersonalFinanceView })));
const ProjectsView = React.lazy(() => import('./components/ProjectsView').then(m => ({ default: m.ProjectsView })));
const OverviewView = React.lazy(() => import('./components/OverviewView').then(m => ({ default: m.OverviewView })));
const CreativeCriticView = React.lazy(() => import('./components/CreativeCriticView').then(m => ({ default: m.CreativeCriticView })));
// Phase 1 — Analytics views
const ClientAnalyticsView = React.lazy(() => import('./components/ClientAnalyticsView').then(m => ({ default: m.ClientAnalyticsView })));
const AlertCenterView = React.lazy(() => import('./components/AlertCenterView').then(m => ({ default: m.AlertCenterView })));


import { motion, AnimatePresence } from 'framer-motion';

function initialActiveView(): ViewId {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('meta_sync') || params.has('meta_error')) return 'metaIntegration';
  }
  return 'today';
}

// ─── Toast global de erro de sincronização ────────────────────────────────────
// Substitui o banner vermelho permanente que bloqueava espaço em todas as telas.
// Aparece fixo no canto inferior direito e pode ser fechado manualmente.
function SyncErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      role="alert"
      className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-rose-500/40 bg-brand-surface2/90 p-4 shadow-glass backdrop-blur-md"
    >
      <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
      <p className="flex-1 text-sm leading-5 text-rose-200">{message}</p>
      <button
        type="button"
        aria-label="Fechar notificação"
        onClick={onDismiss}
        className="shrink-0 rounded-lg p-1 text-rose-300/60 transition hover:bg-white/[0.06] hover:text-rose-200"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
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
  const [syncErrorDismissed, setSyncErrorDismissed] = useState(false);
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null);
  const [remoteLoadAttempt, setRemoteLoadAttempt] = useState(0);
  const sessionUserIdRef = useRef<string | null>(null);
  const skipNextRemoteSaveRef = useRef(false);
  const focusRefreshRunningRef = useRef(false);

  // Reexibir o toast se surgir um novo erro após o usuário fechar
  useEffect(() => {
    if (syncError) setSyncErrorDismissed(false);
  }, [syncError]);

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
      setData(loadData(data.session?.user.id));
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
      setData(nextSession ? loadData(nextSession.user.id) : initialData);
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
    let retryTimeout: number | undefined;

    loadRemoteData().then((result) => {
      if (!active) return;
      if (result.status === 'ok') {
        skipNextRemoteSaveRef.current = true;
        setData(result.data);
        setRemoteLoaded(true);
        setRemoteLoadError(null);
        return;
      }
      if (result.status === 'empty' || result.status === 'unavailable') {
        setRemoteLoaded(true);
        setRemoteLoadError(null);
        return;
      }
      // Falha de rede/banco: NÃO liberamos o salvamento remoto, senão este
      // dispositivo (com dados possivelmente velhos) sobrescreveria o banco.
      setRemoteLoadError('Não foi possível carregar seus dados mais recentes do banco. Você está vendo a cópia local deste dispositivo — evite editar até a conexão voltar, pois alterações feitas agora podem ser perdidas.');
      retryTimeout = window.setTimeout(() => setRemoteLoadAttempt(a => a + 1), 8_000);
    });

    return () => {
      active = false;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [authenticated, session?.user.id, remoteLoadAttempt]);

  // Ao voltar para a aba/app, verifica se outro dispositivo gravou uma versão
  // mais nova e, se sim, recarrega — sem isso o app só busca dados no login.
  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;

    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (focusRefreshRunningRef.current) return;
      focusRefreshRunningRef.current = true;
      void hasNewerRemoteVersion()
        .then(async (newer) => {
          if (!newer) return;
          const result = await loadRemoteData();
          if (result.status === 'ok') {
            skipNextRemoteSaveRef.current = true;
            setData(result.data);
          }
        })
        .finally(() => {
          focusRefreshRunningRef.current = false;
        });
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [authenticated, remoteLoaded]);

  useEffect(() => {
    saveData(data, session?.user.id);
  }, [data, session?.user.id]);

  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;
    if (skipNextRemoteSaveRef.current) {
      skipNextRemoteSaveRef.current = false;
      setSyncError(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveRemoteData(data).then((result) => {
        if (result.status === 'saved' || result.status === 'skipped') {
          setSyncError(null);
          return;
        }
        if (result.status === 'conflict') {
          if (result.remoteData) {
            // Outro dispositivo salvou primeiro: adota a versão do banco em vez
            // de sobrescrevê-la com os dados desatualizados deste dispositivo.
            skipNextRemoteSaveRef.current = true;
            setData(result.remoteData);
            setSyncError('Este dispositivo estava com dados desatualizados. Carregamos a versão mais recente do banco — confira sua última alteração e refaça se necessário.');
          } else {
            setSyncError('Os dados foram alterados em outro dispositivo. Recarregue a página antes de continuar editando.');
          }
          return;
        }
        setSyncError('Não foi possível salvar uma alteração do CRM no banco. Recarregue antes de editar novamente. A sincronização das contas Meta não foi alterada.');
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
    // Removed automatic Claude API call on load to prevent 500 errors and avoid critical dependency
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

  const persistClientData = async (nextData: CamplyData, clientId: string) => {
    if (!authenticated || isMetaE2EMode) {
      skipNextRemoteSaveRef.current = true;
      setData(nextData);
      return;
    }

    await saveRemoteDataAndConfirmClient(nextData, clientId);
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
        {remoteLoadError && (
          <div role="alert" className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            <span className="flex-1">{remoteLoadError}</span>
            <button
              type="button"
              onClick={() => setRemoteLoadAttempt(a => a + 1)}
              className="shrink-0 rounded-lg border border-amber-400/40 px-3 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-400/10"
            >
              Tentar novamente
            </button>
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
              {activeView === 'projects' && <ProjectsView data={data} updateData={updateData} />}
              {activeView === 'personalFinance' && <PersonalFinanceView data={data} updateData={updateData} />}
              {activeView === 'activity' && <ActivityView data={data} />}
              {activeView === 'intelligence' && <IntelligenceView data={data} insights={insights} />}
              {activeView === 'agentSettings' && <AgentSettingsView data={data} updateData={updateData} />}

              {activeView === 'creativeCritic' && <CreativeCriticView data={data} />}
              {activeView === 'metaIntegration' && <MetaIntegrationView data={data} updateData={updateData} />}
              {/* Phase 1 — Analytics views */}
              {activeView === 'clientAnalytics' && <ClientAnalyticsView data={data} updateData={updateData} />}
              {activeView === 'alertCenter' && <AlertCenterView data={data} updateData={updateData} />}

            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      {/* Toast global de erro de CRM — não bloqueia nenhuma tela */}
      {syncError && !syncErrorDismissed && (
        <SyncErrorToast
          message={syncError}
          onDismiss={() => setSyncErrorDismissed(true)}
        />
      )}

      <StartupModal data={data} setActiveView={setActiveView} claudeSummary={claudeSummary} claudeLoading={claudeLoading} />
    </div>
  );
}
