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
import { motion } from 'framer-motion';
import { BrandLogo } from './BrandLogo';
import type { ViewId } from '../types';

// ─── Navegação agrupada em 3 seções com separadores visuais ──────────────────
type NavItem = { id: ViewId; label: string; icon: typeof LayoutDashboard };

const navGroups: NavItem[][] = [
  // Grupo 1 — operação diária
  [
    { id: 'today',           label: 'Dashboard',     icon: LayoutDashboard },
    { id: 'clientAnalytics', label: 'Analytics',     icon: BarChart3 },

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
    <aside className="relative z-40 flex w-full shrink-0 flex-col border-b border-brand-line bg-brand-surface/50 backdrop-blur-xl xl:sticky xl:top-0 xl:h-dvh xl:w-72 xl:border-b-0 xl:border-r">
      {/* Decorative Gradient Glow */}
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-brand-green/5 to-transparent pointer-events-none" />

      {/* Logo */}
      <div className="relative z-10 border-b border-brand-line/50 p-4 xl:p-6">
        <BrandLogo inverted />
      </div>

      {/* Nav com grupos */}
      <nav className="relative z-10 flex gap-1 overflow-x-auto p-3 xl:block xl:flex-1 xl:overflow-x-visible xl:p-4">
        {navGroups.map((group, groupIndex) => (
          <div
            key={groupIndex}
            className={`flex shrink-0 gap-1 xl:block xl:space-y-1 ${
              groupIndex > 0
                // Mobile: separador vertical   XL: separador horizontal
                ? 'ml-2 border-l border-brand-line/30 pl-2 xl:ml-0 xl:mt-4 xl:border-l-0 xl:border-t xl:pt-4'
                : ''
            }`}
          >
            {group.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={`group relative flex min-w-[140px] shrink-0 items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors xl:w-full xl:min-w-0 ${
                    isActive
                      ? 'text-white'
                      : 'text-brand-muted hover:text-white'
                  }`}
                >
                  {/* Fluid Active Background */}
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-xl bg-brand-green/10 border border-brand-green/20 shadow-[inset_0_0_12px_rgba(0,229,153,0.1)]"
                      initial={false}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}

                  <span className="relative z-10 flex items-center gap-3">
                    <item.icon
                      size={18}
                      className={`transition-colors duration-300 ${isActive ? 'text-brand-green' : 'text-brand-muted group-hover:text-brand-soft'}`}
                    />
                    {item.label}
                  </span>

                  {/* Badge de alertas */}
                  {(item.id === 'alertCenter' || item.id === 'intelligence') && alertCount > 0 && (
                    <motion.span 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="relative z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-green/20 border border-brand-green/40 px-1.5 text-[10px] font-bold text-brand-green shadow-glow"
                    >
                      {alertCount}
                    </motion.span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sair */}
      <div className="relative z-10 border-t border-brand-line/50 p-3 xl:p-4">
        <button
          onClick={onSignOut}
          className="group flex w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-brand-muted transition-all hover:bg-white/5 hover:text-rose-400 xl:justify-start"
        >
          <LogOut size={16} className="transition-transform group-hover:-translate-x-1" />
          Sair do sistema
        </button>
      </div>
    </aside>
  );
}
