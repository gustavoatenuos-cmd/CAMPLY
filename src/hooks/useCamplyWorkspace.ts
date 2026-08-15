import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { clearUserData, initialData, loadData, saveData, setActivityActor } from '../data/camplyStore';
import {
  hasNewerRemoteVersion,
  loadRemoteData,
  resetRemoteWorkspaceState,
  saveRemoteData,
  saveRemoteDataAndConfirmClient,
} from '../data/supabaseStore';
import { resetE2EAnalysisProfiles } from '../lib/analysis/clientAnalysisProfile';
import {
  E2E_USER_ID,
  isMetaE2EMode,
  metaE2EWorkspace,
  resetMetaE2EState,
  restoreMetaE2EState,
} from '../lib/meta/metaE2ERuntime';
import { evaluateOperationalSignals } from '../lib/operational/evaluateOperationalSignals';
import { syncOperationalSignals } from '../lib/operational/syncOperationalSignals';
import { canMutateWorkspace, WORKSPACE_READ_ONLY_MESSAGE } from '../lib/operational/workspaceMutationPolicy';
import { setSupabaseSession, supabase } from '../lib/supabase';
import type { CamplyData } from '../types';

const REMOTE_LOAD_ERROR = 'Não foi possível carregar seus dados mais recentes do banco. Você está vendo a cópia local deste dispositivo — evite editar até a conexão voltar, pois alterações feitas agora podem ser perdidas.';
const REMOTE_CONFLICT_RECOVERED = 'Este dispositivo estava com dados desatualizados. Carregamos a versão mais recente do banco — confira sua última alteração e refaça se necessário.';
const REMOTE_CONFLICT_RELOAD = 'Os dados foram alterados em outro dispositivo. Recarregue a página antes de continuar editando.';
const REMOTE_SAVE_ERROR = 'Não foi possível salvar uma alteração do CRM no banco. Recarregue antes de editar novamente. A sincronização das contas Meta não foi alterada.';

function reconcileWorkspace(workspace: CamplyData): CamplyData {
  const agentAlerts = syncOperationalSignals(
    workspace.agentAlerts || [],
    evaluateOperationalSignals(workspace)
  );
  return agentAlerts === workspace.agentAlerts ? workspace : { ...workspace, agentAlerts };
}

export interface CamplyWorkspaceController {
  session: Session | null;
  authReady: boolean;
  authenticated: boolean;
  data: CamplyData;
  remoteLoaded: boolean;
  remoteLoadError: string | null;
  workspaceReadOnly: boolean;
  syncError: string | null;
  syncErrorDismissed: boolean;
  retryRemoteLoad: () => void;
  dismissSyncError: () => void;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  persistClientData: (nextData: CamplyData, clientId: string) => Promise<void>;
  mockLogin: (() => void) | undefined;
  signOut: () => void;
}

