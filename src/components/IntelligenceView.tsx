import { AlertTriangle, CheckCircle2, Sparkles, TrendingUp, ShieldAlert, Bell, Info, Check, ExternalLink } from 'lucide-react';
import { CamplyData, Insight, AgentAlert } from '../types';

interface IntelligenceViewProps {
  data: CamplyData;
  insights: Insight[];
}

export function IntelligenceView({ data, insights }: IntelligenceViewProps) {
  const openTasks = data.tasks.filter((task) => !task.done).length;
  const activeCampaigns = data.campaigns.filter((campaign) => ['launching', 'live', 'optimize'].includes(campaign.status)).length;

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Inteligência Camply</p>
        <h1 className="mt-1 text-2xl font-black text-white">Recomendações operacionais</h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Signal icon={ShieldAlert} label="Alertas da IA" value={(data.agentAlerts || []).length.toString()} />
        <Signal icon={CheckCircle2} label="Tarefas abertas" value={openTasks.toString()} />
        <Signal icon={TrendingUp} label="Campanhas ativas" value={activeCampaigns.toString()} />
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-bold text-brand-muted uppercase mb-4 border-b border-brand-line pb-2">Central de Notificações do Agente</h2>
        {(!data.agentAlerts || data.agentAlerts.length === 0) && (
          <p className="text-brand-muted italic p-4 text-center border border-brand-line/50 rounded-xl">Nenhum alerta operacional gerado.</p>
        )}
        
        {data.agentAlerts?.map((alert) => (
          <article key={alert.id} className={`rounded-xl border bg-brand-ink p-5 ${alertBorderFor(alert.severity)}`}>
            <div className="flex gap-4">
              <div className={`mt-1 rounded-lg p-2 ${alertIconFor(alert.severity)}`}>
                {alert.severity === 'critical' ? <ShieldAlert size={20} /> : <Bell size={20} />}
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start">
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                    {alert.relatedEntityType}
                  </p>
                  <span className="text-[10px] text-brand-muted bg-brand-surface px-2 py-1 rounded-md">
                    {new Date(alert.triggeredAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-bold text-white">{alert.title}</h2>
                <p className="mt-2 leading-relaxed text-brand-muted">{alert.message}</p>
                {alert.suggestedAction && (
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-brand-surface p-3 text-sm">
                    <span className="font-semibold text-brand-green">{alert.suggestedAction}</span>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="space-y-4 mt-8 opacity-60">
        <h2 className="text-sm font-bold text-brand-muted uppercase mb-4 border-b border-brand-line pb-2">Insights Gerais</h2>
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
    </section>
  );
}

function Signal({ icon: Icon, label, value }: { icon: typeof Sparkles; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-muted">{label}</p>
        <Icon className="text-brand-green" size={19} />
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
