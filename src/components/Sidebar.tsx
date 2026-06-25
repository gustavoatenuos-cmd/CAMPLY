import { Banknote, BriefcaseBusiness, CalendarCheck, Columns3, Sparkles, Users } from 'lucide-react';
import { ViewId } from '../types';

const items = [
  { id: 'today', label: 'Hoje', icon: CalendarCheck },
  { id: 'campaigns', label: 'Campanhas', icon: Columns3 },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'finance', label: 'Financeiro', icon: Banknote },
  { id: 'projects', label: 'Projetos', icon: BriefcaseBusiness },
  { id: 'intelligence', label: 'Inteligência', icon: Sparkles },
] satisfies Array<{ id: ViewId; label: string; icon: typeof CalendarCheck }>;

interface SidebarProps {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  alertCount: number;
}

export function Sidebar({ activeView, setActiveView, alertCount }: SidebarProps) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950">
      <div className="border-b border-slate-800 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 font-black text-slate-950">C</div>
          <div>
            <h1 className="text-xl font-black text-white">Camply</h1>
            <p className="text-xs text-slate-400">Do clique ao cliente</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium transition ${
              activeView === item.id ? 'bg-emerald-400 text-slate-950' : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <span className="flex items-center gap-3">
              <item.icon size={18} />
              {item.label}
            </span>
            {item.id === 'intelligence' && alertCount > 0 && (
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">{alertCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-4 text-xs leading-relaxed text-slate-400">
        Assistente para organizar campanhas, clientes, recebimentos e projetos do dia.
      </div>
    </aside>
  );
}
