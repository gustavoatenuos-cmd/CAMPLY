import React, { Suspense } from 'react';
import type { CamplyData, ViewId, Insight } from '../../types';
import { ErrorBoundary } from '../ErrorBoundary';

const ActivityView = React.lazy(() => import('../ActivityView').then(m => ({ default: m.ActivityView })));
const AgentSettingsView = React.lazy(() => import('../AgentSettingsView').then(m => ({ default: m.AgentSettingsView })));
const CampaignsView = React.lazy(() => import('../CampaignsView').then(m => ({ default: m.CampaignsView })));
const ClientsView = React.lazy(() => import('../ClientsView').then(m => ({ default: m.ClientsView })));
const FinanceView = React.lazy(() => import('../FinanceView').then(m => ({ default: m.FinanceView })));
const IntelligenceView = React.lazy(() => import('../IntelligenceView').then(m => ({ default: m.IntelligenceView })));
const MetaIntegrationView = React.lazy(() => import('../MetaIntegrationView').then(m => ({ default: m.MetaIntegrationView })));
const PersonalFinanceView = React.lazy(() => import('../PersonalFinanceView').then(m => ({ default: m.PersonalFinanceView })));
const ProjectsView = React.lazy(() => import('../ProjectsView').then(m => ({ default: m.ProjectsView })));
const OverviewView = React.lazy(() => import('../OverviewView').then(m => ({ default: m.OverviewView })));
const CreativeCriticView = React.lazy(() => import('../CreativeCriticView').then(m => ({ default: m.CreativeCriticView })));
const ClientAnalyticsView = React.lazy(() => import('../ClientAnalyticsView').then(m => ({ default: m.ClientAnalyticsView })));
const AlertCenterView = React.lazy(() => import('../AlertCenterView').then(m => ({ default: m.AlertCenterView })));

interface ViewRouterProps {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  data: CamplyData;
  insights: Insight[];
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  persistClientData: (nextData: CamplyData, clientId: string) => Promise<void>;
}

export function ViewRouter({
  activeView,
  setActiveView,
  data,
  insights,
  updateData,
  persistClientData
}: ViewRouterProps) {
  return (
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
        {activeView === 'clientAnalytics' && <ClientAnalyticsView data={data} updateData={updateData} setActiveView={setActiveView} />}
        {activeView === 'alertCenter' && <AlertCenterView data={data} updateData={updateData} />}
      </Suspense>
    </ErrorBoundary>
  );
}
