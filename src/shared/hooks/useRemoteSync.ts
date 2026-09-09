import { useEffect, useRef, useState } from 'react';
import { hasNewerRemoteVersion, loadRemoteData, saveRemoteData, saveRemoteDataAndConfirmClient, resetRemoteWorkspaceState } from '../../data/supabaseStore';
import type { CamplyData } from '../../types';
import { isMetaE2EMode } from '../../lib/meta/metaE2ERuntime';

export function useRemoteSync(
  authenticated: boolean,
  data: CamplyData,
  setData: (data: CamplyData | ((current: CamplyData) => CamplyData)) => void,
  authTransitionRef: React.MutableRefObject<boolean>
) {
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncErrorDismissed, setSyncErrorDismissed] = useState(false);
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null);
  const [remoteLoadAttempt, setRemoteLoadAttempt] = useState(0);

  const skipNextRemoteSaveRef = useRef(false);
  const focusRefreshRunningRef = useRef(false);
  const remoteHydratingRef = useRef(false);
  const conflictRecoveringRef = useRef(false);
  const lastConflictAtRef = useRef(0);

  useEffect(() => {
    if (syncError) setSyncErrorDismissed(false);
  }, [syncError]);

  const resetSyncState = () => {
    resetRemoteWorkspaceState();
    setRemoteLoaded(false);
  };

  const markHydrationComplete = (loadedData: CamplyData) => {
    skipNextRemoteSaveRef.current = true;
    conflictRecoveringRef.current = true;
    setData(loadedData);
    setTimeout(() => { conflictRecoveringRef.current = false; }, 0);
  };

  // Initial Load
  useEffect(() => {
    if (!authenticated || isMetaE2EMode) {
      if (isMetaE2EMode) setRemoteLoaded(true);
      return;
    }

    let active = true;
    let retryTimeout: number | undefined;

    remoteHydratingRef.current = true;
    loadRemoteData().then((result) => {
      if (!active) return;
      remoteHydratingRef.current = false;
      authTransitionRef.current = false;
      
      if (result.status === 'ok') {
        markHydrationComplete(result.data);
        setRemoteLoaded(true);
        setRemoteLoadError(null);
        return;
      }
      if (result.status === 'empty' || result.status === 'unavailable') {
        setRemoteLoaded(true);
        setRemoteLoadError(null);
        return;
      }
      
      setRemoteLoadError('Não foi possível carregar seus dados mais recentes do banco. Você está vendo a cópia local deste dispositivo — evite editar até a conexão voltar.');
      retryTimeout = window.setTimeout(() => setRemoteLoadAttempt(a => a + 1), 8_000);
    });

    return () => {
      active = false;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [authenticated, remoteLoadAttempt, setData, authTransitionRef]);

  // Focus Refresh (Conflict Detection)
  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode) return;

    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (focusRefreshRunningRef.current) return;
      focusRefreshRunningRef.current = true;
      void hasNewerRemoteVersion()
        .then(async (newer) => {
          if (!newer) return;
          remoteHydratingRef.current = true;
          const result = await loadRemoteData();
          if (result.status === 'ok') {
            markHydrationComplete(result.data);
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
  }, [authenticated, remoteLoaded, setData]);

  // Auto-Save
  useEffect(() => {
    if (!authenticated || !remoteLoaded || isMetaE2EMode || remoteLoadError) return;
    
    if (authTransitionRef.current || remoteHydratingRef.current || conflictRecoveringRef.current) {
      return;
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('meta_sync') || params.has('meta_error')) {
        return;
      }
    }

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
          const now = Date.now();
          if (now - lastConflictAtRef.current > 5000) {
            lastConflictAtRef.current = now;
            if (result.remoteData) {
              markHydrationComplete(result.remoteData);
              setSyncError('Este dispositivo estava com dados desatualizados. Carregamos a versão mais recente do banco — confira sua última alteração.');
            } else {
              setSyncError('Os dados foram alterados em outro dispositivo. Recarregue a página antes de continuar editando.');
            }
          }
          return;
        }
        setSyncError('Não foi possível salvar uma alteração do CRM no banco. Recarregue antes de editar novamente.');
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [authenticated, data, remoteLoaded, remoteLoadError, authTransitionRef]);

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

  const retryRemoteLoad = () => setRemoteLoadAttempt(a => a + 1);

  return {
    remoteLoaded,
    remoteLoadError,
    syncError,
    syncErrorDismissed,
    setSyncErrorDismissed,
    persistClientData,
    retryRemoteLoad,
    resetSyncState
  };
}
