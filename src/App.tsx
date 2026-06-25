import { useEffect, useMemo, useState } from 'react';
import { CampaignsView } from './components/CampaignsView';
import { ClientsView } from './components/ClientsView';
import { FinanceView } from './components/FinanceView';
import { IntelligenceView } from './components/IntelligenceView';
import { ProjectsView } from './components/ProjectsView';
import { Sidebar } from './components/Sidebar';
import { TodayView } from './components/TodayView';
import { buildInsights, loadData, saveData } from './data/camplyStore';
import { CamplyData, ViewId } from './types';

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>('today');
  const [data, setData] = useState<CamplyData>(() => loadData());

  useEffect(() => {
    saveData(data);
  }, [data]);

  const insights = useMemo(() => buildInsights(data), [data]);

  const updateData = (updater: (data: CamplyData) => CamplyData) => {
    setData((current) => updater(current));
  };

  return (
    <div className="flex h-screen overflow-hidden bg-brand-ink text-white">
      <Sidebar activeView={activeView} setActiveView={setActiveView} alertCount={insights.filter((item) => item.level !== 'good').length} />
      <main className="min-w-0 flex-1 overflow-hidden">
        {activeView === 'today' && <TodayView data={data} insights={insights} updateData={updateData} setActiveView={setActiveView} />}
        {activeView === 'campaigns' && <CampaignsView data={data} updateData={updateData} />}
        {activeView === 'clients' && <ClientsView data={data} updateData={updateData} />}
        {activeView === 'finance' && <FinanceView data={data} updateData={updateData} />}
        {activeView === 'projects' && <ProjectsView data={data} updateData={updateData} />}
        {activeView === 'intelligence' && <IntelligenceView data={data} insights={insights} />}
      </main>
    </div>
  );
}