export function useCamplyWorkspace(): CamplyWorkspaceController {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<CamplyData>(() => reconcileWorkspace(isMetaE2EMode ? metaE2EWorkspace : initialData));
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncErrorDismissed, setSyncErrorDismissed] = useState(false);
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null);
  const [remoteLoadAttempt, setRemoteLoadAttempt] = useState(0);
  const sessionUserIdRef = useRef<string | null>(null);
  const skipRemoteSaveDataRef = useRef<CamplyData | null>(null);
  const focusRefreshRunningRef = useRef(false);
  const remoteHydratingRef = useRef(false);
  const authTransitionRef = useRef(false);
  const lastConflictAtRef = useRef(0);
  const workspaceReadOnly = !canMutateWorkspace(remoteLoadError);

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

    authTransitionRef.current = true;
    void supabase.auth.getSession().then(({ data: sessionResult }) => {
      setSupabaseSession(sessionResult.session);
      sessionUserIdRef.current = sessionResult.session?.user.id || null;
      resetRemoteWorkspaceState();
      setRemoteLoaded(false);
      setSession(sessionResult.session);
      setData(reconcileWorkspace(loadData(sessionResult.session?.user.id)));
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authTransitionRef.current = true;
      setSupabaseSession(nextSession);
      const nextUserId = nextSession?.user.id || null;
      if (sessionUserIdRef.current !== nextUserId) {
        resetRemoteWorkspaceState();
        setRemoteLoaded(false);
        sessionUserIdRef.current = nextUserId;
      }
      setSession(nextSession);
      setData(reconcileWorkspace(nextSession ? loadData(nextSession.user.id) : initialData));
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

    remoteHydratingRef.current = true;
    void loadRemoteData().then((result) => {
      if (!active) return;
      remoteHydratingRef.current = false;
      authTransitionRef.current = false;
      if (result.status === 'ok') {
        const reconciled = reconcileWorkspace(result.data);
        skipRemoteSaveDataRef.current = reconciled;
        setData(reconciled);
        setRemoteLoaded(true);
        setRemoteLoadError(null);
        return;
      }
      if (result.status === 'empty' || result.status === 'unavailable') {
        setRemoteLoaded(true);
        setRemoteLoadError(null);
        return;
      }
      setRemoteLoadError(REMOTE_LOAD_ERROR);
      retryTimeout = window.setTimeout(() => setRemoteLoadAttempt((attempt) => attempt + 1), 8_000);
    });

    return () => {
      active = false;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [authenticated, session?.user.id, remoteLoadAttempt]);

  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;

    const refresh = () => {
      if (document.visibilityState === 'hidden' || focusRefreshRunningRef.current) return;
      focusRefreshRunningRef.current = true;
      void hasNewerRemoteVersion()
        .then(async (newer) => {
          if (!newer) return;
          remoteHydratingRef.current = true;
          const result = await loadRemoteData();
          if (result.status === 'ok') {
            const reconciled = reconcileWorkspace(result.data);
            skipRemoteSaveDataRef.current = reconciled;
            setData(reconciled);
          }
          remoteHydratingRef.current = false;
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
    if (!authenticated || !remoteLoaded || isMetaE2EMode || remoteLoadError) return;
    if (authTransitionRef.current || remoteHydratingRef.current) return;

    const params = new URLSearchParams(window.location.search);
    if (params.has('meta_sync') || params.has('meta_error')) return;

    if (skipRemoteSaveDataRef.current === data) {
      skipRemoteSaveDataRef.current = null;
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveRemoteData(data).then((result) => {
        if (result.status === 'saved' || result.status === 'skipped') {
          setSyncError(null);
          return;
        }
        if (result.status === 'conflict') {
          const now = Date.now();
          if (now - lastConflictAtRef.current <= 5_000) return;
          lastConflictAtRef.current = now;
          if (result.remoteData) {
            const reconciled = reconcileWorkspace(result.remoteData);
            skipRemoteSaveDataRef.current = reconciled;
            setData(reconciled);
            setSyncError(REMOTE_CONFLICT_RECOVERED);
          } else {
            setSyncError(REMOTE_CONFLICT_RELOAD);
          }
          return;
        }
        setSyncError(REMOTE_SAVE_ERROR);
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [authenticated, data, remoteLoaded, remoteLoadError]);

  const updateData = useCallback((updater: (workspace: CamplyData) => CamplyData) => {
    if (workspaceReadOnly) {
      setSyncError(WORKSPACE_READ_ONLY_MESSAGE);
      return;
    }
    setData((current) => reconcileWorkspace(updater(current)));
  }, [workspaceReadOnly]);

  const persistClientData = useCallback(async (nextData: CamplyData, clientId: string) => {
    if (workspaceReadOnly) {
      setSyncError(WORKSPACE_READ_ONLY_MESSAGE);
      throw new Error(WORKSPACE_READ_ONLY_MESSAGE);
    }
    const reconciled = reconcileWorkspace(nextData);
    if (!authenticated || isMetaE2EMode) {
      skipRemoteSaveDataRef.current = reconciled;
      setData(reconciled);
      return;
    }
    await saveRemoteDataAndConfirmClient(reconciled, clientId);
    skipRemoteSaveDataRef.current = reconciled;
    setData(reconciled);
    setSyncError(null);
  }, [authenticated, workspaceReadOnly]);

  const mockLogin = isMetaE2EMode ? () => {
    sessionUserIdRef.current = E2E_USER_ID;
    setData(reconcileWorkspace(metaE2EWorkspace));
    setSession({ user: { id: E2E_USER_ID } } as Session);
    setRemoteLoaded(true);
  } : undefined;

  const signOut = useCallback(() => {
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
  }, [session?.user.id]);

  return {
    session,
    authReady,
    authenticated,
    data,
    remoteLoaded,
    remoteLoadError,
    workspaceReadOnly,
    syncError,
    syncErrorDismissed,
    retryRemoteLoad: () => setRemoteLoadAttempt((attempt) => attempt + 1),
    dismissSyncError: () => setSyncErrorDismissed(true),
    updateData,
    persistClientData,
    mockLogin,
    signOut,
  };
}
