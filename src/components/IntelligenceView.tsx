import { AlertTriangle, CheckCircle2, ShieldAlert, Bell, TrendingUp, Sparkles, Users, Megaphone, BriefcaseBusiness, ListChecks } from 'lucide-react';
import { CamplyData, Insight, AgentAlert } from '../types';
import { useState } from 'react';

interface IntelligenceViewProps {
  data: CamplyData;
  insights: Insight[];
}

type FilterType = 'all' | 'critical' | 'warning' | 'client' | 'campaign' | 'project' | 'task';

export function IntelligenceView({ data, insights }: IntelligenceViewProps) {
  const [filter, setFilter] = useState<FilterType>('all');

  const openTasks = data.tasks.filter((task) => !task.done).length;
  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status)).length;

  const allAlerts = data.agentAlerts || [];
  const activeAlerts = allAlerts.filter(a => a.status === 'active');

  // Filter logic
  const filteredAlerts = allAlerts.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'critical') return a.severity === 'critical';
    if (filter === 'warning') return a.severity === 'warning';
    if (filter === 'client') return a.relatedEntityType === 'client';
    if (filter === 'campaign') return a.relatedEntityType === 'campaign';
    if (filter === 'project') return a.relatedEntityType === 'project';
    if (filter === 'task') return a.relatedEntityType === 'task';
    return true;
  });

  // Group by client
  const alertsByClient = new Map<string, AgentAlert[]>();
  activeAlerts.forEach(a => {
    const key = a.clientId || 'sem-cliente';
    if (!alertsByClient.has(key)) alertsByClient.set(key, []);
    alertsByClient.get(key)!.push(a);
  });

  const clientGroups = Array.from(alertsByClient.entries())
    .map(([clientId, alerts]) => {
      const client = data.clients.find(c => c.id === clientId);
      return { clientId, clientName: client ? (client.projectId || client.company || client.name) : 'Sem cliente', alerts };
    })
    .sort((a, b) => b.alerts.length - a.alerts.length);

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Inteligência Camply</p>
        <h1 className="mt-1 text-2xl font-black text-white">Central do Agente Operacional</h1>
        <p className="mt-1 text-sm text-brand-muted">Monitoramento inteligente de campanhas, projetos, tarefas e clientes.</p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Signal icon={ShieldAlert} label="Alertas ativos" value={activeAlerts.length.toString()} color="text-red-400" />
        <Signal icon={CheckCircle2} label="Tarefas abertas" value={openTasks.toString()} color="text-brand-green" />
        <Signal icon={TrendingUp} label="Campanhas ativas" value={activeCampaigns.toString()} color="text-sky-400" />
        <Signal icon={Users} label="Clientes com alerta" value={clientGroups.filter(g => g.clientId !== 'sem-cliente').length.toString()} color="text-amber-400" />
      </div>

      {/* Grouped by Client */}
      {clientGroups.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase text-brand-muted border-b border-brand-line pb-2">
            <Users size={16} />
            Alertas Agrupados por Cliente
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clientGroups.map(group => (
              <div key={group.clientId} className="rounded-xl border border-brand-line bg-brand-ink p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-white text-sm truncate">{group.clientName}</h3>
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">{group.alerts.length}</span>
                </div>
                <div className="space-y-2">
                  {group.alerts.slice(0, 3).map(alert => (
                    <div key={alert.id} className="flex items-center gap-2 text-xs">
                      {alert.severity === 'critical' ? <ShieldAlert size={12} className="text-red-400 shrink-0" /> : <AlertTriangle size={12} className="text-amber-400 shrink-0" />}
                      <span className="text-brand-muted truncate">{alert.title}</span>
                    </div>
                  ))}
                  {group.alerts.length > 3 && (
                    <p className="text-[10px] text-brand-muted">+ {group.alerts.length - 3} mais</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: 'Todos', icon: Sparkles },
          { key: 'critical', label: 'Críticos', icon: ShieldAlert },
          { key: 'warning', label: 'Atenção', icon: AlertTriangle },
          { key: 'campaign', label: 'Campanhas', icon: Megaphone },
          { key: 'project', label: 'Projetos', icon: BriefcaseBusiness },
          { key: 'task', label: 'Tarefas', icon: ListChecks },
          { key: 'client', label: 'Clientes', icon: Users },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              filter === tab.key ? 'bg-brand-green text-brand-ink' : 'bg-brand-surface text-brand-soft hover:text-white'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-brand-muted uppercase border-b border-brand-line pb-2">
          Central de Notificações ({filteredAlerts.length})
        </h2>
        {filteredAlerts.length === 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-brand-green/30 bg-brand-green/5 p-6 justify-center">
            <CheckCircle2 className="text-brand-green" size={20} />
            <p className="text-sm text-white">Nenhum alerta nesta categoria. Operação limpa! 🎯</p>
          </div>
        )}
        {filteredAlerts.map((alert) => (
          <article key={alert.id} className={`rounded-xl border bg-brand-ink p-5 ${alertBorderFor(alert.severity)} ${alert.status !== 'active' ? 'opacity-40' : ''}`}>
            <div className="flex gap-4">
              <div className={`mt-1 rounded-lg p-2 shrink-0 ${alertIconFor(alert.severity)}`}>
                {alert.severity === 'critical' ? <ShieldAlert size={20} /> : <Bell size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-bold uppercase text-brand-soft">
                      {alert.relatedEntityType}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      alert.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-400/10 text-amber-400'
                    }`}>
                      {alert.severity === 'critical' ? 'Crítico' : 'Atenção'}
                    </span>
                    {alert.status !== 'active' && (
                      <span className="rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-bold uppercase text-brand-muted">
                        {alert.status === 'dismissed' ? 'Dispensado' : 'Resolvido'}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-brand-muted bg-brand-surface px-2 py-1 rounded-md shrink-0">
                    {new Date(alert.triggeredAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-bold text-white">{alert.title}</h2>
                <p className="mt-2 leading-relaxed text-brand-muted">{alert.message}</p>
                {alert.suggestedAction && (
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-brand-surface p-3 text-sm">
                    <span className="font-semibold text-brand-green">💡 {alert.suggestedAction}</span>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Legacy Insights (dimmed) */}
      {insights.length > 0 && (
        <div className="space-y-4 mt-8 opacity-40">
          <h2 className="text-sm font-bold text-brand-muted uppercase border-b border-brand-line pb-2">Insights Gerais (Legado)</h2>
          {insights.map((insight) => (
            <article key={insight.id} className={`rounded-xl border bg-brand-ink p-5 ${borderFor(insight.level)}`}>
              <div className="flex gap-4">
                <div className={`mt-1 rounded-lg p-2 ${iconFor(insight.level)}`}>
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Recomendação</p>
                  <h2 className="mt-1 text-lg font-bold text-white">{insight.title}</h2>
                  <p className="mt-2 leading-relaxed text-brand-muted">{insight.description}</p>
                  <p className="mt-4 rounded-lg bg-brand-surface p-3 text-sm font-semibold text-brand-green">{insight.recommendation}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Signal({ icon: Icon, label, value, color }: { icon: typeof Sparkles; label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-muted">{label}</p>
        <Icon className={color || 'text-brand-green'} size={19} />
      </div>
      <p className="mt-4 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

const borderFor = (level: Insight['level']) => {
  if (level === 'critical') return 'border-rose-500/40';
  if (level === 'warning') return 'border-amber-400/40';
  if (level === 'good') return 'border-brand-green/40';
  return 'border-sky-400/40';
};

const iconFor = (level: Insight['level']) => {
  if (level === 'critical') return 'bg-rose-500/10 text-rose-400';
  if (level === 'warning') return 'bg-amber-400/10 text-amber-300';
  if (level === 'good') return 'bg-brand-green/10 text-brand-green';
  return 'bg-sky-400/10 text-sky-300';
};

const alertBorderFor = (severity: AgentAlert['severity']) => {
  if (severity === 'critical') return 'border-rose-500/40';
  if (severity === 'warning') return 'border-amber-400/40';
  if (severity === 'good') return 'border-brand-green/40';
  return 'border-sky-400/40';
};

const alertIconFor = (severity: AgentAlert['severity']) => {
  if (severity === 'critical') return 'bg-rose-500/10 text-rose-400';
  if (severity === 'warning') return 'bg-amber-400/10 text-amber-300';
  if (severity === 'good') return 'bg-brand-green/10 text-brand-green';
  return 'bg-sky-400/10 text-sky-300';
};
