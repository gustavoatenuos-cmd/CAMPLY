import { ShieldAlert, AlertTriangle, Clock, CheckCircle2, X, ChevronRight } from 'lucide-react';
import type { CamplyData, ViewId } from '../types';
import { useEffect, useState } from 'react';

interface StartupModalProps {
  data: CamplyData;
  setActiveView: (view: ViewId) => void;
}

const SESSION_KEY = 'camply-startup-dismissed';

export function StartupModal({ data, setActiveView }: StartupModalProps) {
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

  const activeAlerts = data.agentAlerts?.filter((alert) => alert.status === 'active') || [];
  const criticals = activeAlerts.filter((alert) => alert.severity === 'critical');
  const warnings = activeAlerts.filter((alert) => alert.severity === 'warning');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-brand-line bg-brand-ink shadow-2xl animate-in slide-in-from-bottom-4 duration-500">
        <div className="relative overflow-hidden border-b border-brand-line bg-gradient-to-r from-brand-ink via-brand-surface to-brand-ink p-6">
          <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-brand-green/5 blur-2xl" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-brand-green">{greeting}</p>
              <h2 className="mt-1 text-xl font-black text-white">Briefing operacional</h2>
              <p className="mt-1 text-sm text-brand-muted">Pendências canônicas do workspace antes de começar.</p>
            </div>
            <button type="button" onClick={dismiss} className="rounded-lg p-2 text-brand-muted transition hover:bg-brand-surface hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-center">
              <div className="mb-1 flex items-center justify-center gap-1.5 text-red-400">
                <ShieldAlert size={16} />
                <span className="text-xs font-bold uppercase">Críticos</span>
              </div>
              <p className="text-3xl font-black text-white">{criticals.length}</p>
            </div>
            <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-center">
              <div className="mb-1 flex items-center justify-center gap-1.5 text-amber-400">
                <AlertTriangle size={16} />
                <span className="text-xs font-bold uppercase">Atenção</span>
              </div>
              <p className="text-3xl font-black text-white">{warnings.length}</p>
            </div>
          </div>

          {activeAlerts.length > 0 ? (
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {activeAlerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className={`flex items-center gap-3 rounded-lg border p-3 ${
                  alert.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'
                }`}>
                  {alert.severity === 'critical' ? <ShieldAlert size={16} className="shrink-0 text-red-400" /> : <Clock size={16} className="shrink-0 text-amber-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{alert.title}</p>
                    <p className="truncate text-xs text-brand-muted">{alert.message}</p>
                  </div>
                </div>
              ))}
              {activeAlerts.length > 5 ? (
                <p className="py-1 text-center text-xs text-brand-muted">+ {activeAlerts.length - 5} alertas adicionais</p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-brand-green/30 bg-brand-green/5 p-4">
              <CheckCircle2 className="shrink-0 text-brand-green" size={20} />
              <div>
                <p className="text-sm text-white">Nenhuma pendência operacional ativa.</p>
                <p className="mt-1 text-xs text-brand-muted">Performance de mídia continua sendo avaliada no Analytics.</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-brand-line bg-brand-surface/30 p-4">
          <button type="button" onClick={dismiss} className="flex-1 rounded-lg border border-brand-line px-4 py-2.5 text-sm font-semibold text-brand-soft transition hover:text-white">
            Fechar
          </button>
          <button type="button" onClick={() => goTo('intelligence')} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-bold text-brand-ink transition hover:brightness-110">
            Ver alertas
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
