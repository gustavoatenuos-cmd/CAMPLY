import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CheckSquare2,
  Megaphone,
  Users,
} from 'lucide-react';
import type { ViewId } from '../../types';

function QuickMetric({ icon: Icon, label, value, onClick }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number | string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-xl border border-white/[0.04] bg-brand-surface2/30 p-3 text-left transition hover:border-brand-green/30 hover:shadow-[0_0_15px_rgba(0,229,153,0.1)]"
    >
      <div className="flex w-full items-center justify-between">
        <Icon size={16} className="text-brand-green drop-shadow-[0_0_4px_rgba(0,229,153,0.6)]" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-brand-muted">{label}</p>
        <p className="mt-0.5 text-lg font-bold text-white drop-shadow-md">{value}</p>
      </div>
    </motion.button>
  );
}

export function QuickMetrics({
  activeClients,
  activeCampaigns,
  openTasks,
  openProjects,
  activeAlerts,
  pendingReceivablesFormat,
  setActiveView,
}: {
  activeClients: number;
  activeCampaigns: number;
  openTasks: number;
  openProjects: number;
  activeAlerts: number;
  pendingReceivablesFormat: string;
  setActiveView: (view: ViewId) => void;
}) {
  return (
    <article className="glass-card rounded-2xl p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Operação de hoje</p>
      <h2 className="mt-1 text-xl font-black text-white">Visibilidade rápida do sistema</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <QuickMetric icon={Users} label="Clientes ativos" value={activeClients} onClick={() => setActiveView('clients')} />
        <QuickMetric icon={Megaphone} label="Campanhas ativas" value={activeCampaigns} onClick={() => setActiveView('campaigns')} />
        <QuickMetric icon={CheckSquare2} label="Tarefas abertas" value={openTasks} onClick={() => setActiveView('projects')} />
        <QuickMetric icon={BriefcaseBusiness} label="Projetos abertos" value={openProjects} onClick={() => setActiveView('projects')} />
        <QuickMetric icon={AlertTriangle} label="Alertas ativos" value={activeAlerts} onClick={() => setActiveView('intelligence')} />
        <QuickMetric icon={Banknote} label="A receber" value={pendingReceivablesFormat} onClick={() => setActiveView('personalFinance')} />
      </div>
    </article>
  );
}
