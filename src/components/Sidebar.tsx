import { Banknote, BriefcaseBusiness, CalendarCheck, Columns3, Landmark, Sparkles, Users } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { ViewId } from '../types';

const items = [
  { id: 'today', label: 'Hoje', icon: CalendarCheck },
  { id: 'campaigns', label: 'Campanhas', icon: Columns3 },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'mediaFinance', label: 'Verbas de mídia', icon: Banknote },
  { id: 'projects', label: 'Projetos', icon: BriefcaseBusiness },
  { id: 'personalFinance', label: 'Meu financeiro', icon: Landmark },
  { id: 'intelligence', label: 'Inteligência', icon: Sparkles },
] satisfies Array<{ id: ViewId; label: string; icon: typeof CalendarCheck }>;

interface SidebarProps {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  alertCount: number;
}

export function Sidebar({ activeView, setActiveView, alertCount }: SidebarProps) {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-brand-line bg-brand-ink">
      <div className="border-b border-brand-line p-5">
        <BrandLogo inverted />
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium transition ${
              activeView === item.id ? 'bg-brand-green text-brand-ink' : 'text-brand-soft hover:bg-white/5 hover:text-white'
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

      <div className="border-t border-brand-line p-4 text-xs leading-relaxed text-brand-muted">
        Assistente para organizar campanhas, clientes, recebimentos e projetos do dia.
      </div>
    </aside>
  );
}
