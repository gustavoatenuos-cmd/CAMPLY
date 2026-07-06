import {
  Banknote,
  BarChart3,
  Bell,
  BotMessageSquare,
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

// ─── Navegação agrupada em 3 seções com separadores visuais ──────────────────
type NavItem = { id: ViewId; label: string; icon: typeof LayoutDashboard };

const navGroups: NavItem[][] = [
  // Grupo 1 — operação diária
  [
    { id: 'today',           label: 'Dashboard',     icon: LayoutDashboard },
    { id: 'clientAnalytics', label: 'Analytics',     icon: BarChart3 },
    { id: 'agentChat',       label: 'Chat IA',       icon: BotMessageSquare },
    { id: 'campaigns',       label: 'Campanhas',     icon: Columns3 },
    { id: 'creativeCritic',  label: 'Lab. Criativo', icon: Sparkles },
    { id: 'alertCenter',     label: 'Alertas',       icon: Bell },
  ],
  // Grupo 2 — clientes e financeiro
  [
    { id: 'clients',         label: 'Clientes',        icon: Users },
    { id: 'mediaFinance',    label: 'Verbas de mídia', icon: Banknote },
    { id: 'projects',        label: 'Projetos',        icon: BriefcaseBusiness },
    { id: 'personalFinance', label: 'Meu financeiro',  icon: Landmark },
  ],
  // Grupo 3 — histórico e configuração
  [
    { id: 'activity',        label: 'Histórico',       icon: History },
    { id: 'intelligence',    label: 'Inteligência',    icon: Sparkles },
    { id: 'agentSettings',   label: 'Config. Agente',  icon: Settings },
    { id: 'metaIntegration', label: 'Integração Meta', icon: Facebook },
  ],
];

interface SidebarProps {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  alertCount: number;
  onSignOut: () => void;
}

export function Sidebar({ activeView, setActiveView, alertCount, onSignOut }: SidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-brand-line bg-brand-ink xl:h-screen xl:w-72 xl:border-b-0 xl:border-r">

      {/* Logo */}
      <div className="border-b border-brand-line p-3 sm:p-4 xl:p-5">
        <BrandLogo inverted />
      </div>

      {/* Nav com grupos */}
      <nav className="flex gap-1 overflow-x-auto p-2 xl:block xl:flex-1 xl:overflow-x-visible xl:p-3">
        {navGroups.map((group, groupIndex) => (
          <div
            key={groupIndex}
            className={`flex shrink-0 gap-1 xl:block xl:space-y-0.5 ${
              groupIndex > 0
                // Mobile: separador vertical   XL: separador horizontal
                ? 'ml-2 border-l border-brand-line/50 pl-2 xl:ml-0 xl:mt-3 xl:border-l-0 xl:border-t xl:border-brand-line/50 xl:pl-0 xl:pt-3'
                : ''
            }`}
          >
            {group.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  /**
                   * Desktop (xl):
                   *  - item ativo: fundo verde + borda-esquerda 3 px branca
                   *  - item inativo: borda-esquerda transparente do mesmo tamanho
                   *    para não deslocar o layout no hover/ativação
                   */
                  className={[
                    'flex min-w-[130px] shrink-0 items-center justify-center gap-2 rounded-lg',
                    'px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    'xl:w-full xl:min-w-0 xl:justify-between xl:gap-0 xl:py-3',
                    'xl:rounded-l-none xl:border-l-[3px]',
                    isActive
                      ? 'bg-brand-green text-brand-ink xl:border-l-white/50'
                      : 'text-[#94a3b8] hover:bg-white/[0.05] hover:text-white xl:border-l-transparent',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-3">
                    <item.icon
                      size={18}
                      className={isActive ? 'text-brand-ink' : 'text-[#64748b]'}
                    />
                    {item.label}
                  </span>

                  {/* Badge de alertas — pulsa levemente para criar urgência */}
                  {(item.id === 'alertCenter' || item.id === 'intelligence') && alertCount > 0 && (
                    <span className="animate-pulse rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
                      {alertCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sair */}
      <div className="border-t border-brand-line p-2 xl:p-4">
        <button
          onClick={onSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-muted transition hover:bg-white/5 hover:text-white xl:justify-start"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </aside>
  );
}
