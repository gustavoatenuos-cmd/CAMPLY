import { useEffect, useMemo, useState } from 'react';
import { AUTH_STORAGE_KEY } from './auth';
import { ActivityView } from './components/ActivityView';
import { AuthGate } from './components/AuthGate';
import { CampaignsView } from './components/CampaignsView';
import { ClientsView } from './components/ClientsView';
import { FinanceView } from './components/FinanceView';
import { IntelligenceView } from './components/IntelligenceView';
import { PersonalFinanceView } from './components/PersonalFinanceView';
import { ProjectsView } from './components/ProjectsView';
import { Sidebar } from './components/Sidebar';
import { TodayView } from './components/TodayView';
import { buildInsights, loadData, saveData } from './data/camplyStore';
import { loadRemoteData, saveRemoteData } from './data/supabaseStore';
import { CamplyData, ViewId } from './types';

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => window.sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true');
  const [activeView, setActiveView] = useState<ViewId>('today');
  const [data, setData] = useState<CamplyData>(() => loadData());
  const [remoteLoaded, setRemoteLoaded] = useState(false);

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

  const insights = useMemo(() => buildInsights(data), [data]);

  const updateData = (updater: (data: CamplyData) => CamplyData) => {
    setData((current) => updater(current));
  };

  if (!authenticated) {
    return (
      <AuthGate
        onUnlock={() => {
          window.sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
          setAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-brand-ink text-white">
      <Sidebar activeView={activeView} setActiveView={setActiveView} alertCount={insights.filter((item) => item.level !== 'good').length} />
      <main className="min-w-0 flex-1 overflow-hidden">
        {activeView === 'today' && <TodayView data={data} insights={insights} updateData={updateData} setActiveView={setActiveView} />}
        {activeView === 'campaigns' && <CampaignsView data={data} updateData={updateData} />}
        {activeView === 'clients' && <ClientsView data={data} updateData={updateData} />}
        {activeView === 'mediaFinance' && <FinanceView data={data} />}
        {activeView === 'projects' && <ProjectsView data={data} updateData={updateData} />}
        {activeView === 'personalFinance' && <PersonalFinanceView data={data} updateData={updateData} />}
        {activeView === 'activity' && <ActivityView data={data} />}
        {activeView === 'intelligence' && <IntelligenceView data={data} insights={insights} />}
      </main>
    </div>
  );
}
