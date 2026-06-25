import { AlertTriangle, Banknote, CheckCircle2, Megaphone, Plus, Target } from 'lucide-react';
import { daysUntil, formatDate, makeId, money } from '../data/camplyStore';
import { CamplyData, Insight, Task, ViewId } from '../types';

interface TodayViewProps {
  data: CamplyData;
  insights: Insight[];
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
  setActiveView: (view: ViewId) => void;
}

export function TodayView({ data, insights, updateData, setActiveView }: TodayViewProps) {
  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status));
  const pendingPayments = data.receivables.filter((receivable) => receivable.status !== 'paid');
  const openTasks = data.tasks.filter((task) => !task.done).sort((a, b) => daysUntil(a.dueDate) - daysUntil(b.dueDate));
  const priorityCampaigns = data.campaigns.filter((campaign) => campaign.priority === 'high' || campaign.status === 'optimize');
  const amountToReceive = pendingPayments.reduce((sum, item) => sum + item.amount, 0);

  const toggleTask = (task: Task) => {
    updateData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, done: !item.done } : item)),
    }));
  };

  const addTask = () => {
    const title = window.prompt('Qual tarefa você quer lembrar?');
    if (!title) return;
    updateData((current) => ({
      ...current,
      tasks: [
        {
          id: makeId('task'),
          title,
          dueDate: new Date().toISOString().slice(0, 10),
          area: 'campanhas',
          done: false,
        },
        ...current.tasks,
      ],
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-400">Central do dia</p>
          <h1 className="mt-2 text-3xl font-black text-white">Gustavo, esta é sua operação agora.</h1>
          <p className="mt-2 text-slate-400">Prioridades, cobranças, campanhas e projetos que precisam de decisão.</p>
        </div>
        <button onClick={addTask} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950">
          <Plus size={18} />
          Nova tarefa rápida
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Megaphone} label="Campanhas ativas" value={activeCampaigns.length.toString()} />
        <Metric icon={AlertTriangle} label="Alertas" value={insights.filter((item) => item.level !== 'good').length.toString()} tone="warning" />
        <Metric icon={Banknote} label="A receber" value={money(amountToReceive)} />
        <Metric icon={Target} label="Projetos abertos" value={data.projects.filter((item) => item.status !== 'done').length.toString()} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Panel title="Prioridades do assistente" button="Ver inteligência" onClick={() => setActiveView('intelligence')}>
            <div className="space-y-3">
              {insights.slice(0, 4).map((insight) => (
                <div key={insight.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                  <p className="font-semibold text-white">{insight.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{insight.description}</p>
                  <p className="mt-3 text-sm font-semibold text-emerald-400">{insight.recommendation}</p>
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
                  <div key={campaign.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                    <p className="text-xs text-slate-500">{client?.name}</p>
                    <h3 className="mt-1 font-bold text-white">{campaign.name}</h3>
                    <p className="mt-2 text-sm text-slate-400">{campaign.nextAction}</p>
                    <div className="mt-4 h-2 rounded-full bg-slate-800">
                      <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${percent}%` }} />
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
                <button key={task.id} onClick={() => toggleTask(task)} className="flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3 text-left">
                  <CheckCircle2 className="text-slate-500" size={18} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{task.title}</p>
                    <p className="text-xs text-slate-500">{formatDate(task.dueDate)} • {task.area}</p>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Recebimentos próximos" button="Financeiro" onClick={() => setActiveView('finance')}>
            <div className="space-y-3">
              {pendingPayments.map((item) => {
                const client = data.clients.find((clientItem) => clientItem.id === item.clientId);
                return (
                  <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{client?.name}</p>
                      <p className="text-xs text-slate-500">{formatDate(item.dueDate)} • {item.status}</p>
                    </div>
                    <p className="text-sm font-bold text-emerald-400">{money(item.amount)}</p>
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
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex items-center justify-between">
      <p className="text-sm text-slate-400">{label}</p>
      <Icon className={tone === 'warning' ? 'text-amber-300' : 'text-emerald-400'} size={19} />
    </div>
    <p className="mt-4 text-2xl font-black text-white">{value}</p>
  </div>
);

const Panel = ({ title, button, onClick, children }: { title: string; button: string; onClick: () => void; children: React.ReactNode }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <button onClick={onClick} className="text-sm font-semibold text-emerald-400 hover:underline">{button}</button>
    </div>
    {children}
  </div>
);
