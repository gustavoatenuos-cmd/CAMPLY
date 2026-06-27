import { Banknote, BriefcaseBusiness, CalendarCheck, Columns3, History, Landmark, Settings, Sparkles, Users, BotMessageSquare, Facebook, LogOut } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { ViewId } from '../types';

const items = [
  { id: 'today', label: 'Hoje', icon: CalendarCheck },
  { id: 'agentChat', label: 'Chat IA (Voz)', icon: BotMessageSquare },
  { id: 'campaigns', label: 'Campanhas', icon: Columns3 },
  { id: 'creativeCritic', label: 'Lab. Criativo', icon: Sparkles },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'mediaFinance', label: 'Verbas de mídia', icon: Banknote },
  { id: 'projects', label: 'Projetos', icon: BriefcaseBusiness },
  { id: 'personalFinance', label: 'Meu financeiro', icon: Landmark },
  { id: 'activity', label: 'Histórico', icon: History },
  { id: 'intelligence', label: 'Inteligência', icon: Sparkles },
  { id: 'agentSettings', label: 'Config. Agente', icon: Settings },
  { id: 'metaIntegration', label: 'Integração Meta', icon: Facebook },
] satisfies Array<{ id: ViewId; label: string; icon: typeof CalendarCheck }>;

interface SidebarProps {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  alertCount: number;
  onSignOut: () => void;
}

export function Sidebar({ activeView, setActiveView, alertCount, onSignOut }: SidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-brand-line bg-brand-ink xl:h-screen xl:w-72 xl:border-b-0 xl:border-r">
      <div className="border-b border-brand-line p-3 sm:p-4 xl:p-5">
        <BrandLogo inverted />
      </div>

      <nav className="flex gap-2 overflow-x-auto p-2 xl:block xl:flex-1 xl:space-y-1 xl:overflow-x-visible xl:p-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`flex min-w-[132px] shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition xl:w-full xl:min-w-0 xl:justify-between xl:gap-0 xl:py-3 ${
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

      <div className="border-t border-brand-line p-2 xl:p-4">
        <button onClick={onSignOut} className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-muted transition hover:bg-white/5 hover:text-white xl:justify-start">
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </aside>
  );
}
