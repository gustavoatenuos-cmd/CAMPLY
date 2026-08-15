import {
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ListChecks,
  Megaphone,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import type { AgentAlert, CamplyData } from '../types';

interface IntelligenceViewProps {
  data: CamplyData;
}

type FilterType = 'all' | 'critical' | 'warning' | 'client' | 'campaign' | 'project' | 'task';

export function IntelligenceView({ data }: IntelligenceViewProps) {
  const [filter, setFilter] = useState<FilterType>('all');
  const openTasks = data.tasks.filter((task) => !task.done).length;
  const activeCampaigns = data.campaigns.filter((campaign) =>
    ['launching', 'live', 'optimize'].includes(campaign.status)
  ).length;
  const activeAlerts = data.agentAlerts.filter((alert) => alert.status === 'active');

  const filteredAlerts = data.agentAlerts.filter((alert) => {
    if (filter === 'all') return true;
    if (filter === 'critical') return alert.severity === 'critical';
    if (filter === 'warning') return alert.severity === 'warning';
    return alert.relatedEntityType === filter;
  });

  const alertsByClient = new Map<string, AgentAlert[]>();
  activeAlerts.forEach((alert) => {
    const key = alert.clientId || 'sem-cliente';
    const current = alertsByClient.get(key) || [];
    current.push(alert);
    alertsByClient.set(key, current);
  });

  const clientGroups = Array.from(alertsByClient.entries())
    .map(([clientId, alerts]) => ({
      clientId,
      clientName: data.clients.find((client) => client.id === clientId)?.name || 'Sem cliente',
      alerts,
    }))
    .sort((a, b) => b.alerts.length - a.alerts.length);

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Inteligência Camply</p>
        <h1 className="mt-1 text-2xl font-black text-white">Central Operacional</h1>
        <p className="mt-1 max-w-3xl text-sm text-brand-muted">
          Pendências do workspace e rotina de gestão. A leitura de performance, metas e orçamento permanece no Analytics, usando somente a base confiável da Meta.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Signal icon={ShieldAlert} label="Alertas ativos" value={activeAlerts.length.toString()} color="text-red-400" />
        <Signal icon={CheckCircle2} label="Tarefas abertas" value={openTasks.toString()} color="text-brand-green" />
        <Signal icon={TrendingUp} label="Campanhas em gestão" value={activeCampaigns.toString()} color="text-sky-400" />
        <Signal icon={Users} label="Clientes com alerta" value={clientGroups.filter((group) => group.clientId !== 'sem-cliente').length.toString()} color="text-amber-400" />
      </div>

      {clientGroups.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center gap-2 border-b border-brand-line pb-2 text-sm font-bold uppercase text-brand-muted">
            <Users size={16} /> Alertas por cliente
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {clientGroups.map((group) => (
              <div key={group.clientId} className="rounded-xl border border-brand-line bg-brand-ink p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="truncate text-sm font-bold text-white">{group.clientName}</h3>
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">{group.alerts.length}</span>
                </div>
                <div className="space-y-2">
                  {group.alerts.slice(0, 3).map((alert) => (
                    <div key={alert.id} className="flex items-center gap-2 text-xs">
                      {alert.severity === 'critical' ? (
                        <ShieldAlert size={12} className="shrink-0 text-red-400" />
                      ) : (
                        <AlertTriangle size={12} className="shrink-0 text-amber-400" />
                      )}
                      <span className="truncate text-brand-muted">{alert.title}</span>
                    </div>
                  ))}
                  {group.alerts.length > 3 ? <p className="text-[10px] text-brand-muted">+ {group.alerts.length - 3} mais</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: 'Todos', icon: Sparkles },
          { key: 'critical', label: 'Críticos', icon: ShieldAlert },
          { key: 'warning', label: 'Atenção', icon: AlertTriangle },
          { key: 'campaign', label: 'Campanhas', icon: Megaphone },
          { key: 'project', label: 'Projetos', icon: BriefcaseBusiness },
          { key: 'task', label: 'Tarefas', icon: ListChecks },
          { key: 'client', label: 'Clientes', icon: Users },
        ] as const).map((tab) => (
          <button
            type="button"
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              filter === tab.key ? 'bg-brand-green text-brand-ink' : 'bg-brand-surface text-brand-soft hover:text-white'
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="border-b border-brand-line pb-2 text-sm font-bold uppercase text-brand-muted">
          Sinais operacionais ({filteredAlerts.length})
        </h2>
        {filteredAlerts.length === 0 ? (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-brand-green/30 bg-brand-green/5 p-6">
            <CheckCircle2 className="text-brand-green" size={20} />
            <p className="text-sm text-white">Nenhum sinal operacional nesta categoria.</p>
          </div>
        ) : null}
        {filteredAlerts.map((alert) => (
          <article
            key={alert.id}
            className={`rounded-xl border bg-brand-ink p-5 ${alertBorderFor(alert.severity)} ${alert.status !== 'active' ? 'opacity-40' : ''}`}
          >
            <div className="flex gap-4">
              <div className={`mt-1 shrink-0 rounded-lg p-2 ${alertIconFor(alert.severity)}`}>
                {alert.severity === 'critical' ? <ShieldAlert size={20} /> : <Bell size={20} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-bold uppercase text-brand-soft">
                      {alert.relatedEntityType}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      alert.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-400/10 text-amber-400'
                    }`}>
                      {alert.severity === 'critical' ? 'Crítico' : 'Atenção'}
                    </span>
                    {alert.status !== 'active' ? (
                      <span className="rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-bold uppercase text-brand-muted">
                        {alert.status === 'dismissed' ? 'Dispensado' : 'Resolvido'}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-md bg-brand-surface px-2 py-1 text-[10px] text-brand-muted">
                    {new Date(alert.triggeredAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-bold text-white">{alert.title}</h2>
                <p className="mt-2 leading-relaxed text-brand-muted">{alert.message}</p>
                {alert.suggestedAction ? (
                  <div className="mt-4 rounded-lg bg-brand-surface p-3 text-sm">
                    <span className="font-semibold text-brand-green">→ {alert.suggestedAction}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
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

function alertBorderFor(severity: AgentAlert['severity']) {
  if (severity === 'critical') return 'border-rose-500/40';
  if (severity === 'warning') return 'border-amber-400/40';
  if (severity === 'good') return 'border-brand-green/40';
  return 'border-sky-400/40';
}

function alertIconFor(severity: AgentAlert['severity']) {
  if (severity === 'critical') return 'bg-rose-500/10 text-rose-400';
  if (severity === 'warning') return 'bg-amber-400/10 text-amber-300';
  if (severity === 'good') return 'bg-brand-green/10 text-brand-green';
  return 'bg-sky-400/10 text-sky-300';
}
