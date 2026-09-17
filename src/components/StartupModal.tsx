import { ShieldAlert, AlertTriangle, Clock, CheckCircle2, X, ChevronRight } from 'lucide-react';
import { CamplyData, AgentAlert, ViewId } from '../types';
import { useEffect, useState } from 'react';

interface StartupModalProps {
  data: CamplyData;
  setActiveView: (view: ViewId) => void;
  claudeSummary: string | null;
  claudeLoading: boolean;
  userName: string;
}

const SESSION_KEY = 'camply-startup-dismissed';

export function StartupModal({ data, setActiveView, claudeSummary, claudeLoading, userName }: StartupModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = window.sessionStorage.getItem(SESSION_KEY);
    if (!dismissed) {
      const timer = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    window.sessionStorage.setItem(SESSION_KEY, 'true');
  };

  const goTo = (view: ViewId) => {
    dismiss();
    setActiveView(view);
  };

  if (!open) return null;

  const activeAlerts = data.agentAlerts?.filter(a => a.status === 'active') || [];
  const criticals = activeAlerts.filter(a => a.severity === 'critical');
  const warnings = activeAlerts.filter(a => a.severity === 'warning');

  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-lg rounded-2xl border border-brand-line bg-brand-ink shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
        {/* Header */}
        <div className="relative overflow-hidden border-b border-brand-line bg-gradient-to-r from-brand-ink via-brand-surface to-brand-ink p-6">
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-brand-green/5 blur-2xl" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-brand-green">{saudacao}, {userName} 👋</p>
              <h2 className="mt-1 text-xl font-black text-white">Briefing do Agente</h2>
              <p className="mt-1 text-sm text-brand-muted">Aqui está o resumo operacional antes de começar.</p>
            </div>
            <button onClick={dismiss} className="rounded-lg p-2 text-brand-muted transition hover:bg-brand-surface hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* AI Summary */}
        <div className="p-6 space-y-5">
          {claudeLoading ? (
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
                <p className="text-sm text-brand-muted">A IA está analisando sua operação...</p>
              </div>
            </div>
          ) : claudeSummary ? (
            <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-4">
              <p className="text-sm font-semibold text-brand-green mb-2">🤖 Análise do Agente</p>
              <p className="text-sm leading-relaxed text-white/90">{claudeSummary}</p>
            </div>
          ) : null}

          {/* Counters */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-red-400 mb-1">
                <ShieldAlert size={16} />
                <span className="text-xs font-bold uppercase">Críticos</span>
              </div>
              <p className="text-3xl font-black text-white">{criticals.length}</p>
            </div>
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-amber-400 mb-1">
                <AlertTriangle size={16} />
                <span className="text-xs font-bold uppercase">Atenção</span>
              </div>
              <p className="text-3xl font-black text-white">{warnings.length}</p>
            </div>
          </div>

          {/* Top alerts list */}
          {activeAlerts.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {activeAlerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className={`flex items-center gap-3 rounded-lg border p-3 ${
                  alert.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'
                }`}>
                  {alert.severity === 'critical' ? <ShieldAlert size={16} className="text-red-400 shrink-0" /> : <Clock size={16} className="text-amber-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{alert.title}</p>
                    <p className="text-xs text-brand-muted truncate">{alert.message}</p>
                  </div>
                </div>
              ))}
              {activeAlerts.length > 5 && (
                <p className="text-xs text-brand-muted text-center py-1">+ {activeAlerts.length - 5} alertas adicionais</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-brand-green/30 bg-brand-green/5 p-4">
              <CheckCircle2 className="text-brand-green shrink-0" size={20} />
              <p className="text-sm text-white">Tudo limpo! Nenhum alerta operacional pendente. 🎯</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-brand-line p-4 bg-brand-surface/30">
          <button onClick={dismiss} className="flex-1 rounded-lg border border-brand-line px-4 py-2.5 text-sm font-semibold text-brand-soft transition hover:text-white">
            Fechar
          </button>
          <button onClick={() => goTo('intelligence')} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-bold text-brand-ink transition hover:brightness-110">
            Ver alertas
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
