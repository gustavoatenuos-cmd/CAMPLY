import { Activity, RefreshCw, AlertCircle, AlertTriangle, Banknote, Bell, CalendarClock, CheckCircle2, ChevronRight, CircleDollarSign, Clock, Megaphone, Plus, ShieldAlert, Target, BarChart3 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { createActivityLog, daysUntil, formatDate, makeId, money } from '../data/camplyStore';
import { BrandLogo } from './BrandLogo';
import { Modal } from './ui/Modal';
import { CamplyData, Insight, Task, ViewId, TaskType, TaskArea, Receivable, Campaign, Project } from '../types';
import { clientDisplayName } from './ClientsView';
import { syncClientMeta } from '../lib/meta/metaSyncService';
import { applyMetaSyncToWorkspace } from '../lib/meta/applyMetaSyncToWorkspace';
import { CampaignObjectiveBlocks } from './meta/CampaignObjectiveBlocks';
import { buildClientMetaAnalytics, buildSnapshot } from '../lib/meta/clientAnalytics';

interface TodayViewProps {
  data: CamplyData;
  insights: Insight[];
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  setActiveView: (view: ViewId) => void;
}

export function TodayView({ data, insights, updateData, setActiveView }: TodayViewProps) {
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskType, setTaskType] = useState<TaskType>('otimizacao');
  const [taskArea, setTaskArea] = useState<TaskArea>('geral');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [hasFinance, setHasFinance] = useState(false);
  const [dashboardPeriod, setDashboardPeriod] = useState<string>('last_7d');
  const [syncingClientId, setSyncingClientId] = useState<string | null>(null);
  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status));
  const pendingPayments = data.receivables.filter((receivable) => receivable.status !== 'paid');
  const openTasks = data.tasks.filter((task) => !task.done).sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));
  const priorityCampaigns = data.campaigns.filter((campaign) => campaign.priority === 'high' || campaign.status === 'optimize');
  const amountToReceive = pendingPayments.reduce((sum, item) => sum + item.amount, 0);

  const handleSyncClient = async (client: any) => {
    if (!client.metaAdAccountId) return;
    setSyncingClientId(client.id);
    try {
      const payload = await syncClientMeta(client, data.campaigns);
      const { status, message } = payload;
      updateData(curr => applyMetaSyncToWorkspace(client, payload, curr));
      
      if (status === 'partial') {
        alert(`Sincronização parcial concluída. Algumas falhas ocorreram: ${message || 'Erro desconhecido'}`);
      }
    } catch(err: any) { 
      alert("Erro ao sincronizar: " + err.message);
      console.error(err);
    }
    setSyncingClientId(null);
  };


  const toggleTask = (task: Task) => {
    updateData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, done: !item.done } : item)),
      activityLogs: [
        createActivityLog({
          action: task.done ? 'task_reopened' : 'task_completed',
          title: task.done ? `Tarefa reaberta: ${task.title}` : `Tarefa concluída: ${task.title}`,
          description: task.done ? 'A tarefa voltou para a lista de pendências.' : 'A tarefa foi marcada como concluída na central do dia.',
          projectId: '',
          clientId: '',
          campaignId: '',
          receivableId: '',
          taskId: task.id,
        }),
        ...current.activityLogs,
      ],
    }));
  };

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;

    const area = String(form.get('area') ?? 'geral') as TaskArea;
    const clientId = String(form.get('clientId') ?? '');
    const financeAmountStr = String(form.get('financeAmount') ?? '');
    const financeAmount = financeAmountStr ? Number(financeAmountStr.replace(/\D/g, '')) / 100 : undefined;

    const task: Task = {
      id: makeId('task'),
      title,
      dueDate: String(form.get('dueDate') ?? new Date().toISOString().slice(0, 10)),
      area,
      taskType,
      clientId: clientId || undefined,
      hasFinance,
      financeAmount,
      done: false,
    };

    let newReceivable: Receivable | undefined;
    let newCampaign: Campaign | undefined;
    let newProject: Project | undefined;
    let newLogs: any[] = [];

    if (hasFinance && clientId && financeAmount) {
      newReceivable = {
        id: makeId('recv'),
        clientId,
        description: `Lançamento via Tarefa: ${title}`,
        amount: financeAmount,
        dueDate: task.dueDate,
        status: 'pending'
      };
      newLogs.push(createActivityLog({
        action: 'receivable_created',
        title: 'Financeiro gerado',
        description: `O valor de ${money(financeAmount)} foi lançado pendente via tarefa.`,
        projectId: '', clientId, campaignId: '', receivableId: newReceivable.id, taskId: task.id,
      }));
    }

    const campaignId = form.get('campaignId') as string | null;

    if (taskType === 'otimizacao' && area === 'tráfego' && clientId) {
      const existingCampaign = campaignId && campaignId !== 'new' 
        ? data.campaigns.find(c => c.id === campaignId) 
        : (!campaignId ? data.campaigns.find(c => c.clientId === clientId) : undefined);
        
      if (existingCampaign) {
        newLogs.push(createActivityLog({
          action: 'campaign_status_changed',
          title: 'Otimização Registrada',
          description: `A tarefa "${title}" marcou uma otimização na campanha.`,
          projectId: '', clientId, campaignId: existingCampaign.id, receivableId: '', taskId: task.id,
        }));
      } else {
        const client = data.clients.find(c => c.id === clientId);
        newCampaign = {
          id: makeId('camp'),
          clientId,
          name: `Tráfego ${client?.company || ''}`,
          platform: 'Meta Ads',
          status: 'setup',
          objective: 'Tráfego',
          budget: 0,
          spent: 0,
          lastOptimizedAt: task.dueDate,
          nextAction: 'Configuração inicial',
          priority: 'medium'
        };
        newLogs.push(createActivityLog({
          action: 'campaign_created',
          title: 'Campanha criada automaticamente',
          description: `Campanha criada via fluxo de tarefas para o cliente.`,
          projectId: '', clientId, campaignId: newCampaign.id, receivableId: '', taskId: task.id,
        }));
      }
    }

    if (taskType === 'novo_projeto' && area === 'site' && clientId) {
      const client = data.clients.find(c => c.id === clientId);
      newProject = {
        id: makeId('proj'),
        projectType: 'site',
        clientId,
        ownerName: client?.company || '',
        company: client?.company || '',
        billingType: 'one_time',
        name: title,
        role: 'Desenvolvimento Web',
        status: 'planning',
        progress: 0,
        dueDate: task.dueDate,
        amountCharged: financeAmount || 0,
        amountReceived: 0,
        paymentStatus: 'pending',
        deliveredUrl: '',
        visibility: 'private',
        nextAction: 'Reunião de briefing'
      };
      newLogs.push(createActivityLog({
        action: 'project_created',
        title: 'Projeto de site criado',
        description: `Projeto inicializado automaticamente pela Central do Dia.`,
        projectId: newProject.id, clientId, campaignId: '', receivableId: '', taskId: task.id,
      }));
    }

    updateData((current) => {
      const receivables = newReceivable ? [newReceivable, ...current.receivables] : current.receivables;
      const campaigns = newCampaign ? [newCampaign, ...current.campaigns] : current.campaigns;
      const projects = newProject ? [newProject, ...current.projects] : current.projects;
      
      return {
        ...current,
        tasks: [task, ...current.tasks],
        receivables,
        campaigns,
        projects,
        activityLogs: [
          createActivityLog({
            action: 'task_created',
            title: `Tarefa criada: ${task.title}`,
            description: `Nova tarefa adicionada para ${formatDate(task.dueDate)} na área de ${task.area}.`,
            projectId: '',
            clientId: clientId || '',
            campaignId: '',
            receivableId: '',
            taskId: task.id,
          }),
          ...newLogs,
          ...current.activityLogs,
        ],
      };
    });

    setTaskModalOpen(false);
    event.currentTarget.reset();
    setHasFinance(false);
    setTaskType('otimizacao');
    setTaskArea('geral');
    setSelectedClientId('');
  };

  const clientCampaigns = data.campaigns.filter(c => c.clientId === selectedClientId);
  const showCampaignSelector = taskArea === 'tráfego' && selectedClientId && clientCampaigns.length > 0;

  const activeAlerts = data.agentAlerts?.filter(a => a.status === 'active') || [];
  const alertsAtrasados = activeAlerts.filter(a => a.title.includes('Atrasad'));
  const alertsUrgentes = activeAlerts.filter(a => a.title.includes('Hoje'));
  const alertsParados = activeAlerts.filter(a => a.title.includes('Parad'));
  const alertsAtencao = activeAlerts.filter(a => a.title.includes('Atenção') || a.title.includes('Crítica'));

  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const toggleExpand = (card: string) => setExpandedCard(expandedCard === card ? null : card);

  const metaClientAnalytics = data.clients.map((client) => buildClientMetaAnalytics(client, data.campaigns, dashboardPeriod));
  const activeMetaClientAnalytics = metaClientAnalytics.filter((analytics) => analytics.campaigns.length > 0);
  const trafficTotals = buildSnapshot(activeMetaClientAnalytics.reduce((acc, analytics) => {
    acc.spend = (acc.spend || 0) + analytics.totals.spend;
    acc.impressions = (acc.impressions || 0) + analytics.totals.impressions;
    acc.link_clicks = (acc.link_clicks || 0) + analytics.totals.linkClicks;
    acc.messaging_conversations_started_total = (acc.messaging_conversations_started_total || 0) + analytics.totals.conversations;
    acc.leads = (acc.leads || 0) + analytics.totals.leads;
    acc.purchases = (acc.purchases || 0) + analytics.totals.purchases;
    acc.purchase_value = (acc.purchase_value || 0) + analytics.totals.purchaseValue;
    return acc;
  }, {} as Record<string, number>));
  const totalSpent = trafficTotals.spend;
  const totalImpressions = trafficTotals.impressions;

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-8 rounded-2xl border border-brand-line bg-brand-paper p-5 text-brand-ink shadow-brand">
        <BrandLogo />
      </div>

      {/* ===== DASHBOARD CENTRAL ===== */}
      <div className="mb-8 rounded-2xl border border-brand-line bg-brand-ink p-5 shadow-lg">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black text-white">
            <ShieldAlert className="text-brand-green" size={22} />
            Dashboard Operacional
          </h2>
          <button 
            onClick={() => setActiveView('intelligence')}
            className="text-sm font-bold text-brand-green hover:underline"
          >
            Central completa &rarr;
          </button>
        </div>

        {/* Alert Cards - Clicáveis */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <button onClick={() => toggleExpand('atrasados')} className={`rounded-xl border p-4 text-left transition hover:scale-[1.02] ${expandedCard === 'atrasados' ? 'border-red-500 bg-red-500/15 ring-1 ring-red-500/30' : 'border-brand-line bg-brand-surface hover:border-red-500/50'}`}>
            <div className="flex items-center gap-2 text-red-500 mb-1">
              <AlertCircle size={16} />
              <span className="font-semibold text-xs">Atrasados</span>
            </div>
            <p className="text-3xl font-black text-white">{alertsAtrasados.length}</p>
            <p className="text-[10px] text-brand-muted mt-1">Clique para ver →</p>
          </button>

          <button onClick={() => toggleExpand('urgentes')} className={`rounded-xl border p-4 text-left transition hover:scale-[1.02] ${expandedCard === 'urgentes' ? 'border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30' : 'border-brand-line bg-brand-surface hover:border-amber-500/50'}`}>
            <div className="flex items-center gap-2 text-amber-500 mb-1">
              <AlertTriangle size={16} />
              <span className="font-semibold text-xs">Urgentes (Hoje)</span>
            </div>
            <p className="text-3xl font-black text-white">{alertsUrgentes.length}</p>
            <p className="text-[10px] text-brand-muted mt-1">Clique para ver →</p>
          </button>

          <button onClick={() => toggleExpand('parados')} className={`rounded-xl border p-4 text-left transition hover:scale-[1.02] ${expandedCard === 'parados' ? 'border-slate-400 bg-slate-400/15 ring-1 ring-slate-400/30' : 'border-brand-line bg-brand-surface hover:border-slate-400/50'}`}>
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Clock size={16} />
              <span className="font-semibold text-xs">Parados</span>
            </div>
            <p className="text-3xl font-black text-white">{alertsParados.length}</p>
            <p className="text-[10px] text-brand-muted mt-1">Clique para ver →</p>
          </button>

          <button onClick={() => toggleExpand('atencao')} className={`rounded-xl border p-4 text-left transition hover:scale-[1.02] ${expandedCard === 'atencao' ? 'border-brand-green bg-brand-green/10 ring-1 ring-brand-green/30' : 'border-brand-line bg-brand-surface hover:border-brand-green/50'}`}>
            <div className="flex items-center gap-2 text-brand-green mb-1">
              <Bell size={16} />
              <span className="font-semibold text-xs">Em Atenção</span>
            </div>
            <p className="text-3xl font-black text-white">{alertsAtencao.length}</p>
            <p className="text-[10px] text-brand-muted mt-1">Clique para ver →</p>
          </button>
        </div>

        {/* Expanded Alert List - ACIONÁVEL */}
        {expandedCard && (() => {
          const alertMap: Record<string, { items: typeof activeAlerts; color: string; label: string }> = {
            atrasados: { items: alertsAtrasados, color: 'border-red-500/30 bg-red-500/5', label: 'Itens Atrasados' },
            urgentes: { items: alertsUrgentes, color: 'border-amber-500/30 bg-amber-500/5', label: 'Itens Urgentes (Hoje)' },
            parados: { items: alertsParados, color: 'border-slate-400/30 bg-slate-400/5', label: 'Itens Parados' },
            atencao: { items: alertsAtencao, color: 'border-brand-green/30 bg-brand-green/5', label: 'Em Atenção' },
          };
          const { items, color, label } = alertMap[expandedCard];

          const resolveAlert = (alertId: string) => {
            updateData((d) => ({
              ...d,
              agentAlerts: d.agentAlerts.map(a => a.id === alertId ? { ...a, status: 'resolved' as const } : a),
            }));
          };

          const completeTask = (taskId: string, alertId: string) => {
            updateData((d) => ({
              ...d,
              tasks: d.tasks.map(t => t.id === taskId ? { ...t, done: true } : t),
              agentAlerts: d.agentAlerts.map(a => a.id === alertId ? { ...a, status: 'resolved' as const } : a),
              activityLogs: [
                createActivityLog({
                  action: 'task_completed',
                  title: `Tarefa concluída via Dashboard`,
                  description: `Tarefa resolvida direto pelo painel operacional.`,
                  projectId: '', clientId: '', campaignId: '', receivableId: '', taskId,
                }),
                ...d.activityLogs,
              ],
            }));
          };

          const logCampaignOptimization = (campaignId: string, alertId: string) => {
            const now = new Date().toISOString();
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 3);
            updateData((d) => ({
              ...d,
              campaigns: d.campaigns.map(c => c.id === campaignId ? {
                ...c,
                lastOptimizedAt: now,
                updatedAt: now,
                lastActivityAt: now,
                nextAction: `Próxima revisão: ${nextDate.toLocaleDateString('pt-BR')}`,
              } : c),
              agentAlerts: d.agentAlerts.map(a => a.id === alertId ? { ...a, status: 'resolved' as const } : a),
              activityLogs: [
                createActivityLog({
                  action: 'campaign_status_changed',
                  title: `Otimização registrada via Dashboard`,
                  description: `Campanha otimizada. Próxima revisão agendada para ${nextDate.toLocaleDateString('pt-BR')}.`,
                  projectId: '', clientId: '', campaignId, receivableId: '', taskId: '',
                }),
                ...d.activityLogs,
              ],
            }));
          };

          const updateProjectActivity = (projectId: string, alertId: string) => {
            const now = new Date().toISOString();
            updateData((d) => ({
              ...d,
              projects: d.projects.map(p => p.id === projectId ? {
                ...p,
                updatedAt: now,
                lastActivityAt: now,
              } : p),
              agentAlerts: d.agentAlerts.map(a => a.id === alertId ? { ...a, status: 'resolved' as const } : a),
              activityLogs: [
                createActivityLog({
                  action: 'project_updated',
                  title: `Projeto atualizado via Dashboard`,
                  description: `Atividade registrada direto pelo painel operacional.`,
                  projectId, clientId: '', campaignId: '', receivableId: '', taskId: '',
                }),
                ...d.activityLogs,
              ],
            }));
          };

          return (
            <div className={`mt-4 rounded-xl border p-4 ${color}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">{label} ({items.length})</h3>
                <button onClick={() => setExpandedCard(null)} className="text-xs text-brand-muted hover:text-white">✕ Fechar</button>
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-brand-muted text-center py-3">Nenhum item nesta categoria. ✅</p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {items.map(alert => {
                    const client = alert.clientId ? data.clients.find(c => c.id === alert.clientId) : null;
                    const relatedTask = alert.relatedEntityType === 'task' ? data.tasks.find(t => t.id === alert.relatedEntityId) : null;
                    const relatedCampaign = alert.relatedEntityType === 'campaign' ? data.campaigns.find(c => c.id === alert.relatedEntityId) : null;
                    const relatedProject = alert.relatedEntityType === 'project' ? data.projects.find(p => p.id === alert.relatedEntityId) : null;

                    return (
                      <div key={alert.id} className="rounded-lg border border-brand-line/50 bg-brand-surface/80 p-4">
                        <div className="flex items-start gap-3">
                          <ShieldAlert size={16} className="text-red-400 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-white">{alert.title}</span>
                              <span className="rounded-full bg-brand-surface px-2 py-0.5 text-[9px] font-bold uppercase text-brand-muted">{alert.relatedEntityType}</span>
                            </div>
                            <p className="text-xs text-brand-muted mt-1">{alert.message}</p>
                            {client && <p className="text-[10px] text-brand-soft mt-1">Cliente: {clientDisplayName(client)}</p>}

                            {/* === AÇÕES POR TIPO === */}

                            {/* TAREFA: Concluir ou reagendar */}
                            {relatedTask && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  onClick={() => completeTask(relatedTask.id, alert.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-brand-ink transition hover:brightness-110"
                                >
                                  <CheckCircle2 size={14} />
                                  Concluir tarefa
                                </button>
                                <button
                                  onClick={() => resolveAlert(alert.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-soft transition hover:text-white hover:border-brand-green"
                                >
                                  <Clock size={14} />
                                  Dispensar alerta
                                </button>
                              </div>
                            )}

                            {/* CAMPANHA: Registrar otimização + ir para campanhas */}
                            {relatedCampaign && (
                              <div className="mt-3 space-y-2">
                                <div className="flex items-center gap-3 text-xs text-brand-soft">
                                  <span>Última otimização: <strong className="text-white">{relatedCampaign.lastOptimizedAt ? new Date(relatedCampaign.lastOptimizedAt).toLocaleDateString('pt-BR') : 'Nunca'}</strong></span>
                                  <span>•</span>
                                  <span>Próxima ação: <strong className="text-white">{relatedCampaign.nextAction || 'Não definida'}</strong></span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => logCampaignOptimization(relatedCampaign.id, alert.id)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-brand-ink transition hover:brightness-110"
                                  >
                                    <CheckCircle2 size={14} />
                                    Registrar otimização feita
                                  </button>
                                  <button
                                    onClick={() => setActiveView('campaigns')}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-soft transition hover:text-white hover:border-brand-green"
                                  >
                                    <Megaphone size={14} />
                                    Abrir no Kanban
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* PROJETO: Atualizar atividade + ir para projetos */}
                            {relatedProject && (
                              <div className="mt-3 space-y-2">
                                <div className="flex items-center gap-3 text-xs text-brand-soft">
                                  <span>Prazo: <strong className={`${new Date(relatedProject.dueDate) < new Date() ? 'text-red-400' : 'text-white'}`}>{formatDate(relatedProject.dueDate)}</strong></span>
                                  <span>•</span>
                                  <span>Próxima ação: <strong className="text-white">{relatedProject.nextAction || 'Não definida'}</strong></span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => updateProjectActivity(relatedProject.id, alert.id)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-brand-ink transition hover:brightness-110"
                                  >
                                    <CheckCircle2 size={14} />
                                    Registrar atividade
                                  </button>
                                  <button
                                    onClick={() => setActiveView('projects')}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-soft transition hover:text-white hover:border-brand-green"
                                  >
                                    <Target size={14} />
                                    Abrir projetos
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* CLIENTE: Dispensar + ver cliente */}
                            {alert.relatedEntityType === 'client' && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  onClick={() => resolveAlert(alert.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-brand-ink transition hover:brightness-110"
                                >
                                  <CheckCircle2 size={14} />
                                  Resolver pendências
                                </button>
                                <button
                                  onClick={() => setActiveView('clients')}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-soft transition hover:text-white hover:border-brand-green"
                                >
                                  Ver cliente
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Campanhas Ativas</p>
            <p className="text-xl font-black text-white mt-1">{activeCampaigns.length}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Total Gasto</p>
            <p className="text-xl font-black text-white mt-1">{money(totalSpent)}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Impressões</p>
            <p className="text-xl font-black text-white mt-1">{totalImpressions.toLocaleString('pt-BR')}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Conversas</p>
            <p className="text-xl font-black text-brand-green mt-1">{formatNumber(trafficTotals.conversations)}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Custo/conversa</p>
            <p className="text-xl font-black text-white mt-1">{formatMoneyOrDash(trafficTotals.costPerConversation)}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">CPM / CTR</p>
            <p className="text-lg font-black text-white mt-1">{formatMoneyOrDash(trafficTotals.cpm)} <span className="text-xs text-brand-muted">/ {formatPercentOrDash(trafficTotals.ctr)}</span></p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Projetos Abertos</p>
            <p className="text-xl font-black text-white mt-1">{data.projects.filter(p => p.status !== 'done').length}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Tarefas Abertas</p>
            <p className="text-xl font-black text-white mt-1">{openTasks.length}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">A Receber</p>
            <p className="text-xl font-black text-brand-green mt-1">{money(amountToReceive)}</p>
          </div>
          <div className="rounded-xl border border-brand-line bg-brand-surface p-3">
            <p className="text-[10px] text-brand-muted uppercase font-semibold">Clientes Ativos</p>
            <p className="text-xl font-black text-white mt-1">{data.clients.filter(c => c.status === 'active').length}</p>
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Central do dia</p>
          <h1 className="mt-2 text-3xl font-black text-white">Esta é a operação agora.</h1>
          <p className="mt-2 text-brand-muted">Prioridades, cobranças, campanhas e projetos que precisam de decisão.</p>
        </div>
        <button onClick={() => setTaskModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
          <Plus size={18} />
          Nova tarefa rápida
        </button>
      </div>

      {/* ===== DASHBOARD POR CLIENTE ===== */}
      <div className="mb-8 rounded-2xl border border-brand-line bg-brand-ink p-5 shadow-lg">
        <div className="mb-5 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black text-white">
            <BarChart3 className="text-[#0064e0]" size={22} />
            Dashboard de Tráfego por Cliente
          </h2>
          <select 
            value={dashboardPeriod} 
            onChange={(e) => setDashboardPeriod(e.target.value)}
            className="rounded-lg border border-brand-line bg-brand-surface px-3 py-1.5 text-sm text-white outline-none focus:border-[#0064e0]"
          >
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="last_3d">Últimos 3 dias</option>
            <option value="last_7d">Últimos 7 dias</option>
            <option value="last_14d">Últimos 14 dias</option>
            <option value="last_30d">Últimos 30 dias</option>
            <option value="maximum">Desde o início</option>
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {activeMetaClientAnalytics.map((analytics) => {
            const client = analytics.client;
            const activeCampaigns = analytics.campaigns.map((summary) => summary.campaign);
            const hasNormalizedData = analytics.campaigns.some((summary) => Object.keys(summary.metrics).length > 0);

            if (!hasNormalizedData) {
              // Fallback legado
              let clientSpent = 0;
              let clientResults = 0;
              activeCampaigns.forEach(c => {
                const metrics = c.metricsByPeriod?.[dashboardPeriod] || (dashboardPeriod === 'maximum' ? c : { spent: 0, results: 0 });
                clientSpent += (metrics.spent || 0);
                clientResults += (metrics.results || 0);
              });
              
              return (
                <div key={client.id} className="rounded-xl border border-brand-line bg-brand-surface p-4 hover:border-[#0064e0]/50 transition">
                  <div className="mb-3 flex items-center justify-between border-b border-brand-line pb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white">{clientDisplayName(client)}</h3>
                      {client.metaAdAccountId && (
                        <button onClick={() => handleSyncClient(client)} disabled={syncingClientId === client.id} className="text-brand-muted hover:text-brand-green transition" title="Sincronizar com Facebook Ads">
                          <RefreshCw size={14} className={syncingClientId === client.id ? 'animate-spin text-brand-green' : ''} />
                        </button>
                      )}
                    </div>
                    <span className="rounded-full bg-[#0064e0]/10 px-2 py-0.5 text-xs font-semibold text-[#0064e0]">
                      {activeCampaigns.length} campanhas
                    </span>
                  </div>
                  <div className="text-center p-4">
                    <p className="text-sm text-brand-muted">Dados legados aguardando nova sincronização.</p>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-left">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Gasto Antigo</p>
                        <p className="font-bold text-white">{money(clientSpent)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Resultados Antigos</p>
                        <p className="font-bold text-white">{clientResults.toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={client.id} className="rounded-xl border border-brand-line bg-brand-surface p-4 hover:border-[#0064e0]/50 transition flex flex-col h-full">
                <div className="mb-3 flex flex-col gap-2 border-b border-brand-line pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white">{clientDisplayName(client)}</h3>
                      {client.metaAdAccountId && (
                        <button onClick={() => handleSyncClient(client)} disabled={syncingClientId === client.id} className="text-brand-muted hover:text-brand-green transition" title="Sincronizar com Facebook Ads">
                          <RefreshCw size={14} className={syncingClientId === client.id ? 'animate-spin text-brand-green' : ''} />
                        </button>
                      )}
                    </div>
                    <span className="rounded-full bg-[#0064e0]/10 px-2 py-0.5 text-xs font-semibold text-[#0064e0]">
                      {activeCampaigns.length} campanhas
                    </span>
                  </div>
                  
                  {activeCampaigns[0]?.lastSyncedAt && (
                     <div className="text-[10px] text-brand-muted">
                       Última sincronização: {new Date(activeCampaigns[0].lastSyncedAt).toLocaleString('pt-BR')}
                     </div>
                  )}
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[300px] pr-2">
                  <div className="rounded-lg border border-brand-line/50 bg-brand-ink/60 p-3">
                    <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                      <MetaMini label="Investido" value={money(analytics.totals.spend)} />
                      <MetaMini label="Conversas" value={formatNumber(analytics.totals.conversations)} />
                      <MetaMini label="Custo/conv." value={formatMoneyOrDash(analytics.totals.costPerConversation)} />
                      <MetaMini label="CPM" value={formatMoneyOrDash(analytics.totals.cpm)} />
                    </div>
                    {(analytics.bestCampaign || analytics.bestAdSet) && (
                      <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                        {analytics.bestCampaign && (
                          <div className="rounded bg-brand-surface p-2">
                            <p className="text-[10px] uppercase text-brand-muted">Melhor campanha</p>
                            <p className="truncate font-bold text-white" title={analytics.bestCampaign.campaign.name}>{analytics.bestCampaign.campaign.name}</p>
                            <p className="text-brand-soft">{analytics.bestCampaign.primary.label}: {formatNumber(analytics.bestCampaign.primary.value)} • {analytics.bestCampaign.primary.costLabel}: {formatMoneyOrDash(analytics.bestCampaign.primary.cost)}</p>
                          </div>
                        )}
                        {analytics.bestAdSet && (
                          <div className="rounded bg-brand-surface p-2">
                            <p className="text-[10px] uppercase text-brand-muted">Melhor grupo</p>
                            <p className="truncate font-bold text-white" title={analytics.bestAdSet.title}>{analytics.bestAdSet.title}</p>
                            <p className="text-brand-soft">{analytics.bestAdSet.primary.label}: {formatNumber(analytics.bestAdSet.primary.value)} • {analytics.bestAdSet.primary.costLabel}: {formatMoneyOrDash(analytics.bestAdSet.primary.cost)}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {analytics.campaigns.map(({ campaign: c }) => {
                    return (
                      <div key={c.id} className="border border-brand-line/50 rounded-lg p-3 bg-brand-ink/50">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-bold text-white truncate max-w-[200px]" title={c.name}>{c.name}</h4>
                          <span className="text-[10px] font-mono text-brand-muted">{c.metaStatus}</span>
                        </div>
                        <CampaignObjectiveBlocks campaign={c} period={dashboardPeriod} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          
          {activeMetaClientAnalytics.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-brand-line p-8 text-center text-brand-muted">
              Nenhum cliente com campanhas ativas no momento.
            </div>
          )}
        </div>
      </div>

      
      <Modal title="Nova tarefa" description="Registre uma ação rápida para acompanhar na central do dia." open={taskModalOpen} onClose={() => setTaskModalOpen(false)}>
        <form onSubmit={addTask} className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Tipo de Tarefa</span>
              <select 
                name="taskType" 
                value={taskType} 
                onChange={(e) => setTaskType(e.target.value as TaskType)}
                className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green"
              >
                <option value="otimizacao">Otimização</option>
                <option value="novo_projeto">Início de novo projeto</option>
                <option value="novo_cliente">Início de novo cliente</option>
                <option value="outro">Outro</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Área</span>
              <select 
                name="area" 
                value={taskArea}
                onChange={(e) => setTaskArea(e.target.value as TaskArea)}
                className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green"
              >
                <option value="tráfego">Tráfego Pago</option>
                <option value="site">Site / Web</option>
                <option value="financeiro">Financeiro</option>
                <option value="geral">Geral</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Cliente (Opcional)</span>
            <select 
              name="clientId" 
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green"
            >
              <option value="">Selecione o cliente...</option>
              {data.clients.map(c => (
                <option key={c.id} value={c.id}>{clientDisplayName(c)}</option>
              ))}
            </select>
          </label>

          {showCampaignSelector && (
            <label className="block animate-in fade-in slide-in-from-top-2 duration-300">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Vincular a qual campanha?</span>
              <select 
                name="campaignId" 
                className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green"
              >
                {clientCampaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="new">Criar uma nova campanha (+)</option>
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">O que será feito? (Título da tarefa)</span>
            <input name="title" required className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Data</span>
              <input name="dueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
            <div className="flex flex-col justify-end pb-2">
              <label className="flex cursor-pointer items-center gap-3">
                <input 
                  type="checkbox" 
                  checked={hasFinance} 
                  onChange={(e) => setHasFinance(e.target.checked)}
                  className="h-5 w-5 rounded border-brand-line bg-brand-surface accent-brand-green focus:ring-brand-green" 
                />
                <span className="text-sm font-semibold text-white">Envolve financeiro?</span>
              </label>
            </div>
          </div>

          {hasFinance && (
            <label className="block animate-in fade-in slide-in-from-top-2 duration-300">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Valor (R$)</span>
              <input 
                name="financeAmount" 
                required 
                placeholder="R$ 0,00"
                className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" 
              />
            </label>
          )}

          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button type="button" onClick={() => { setTaskModalOpen(false); setHasFinance(false); }} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft transition-colors hover:bg-brand-surface hover:text-white">Cancelar</button>
            <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink transition-transform hover:scale-105">Salvar tarefa</button>
          </div>
        </form>
      </Modal>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Megaphone} label="Campanhas ativas" value={activeCampaigns.length.toString()} />
        <Metric icon={AlertTriangle} label="Alertas" value={insights.filter((item) => item.level !== 'good').length.toString()} tone="warning" />
        <Metric icon={Banknote} label="A receber" value={money(amountToReceive)} />
        <Metric icon={Target} label="Projetos abertos" value={data.projects.filter((item) => item.status !== 'done').length.toString()} />
      </div>

      <div className="mt-8 grid gap-6 2xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Panel title="Prioridades do assistente" button="Ver inteligência" onClick={() => setActiveView('intelligence')}>
            <div className="space-y-3">
              {insights.slice(0, 4).map((insight) => (
                <div key={insight.id} className="rounded-lg border border-brand-line bg-brand-surface p-4">
                  <p className="font-semibold text-white">{insight.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-brand-muted">{insight.description}</p>
                  <p className="mt-3 text-sm font-semibold text-brand-green">{insight.recommendation}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Campanhas para olhar primeiro" button="Abrir campanhas" onClick={() => setActiveView('campaigns')}>
            <div className="grid gap-3 md:grid-cols-2">
              {priorityCampaigns.map((campaign) => {
                const client = data.clients.find((item) => item.id === campaign.clientId);
                const percent = campaign.budget ? Math.min(100, Math.round((campaign.spent / campaign.budget) * 100)) : 0;
                return (
                  <div key={campaign.id} className="rounded-lg border border-brand-line bg-brand-surface p-4">
                    <p className="text-xs text-brand-muted">{clientDisplayName(client)}</p>
                    <h3 className="mt-1 font-bold text-white">{campaign.name}</h3>
                    <p className="mt-2 text-sm text-brand-muted">{campaign.nextAction}</p>
                    <div className="mt-4 h-2 rounded-full bg-brand-surface2">
                      <div className="h-2 rounded-full bg-brand-green" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Tarefas abertas" button="Projetos" onClick={() => setActiveView('projects')}>
            <div className="space-y-2">
              {openTasks.slice(0, 7).map((task) => (
                <button key={task.id} onClick={() => toggleTask(task)} className="flex w-full items-center gap-3 rounded-lg border border-brand-line bg-brand-surface p-3 text-left">
                  <CheckCircle2 className="text-brand-muted" size={18} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{task.title}</p>
                    <p className="text-xs text-brand-muted">{formatDate(task.dueDate)} • {task.area}</p>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Recebimentos próximos" button="Meu financeiro" onClick={() => setActiveView('personalFinance')}>
            <div className="space-y-3">
              {pendingPayments.map((item) => {
                const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
                return (
                  <div key={item.id} className="flex items-center justify-between rounded-lg bg-brand-surface p-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{clientDisplayName(client)}</p>
                      <p className="text-xs text-brand-muted">{formatDate(item.dueDate)} • {item.status}</p>
                    </div>
                    <p className="text-sm font-bold text-brand-green">{money(item.amount)}</p>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
    : '—';
}

function formatMoneyOrDash(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? money(value) : '—';
}

function formatPercentOrDash(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
}

function MetaMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className="font-mono font-bold text-white">{value}</p>
    </div>
  );
}

const Metric = ({ icon: Icon, label, value, tone = 'default' }: { icon: typeof Target; label: string; value: string; tone?: 'default' | 'warning' }) => (
  <div className="rounded-xl border border-brand-line bg-brand-surface p-5">
    <div className="flex items-center justify-between">
      <p className="text-sm text-brand-muted">{label}</p>
      <Icon className={tone === 'warning' ? 'text-amber-300' : 'text-brand-green'} size={19} />
    </div>
    <p className="mt-4 text-2xl font-black text-white">{value}</p>
  </div>
);

const Panel = ({ title, button, onClick, children }: { title: string; button: string; onClick: () => void; children: React.ReactNode }) => (
  <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <button onClick={onClick} className="text-sm font-semibold text-brand-green hover:underline">{button}</button>
    </div>
    {children}
  </div>
);
