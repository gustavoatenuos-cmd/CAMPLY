import React from 'react';
import type { Session } from '@supabase/supabase-js';
import { Sidebar } from '../Sidebar';
import { StartupModal } from '../StartupModal';
import { ViewRouter } from './ViewRouter';
import { SyncErrorToast } from '../../shared/components/feedback/SyncErrorToast';
import type { CamplyData, ViewId, Insight } from '../../types';

interface AppShellProps {
  session: Session | null;
  data: CamplyData;
  insights: Insight[];
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  persistClientData: (nextData: CamplyData, clientId: string) => Promise<void>;
  onSignOut: () => void;
  
  // Sync Status
  remoteLoadError: string | null;
  syncError: string | null;
  syncErrorDismissed: boolean;
  setSyncErrorDismissed: (dismissed: boolean) => void;
  retryRemoteLoad: () => void;
}

export function AppShell({
  data,
  insights,
  activeView,
  setActiveView,
  updateData,
  persistClientData,
  onSignOut,
  remoteLoadError,
  syncError,
  syncErrorDismissed,
  setSyncErrorDismissed,
  retryRemoteLoad
}: AppShellProps) {
  const agentAlertCount = (data.agentAlerts || []).filter(a => a.status === 'active').length;

  return (
    <div className="flex min-h-dvh flex-col bg-brand-ink text-white xl:flex-row">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        alertCount={agentAlertCount}
        onSignOut={onSignOut}
      />
      
      <main className="min-w-0 flex-1">
        {remoteLoadError && (
          <div role="alert" className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            <span className="flex-1">{remoteLoadError}</span>
            <button
              type="button"
              onClick={retryRemoteLoad}
              className="shrink-0 rounded-lg border border-amber-400/40 px-3 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-400/10"
            >
              Tentar novamente
            </button>
          </div>
        )}
        
        <div className="min-h-full">
          <ViewRouter 
            activeView={activeView}
            setActiveView={setActiveView}
            data={data}
            insights={insights}
            updateData={updateData}
            persistClientData={persistClientData}
          />
        </div>
      </main>

      {/* Toast global de erro de CRM — não bloqueia nenhuma tela */}
      {syncError && !syncErrorDismissed && (
        <SyncErrorToast
          message={syncError}
          onDismiss={() => setSyncErrorDismissed(true)}
        />
      )}

      {/* Note: claudeSummary logic is omitted as it was deactivated in MVP */}
      <StartupModal 
        data={data} 
        setActiveView={setActiveView} 
        claudeSummary={null} 
        claudeLoading={false} 
      />
    </div>
  );
}
