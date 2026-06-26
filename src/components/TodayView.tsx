import { AlertTriangle, Banknote, CheckCircle2, Megaphone, Plus, Target } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { createActivityLog, daysUntil, formatDate, makeId, money } from '../data/camplyStore';
import { BrandLogo } from './BrandLogo';
import { Modal } from './ui/Modal';
import { CamplyData, Insight, Task, ViewId } from '../types';

interface TodayViewProps {
  data: CamplyData;
  insights: Insight[];
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  setActiveView: (view: ViewId) => void;
}

export function TodayView({ data, insights, updateData, setActiveView }: TodayViewProps) {
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status));
  const pendingPayments = data.receivables.filter((receivable) => receivable.status !== 'paid');
  const openTasks = data.tasks.filter((task) => !task.done).sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));
  const priorityCampaigns = data.campaigns.filter((campaign) => campaign.priority === 'high' || campaign.status === 'optimize');
  const amountToReceive = pendingPayments.reduce((sum, item) => sum + item.amount, 0);

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
    const task: Task = {
      id: makeId('task'),
      title,
      dueDate: String(form.get('dueDate') ?? new Date().toISOString().slice(0, 10)),
      area: String(form.get('area') ?? 'campanhas') as Task['area'],
      done: false,
    };
    updateData((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      activityLogs: [
        createActivityLog({
          action: 'task_created',
          title: `Tarefa criada: ${task.title}`,
          description: `Nova tarefa adicionada para ${formatDate(task.dueDate)} na área de ${task.area}.`,
          projectId: '',
          clientId: '',
          campaignId: '',
          receivableId: '',
          taskId: task.id,
        }),
        ...current.activityLogs,
      ],
    }));
    setTaskModalOpen(false);
    event.currentTarget.reset();
  };

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-8 rounded-2xl border border-brand-line bg-brand-paper p-5 text-brand-ink shadow-brand">
        <BrandLogo />
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

      <Modal title="Nova tarefa" description="Registre uma ação rápida para acompanhar na central do dia." open={taskModalOpen} onClose={() => setTaskModalOpen(false)}>
        <form onSubmit={addTask} className="space-y-5 p-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Tarefa</span>
            <input name="title" required className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Área</span>
              <select name="area" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="campanhas">Campanhas</option>
                <option value="clientes">Clientes</option>
                <option value="financeiro">Financeiro</option>
                <option value="projetos">Projetos</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Data</span>
              <input name="dueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
            </label>
          </div>
          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button type="button" onClick={() => setTaskModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Cancelar</button>
            <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink">Salvar tarefa</button>
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
                    <p className="text-xs text-brand-muted">{client?.name}</p>
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
                      <p className="text-sm font-semibold text-white">{client?.name}</p>
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
