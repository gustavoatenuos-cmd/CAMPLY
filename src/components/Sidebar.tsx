import {
  Banknote,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Columns3,
  Facebook,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import type { ViewId } from '../types';

type NavItem = { id: ViewId; label: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: 'Visão',
    items: [
      { id: 'today', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'clientAnalytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Operação',
    items: [
      { id: 'campaigns', label: 'Campanhas', icon: Columns3 },
      { id: 'creativeCritic', label: 'Criativos', icon: Sparkles },
      { id: 'alertCenter', label: 'Alertas', icon: Bell },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { id: 'clients', label: 'Clientes', icon: Users },
      { id: 'mediaFinance', label: 'Verbas de mídia', icon: Banknote },
      { id: 'projects', label: 'Projetos', icon: BriefcaseBusiness },
      { id: 'personalFinance', label: 'Meu financeiro', icon: Landmark },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'activity', label: 'Histórico', icon: History },
      { id: 'intelligence', label: 'Inteligência', icon: Sparkles },
      { id: 'agentSettings', label: 'Configurações', icon: Settings },
      { id: 'metaIntegration', label: 'Integração Meta', icon: Facebook },
    ],
  },
];

interface SidebarProps {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  alertCount: number;
  onSignOut: () => void;
}

export function Sidebar({ activeView, setActiveView, alertCount, onSignOut }: SidebarProps) {
  return (
    <aside className="z-40 flex w-full shrink-0 flex-col border-b border-brand-line bg-[#0e1014] xl:sticky xl:top-0 xl:h-dvh xl:w-64 xl:border-b-0 xl:border-r">
      <div className="flex h-16 items-center border-b border-brand-line px-4 xl:px-5">
        <BrandLogo inverted />
      </div>

      <nav className="flex gap-2 overflow-x-auto px-3 py-3 xl:min-h-0 xl:flex-1 xl:flex-col xl:gap-5 xl:overflow-y-auto xl:px-3 xl:py-5">
        {navGroups.map((group) => (
          <section key={group.label} className="flex shrink-0 gap-1 xl:block">
            <p className="mb-1 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted/70 xl:block">
              {group.label}
            </p>

            <div className="flex gap-1 xl:block xl:space-y-0.5">
              {group.items.map((item) => {
                const isActive = activeView === item.id;
                const showBadge = (item.id === 'alertCenter' || item.id === 'intelligence') && alertCount > 0;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveView(item.id)}
                    className={[
                      'group relative flex min-w-[132px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors xl:w-full xl:min-w-0',
                      isActive
                        ? 'bg-white/[0.065] font-medium text-white'
                        : 'text-brand-muted hover:bg-white/[0.035] hover:text-brand-soft',
                    ].join(' ')}
                  >
                    {isActive ? (
                      <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-brand-green" />
                    ) : null}

                    <item.icon
                      size={16}
                      strokeWidth={1.8}
                      className={isActive ? 'text-brand-soft' : 'text-brand-muted group-hover:text-brand-soft'}
                    />
                    <span className="truncate">{item.label}</span>

                    {showBadge ? (
                      <span className="ml-auto min-w-5 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-center text-[10px] font-semibold text-brand-soft">
                        {alertCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="border-t border-brand-line p-3">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-brand-muted transition-colors hover:bg-white/[0.035] hover:text-brand-soft"
        >
          <LogOut size={16} strokeWidth={1.8} />
          Sair
        </button>
      </div>
    </aside>
  );
}
