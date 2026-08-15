import React, { Suspense, useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { StartupModal } from './components/StartupModal';
import { useCamplyWorkspace } from './hooks/useCamplyWorkspace';
import { getCamplyBuildInfo } from './lib/diagnostics/buildInfo';
import { getSupabaseSessionDiagnostics } from './lib/supabase';
import type { ViewId } from './types';

const ActivityView = React.lazy(() => import('./components/ActivityView').then((module) => ({ default: module.ActivityView })));
const AgentSettingsView = React.lazy(() => import('./components/AgentSettingsView').then((module) => ({ default: module.AgentSettingsView })));
const AlertCenterView = React.lazy(() => import('./components/AlertCenterView').then((module) => ({ default: module.AlertCenterView })));
const CampaignsView = React.lazy(() => import('./components/CampaignsView').then((module) => ({ default: module.CampaignsView })));
const ClientAnalyticsView = React.lazy(() => import('./components/ClientAnalyticsView').then((module) => ({ default: module.ClientAnalyticsView })));
const ClientsView = React.lazy(() => import('./components/ClientsView').then((module) => ({ default: module.ClientsView })));
const CreativeCriticView = React.lazy(() => import('./components/CreativeCriticView').then((module) => ({ default: module.CreativeCriticView })));
const FinanceView = React.lazy(() => import('./components/FinanceView').then((module) => ({ default: module.FinanceView })));
const IntelligenceView = React.lazy(() => import('./components/IntelligenceView').then((module) => ({ default: module.IntelligenceView })));
const MetaIntegrationView = React.lazy(() => import('./components/MetaIntegrationView').then((module) => ({ default: module.MetaIntegrationView })));
const OverviewView = React.lazy(() => import('./components/OverviewView').then((module) => ({ default: module.OverviewView })));
const PersonalFinanceView = React.lazy(() => import('./components/PersonalFinanceView').then((module) => ({ default: module.PersonalFinanceView })));
const ProjectsView = React.lazy(() => import('./components/ProjectsView').then((module) => ({ default: module.ProjectsView })));

function initialActiveView(): ViewId {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('meta_sync') || params.has('meta_error')) return 'metaIntegration';
  }
  return 'today';
}

function SyncErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
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
  const [activeView, setActiveView] = useState<ViewId>(() => initialActiveView());
  const [claudeSummary] = useState<string | null>(null);
  const [claudeLoading] = useState(false);
  const workspace = useCamplyWorkspace();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedFilters = window.sessionStorage.getItem('camply:performance-dashboard-filters');
    let selectedPeriod = new URLSearchParams(window.location.search).get('period') || 'last_90d';
    if (storedFilters) {
      try {
        const parsed = JSON.parse(storedFilters) as { period?: unknown };
        if (typeof parsed.period === 'string' && parsed.period) selectedPeriod = parsed.period;
      } catch {
        // Diagnostics must never interfere with application startup.
      }
    }
    window.CAMPLY_DIAGNOSTICS = {
      build: getCamplyBuildInfo(),
      session: getSupabaseSessionDiagnostics(),
      selectedPeriod,
    };
  }, [workspace.session, activeView]);

  if (!workspace.authReady) {
    return <div className="grid min-h-screen place-items-center bg-brand-ink text-brand-soft">Validando sessão...</div>;
  }

  if (!workspace.authenticated) {
    return <AuthGate onMockLogin={workspace.mockLogin} />;
  }

  const agentAlertCount = workspace.data.agentAlerts.filter((alert) => alert.status === 'active').length;

  return (
    <div className="flex min-h-dvh flex-col bg-brand-ink text-white xl:flex-row">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        alertCount={agentAlertCount}
        onSignOut={workspace.signOut}
      />
      <main className="min-w-0 flex-1">
        {workspace.remoteLoadError ? (
          <div role="alert" className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            <span className="flex-1"><strong>Modo somente leitura.</strong> {workspace.remoteLoadError}</span>
            <button
              type="button"
              onClick={workspace.retryRemoteLoad}
              className="shrink-0 rounded-lg border border-amber-400/40 px-3 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-400/10"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}
        <div className="min-h-full">
          <ErrorBoundary key={activeView} viewName={activeView}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-brand-soft">Carregando tela...</div>}>
              {activeView === 'today' ? (
                <OverviewView
                  data={workspace.data}
                  insights={[]}
                  updateData={workspace.updateData}
                  setActiveView={setActiveView}
                />
              ) : null}
              {activeView === 'campaigns' ? <CampaignsView data={workspace.data} updateData={workspace.updateData} /> : null}
              {activeView === 'clients' ? <ClientsView data={workspace.data} updateData={workspace.updateData} persistClientData={workspace.persistClientData} /> : null}
              {activeView === 'mediaFinance' ? <FinanceView data={workspace.data} /> : null}
              {activeView === 'projects' ? <ProjectsView data={workspace.data} updateData={workspace.updateData} /> : null}
              {activeView === 'personalFinance' ? <PersonalFinanceView data={workspace.data} updateData={workspace.updateData} /> : null}
              {activeView === 'activity' ? <ActivityView data={workspace.data} /> : null}
              {activeView === 'intelligence' ? <IntelligenceView data={workspace.data} /> : null}
              {activeView === 'agentSettings' ? <AgentSettingsView data={workspace.data} updateData={workspace.updateData} /> : null}
              {activeView === 'creativeCritic' ? <CreativeCriticView data={workspace.data} /> : null}
              {activeView === 'metaIntegration' ? <MetaIntegrationView data={workspace.data} updateData={workspace.updateData} /> : null}
              {activeView === 'clientAnalytics' ? <ClientAnalyticsView data={workspace.data} updateData={workspace.updateData} setActiveView={setActiveView} /> : null}
              {activeView === 'alertCenter' ? <AlertCenterView data={workspace.data} updateData={workspace.updateData} /> : null}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      <AnimatePresence>
        {workspace.syncError && !workspace.syncErrorDismissed ? (
          <SyncErrorToast message={workspace.syncError} onDismiss={workspace.dismissSyncError} />
        ) : null}
      </AnimatePresence>
      <StartupModal
        data={workspace.data}
        setActiveView={setActiveView}
        claudeSummary={claudeSummary}
        claudeLoading={claudeLoading}
      />
    </div>
  );
}
