import { Activity, CalendarDays, Filter, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { money } from '../data/camplyStore';
import { ActivityAction, ActivityLog, CamplyData } from '../types';
import { clientDisplayName, clientOptionLabel } from './ClientsView';

interface ActivityViewProps {
  data: CamplyData;
}

const actionLabels: Record<ActivityAction, string> = {
  client_created: 'Cliente criado',
  client_updated: 'Cliente editado',
  client_status_changed: 'Status do cliente',
  campaign_created: 'Campanha criada',
  campaign_status_changed: 'Status da campanha',
  task_created: 'Tarefa criada',
  task_completed: 'Tarefa concluída',
  task_reopened: 'Tarefa reaberta',
  receivable_created: 'Recebimento criado',
  receivable_status_changed: 'Status financeiro',
  project_created: 'Projeto criado',
  project_status_changed: 'Status do projeto',
  project_updated: 'Projeto atualizado',
};

const actionTones: Record<ActivityAction, string> = {
  client_created: 'bg-emerald-400/10 text-emerald-300',
  client_updated: 'bg-sky-400/10 text-sky-300',
  client_status_changed: 'bg-amber-400/10 text-amber-200',
  campaign_created: 'bg-emerald-400/10 text-emerald-300',
  campaign_status_changed: 'bg-amber-400/10 text-amber-200',
  task_created: 'bg-sky-400/10 text-sky-300',
  task_completed: 'bg-emerald-400/10 text-emerald-300',
  task_reopened: 'bg-amber-400/10 text-amber-200',
  receivable_created: 'bg-emerald-400/10 text-emerald-300',
  receivable_status_changed: 'bg-amber-400/10 text-amber-200',
  project_created: 'bg-emerald-400/10 text-emerald-300',
  project_status_changed: 'bg-amber-400/10 text-amber-200',
  project_updated: 'bg-sky-400/10 text-sky-300',
};

export function ActivityView({ data }: ActivityViewProps) {
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');

  const logs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return data.activityLogs
      .filter((log) => {
        const matchesQuery =
          !normalizedQuery ||
          [log.title, log.description, log.actor, actionLabels[log.action]].some((value) =>
            value.toLowerCase().includes(normalizedQuery),
          );
        const matchesAction = !action || log.action === action;
        const matchesProject = !projectId || log.projectId === projectId;
        const matchesClient = !clientId || log.clientId === clientId;

        return matchesQuery && matchesAction && matchesProject && matchesClient;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [action, clientId, data.activityLogs, projectId, query]);

  const todayCount = data.activityLogs.filter((log) => log.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const financialCount = data.activityLogs.filter((log) => log.action.startsWith('receivable')).length;

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Histórico</p>
          <h1 className="mt-1 text-2xl font-black text-white">Linha do tempo da operação</h1>
          <p className="mt-2 text-sm text-brand-muted">Tudo que foi criado, alterado, concluído ou recebido fica registrado aqui.</p>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Summary label="Registros totais" value={data.activityLogs.length.toString()} />
        <Summary label="Ações hoje" value={todayCount.toString()} />
        <Summary label="Movimentos financeiros" value={financialCount.toString()} highlight />
      </div>

      <div className="mb-6 rounded-xl border border-brand-line bg-brand-ink p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
          <Filter size={17} className="text-brand-green" />
          Filtros
        </div>
        <div className="grid gap-3 xl:grid-cols-[1.2fr_0.9fr_0.9fr_0.9fr]">
          <label className="flex items-center gap-2 rounded-lg border border-brand-line bg-brand-surface px-3 py-2">
            <Search size={16} className="text-brand-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar no histórico"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-brand-muted"
            />
          </label>
          <select value={action} onChange={(event) => setAction(event.target.value)} className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-white outline-none focus:border-brand-green">
            <option value="">Todos os tipos</option>
            {Object.entries(actionLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-white outline-none focus:border-brand-green">
            <option value="">Todos os projetos</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-white outline-none focus:border-brand-green">
            <option value="">Todos os clientes</option>
            {data.clients.map((client) => (
              <option key={client.id} value={client.id}>{clientOptionLabel(client, data.projects)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-line bg-brand-ink">
        <div className="border-b border-brand-line p-4">
          <h2 className="font-bold text-white">Registros encontrados</h2>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center">
            <Activity className="mx-auto text-brand-muted" size={28} />
            <p className="mt-3 font-semibold text-white">Nenhum registro ainda</p>
            <p className="mt-1 text-sm text-brand-muted">Quando você criar clientes, campanhas, tarefas, projetos ou recebimentos, o histórico aparece aqui.</p>
          </div>
        ) : (
          <div className="divide-y divide-brand-line">
            {logs.map((log) => (
              <ActivityRow key={log.id} log={log} data={data} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityRow({ log, data }: { log: ActivityLog; data: CamplyData }) {
  const project = data.projects.find((item) => item.id === log.projectId);
  const client = data.clients.find((item) => item.id === log.clientId);
  const campaign = data.campaigns.find((item) => item.id === log.campaignId);
  const receivable = data.receivables.find((item) => item.id === log.receivableId);
  const date = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(log.createdAt));

  return (
    <article className="grid gap-3 p-4 lg:grid-cols-[170px_1fr]">
      <div className="flex items-start gap-2 text-xs text-brand-muted">
        <CalendarDays size={15} className="mt-0.5 text-brand-green" />
        <span>{date}</span>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${actionTones[log.action]}`}>{actionLabels[log.action]}</span>
          <span className="text-xs text-brand-muted">por {log.actor}</span>
        </div>
        <h3 className="mt-2 font-bold text-white">{log.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-brand-muted">{log.description}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {project && <Tag label={`Projeto: ${project.name}`} />}
          {client && <Tag label={`Cliente: ${clientDisplayName(client)}`} />}
          {campaign && <Tag label={`Campanha: ${campaign.name}`} />}
          {receivable && <Tag label={`Valor: ${money(receivable.amount)}`} />}
        </div>
      </div>
    </article>
  );
}

function Summary({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <p className="text-sm text-brand-muted">{label}</p>
      <p className={`mt-3 text-2xl font-black ${highlight ? 'text-brand-green' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="rounded-full bg-brand-surface px-2.5 py-1 font-semibold text-brand-soft">{label}</span>;
}
