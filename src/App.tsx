import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { AUTH_STORAGE_KEY } from './auth';
import { Sidebar } from './components/Sidebar';
import { StartupModal } from './components/StartupModal';
import { AuthGate } from './components/AuthGate';
import { buildInsights, loadData, saveData } from './data/camplyStore';
import { loadRemoteData, saveRemoteData } from './data/supabaseStore';
import { supabase } from './lib/supabase';
import { CamplyData, ViewId } from './types';
import { runAgentEngine } from './lib/agentEngine';
import { generateAgentSummary } from './lib/claudeService';

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
const TodayView = React.lazy(() => import('./components/TodayView').then(m => ({ default: m.TodayView })));
const CreativeCriticView = React.lazy(() => import('./components/CreativeCriticView').then(m => ({ default: m.CreativeCriticView })));

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true');
  const [session, setSession] = useState<any>(null);
  const [activeView, setActiveView] = useState<ViewId>('today');
  const [data, setData] = useState<CamplyData>(() => loadData());
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [claudeSummary, setClaudeSummary] = useState<string | null>(null);
  const [claudeLoading, setClaudeLoading] = useState(false);

  useEffect(() => {
    supabase?.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      // We no longer overwrite the 'authenticated' state with the Supabase session, 
      // so local master password login persists!
    });

    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    let active = true;

    loadRemoteData().then((remoteData) => {
      if (!active) return;
      if (remoteData) setData(remoteData);
      setRemoteLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [authenticated]);

  useEffect(() => {
    saveData(data);
  }, [data]);

  useEffect(() => {
    if (!authenticated || !remoteLoaded) return;

    const timeout = window.setTimeout(() => {
      void saveRemoteData(data);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [authenticated, data, remoteLoaded]);

  // Executar o Agente Operacional ao carregar os dados
  useEffect(() => {
    if (!authenticated || !remoteLoaded) return;
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

  // Fase 3: Gerar resumo com Claude AI após carregar dados e agente
  useEffect(() => {
    if (!authenticated || !remoteLoaded) return;
    setClaudeLoading(true);
    generateAgentSummary(data).then((result) => {
      if (result) {
        setClaudeSummary(result.summary_text);
      }
      setClaudeLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, remoteLoaded]);

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

  if (!authenticated) {
    return (
      <AuthGate
        onUnlock={() => {
          window.localStorage.setItem(AUTH_STORAGE_KEY, 'true');
          setAuthenticated(true);
        }}
      />
    );
  }

  const agentAlertCount = (data.agentAlerts || []).filter(a => a.status === 'active').length;

  return (
    <div className="flex h-dvh min-h-screen flex-col overflow-hidden bg-brand-ink text-white xl:flex-row">
      <Sidebar activeView={activeView} setActiveView={setActiveView} alertCount={agentAlertCount} />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-brand-soft">Carregando tela...</div>}>
          {activeView === 'today' && <TodayView data={data} insights={insights} updateData={updateData} setActiveView={setActiveView} />}
          {activeView === 'campaigns' && <CampaignsView data={data} updateData={updateData} />}
          {activeView === 'clients' && <ClientsView data={data} updateData={updateData} />}
          {activeView === 'mediaFinance' && <FinanceView data={data} />}
          {activeView === 'projects' && <ProjectsView data={data} updateData={updateData} />}
          {activeView === 'personalFinance' && <PersonalFinanceView data={data} updateData={updateData} />}
          {activeView === 'activity' && <ActivityView data={data} />}
          {activeView === 'intelligence' && <IntelligenceView data={data} insights={insights} />}
          {activeView === 'agentSettings' && <AgentSettingsView data={data} updateData={updateData} />}
          {activeView === 'agentChat' && <AgentChatView data={data} updateData={updateData} />}
          {activeView === 'creativeCritic' && <CreativeCriticView data={data} />}
          {activeView === 'metaIntegration' && <MetaIntegrationView data={data} updateData={updateData} />}
        </Suspense>
      </main>
      <StartupModal data={data} setActiveView={setActiveView} claudeSummary={claudeSummary} claudeLoading={claudeLoading} />
    </div>
  );
}
