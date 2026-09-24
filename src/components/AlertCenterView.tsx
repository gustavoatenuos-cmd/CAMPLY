import { useMemo, useState } from 'react';
import type { AgentAlert, CamplyData } from '../types';
import { AlertBadge } from './ui/AlertBadge';

interface AlertCenterViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

type AlertFilter = 'all' | 'critical' | 'warning' | 'info';

function displaySeverity(severity: AgentAlert['severity']): 'critical' | 'warning' | 'info' {
  return severity === 'critical' || severity === 'warning' ? severity : 'info';
}

function AlertItem({
  alert,
  clientName,
  onDismiss,
}: {
  alert: AgentAlert;
  clientName?: string;
  onDismiss?: () => void;
}) {
  const severity = displaySeverity(alert.severity);
  const styles = {
    critical: 'border-rose-500/20 bg-rose-500/8',
    warning: 'border-amber-500/20 bg-amber-500/8',
    info: 'border-sky-500/20 bg-sky-500/8',
  };

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${styles[severity]}`}>
      <AlertBadge severity={severity} showDot size="sm" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white">{alert.title}</p>
          {clientName ? (
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-zinc-400">{clientName}</span>
          ) : null}
          {alert.status !== 'active' ? (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
              {alert.status === 'dismissed' ? 'dispensado' : 'resolvido'}
            </span>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-zinc-400">{alert.message}</p>
        {alert.suggestedAction ? (
          <p className="mt-2 text-xs font-medium text-violet-400">→ {alert.suggestedAction}</p>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-zinc-500 transition hover:bg-white/8 hover:text-white"
          title="Dispensar alerta"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function AlertCenterView({ data, updateData }: AlertCenterViewProps) {
  const [filter, setFilter] = useState<AlertFilter>('all');
  const [showResolved, setShowResolved] = useState(false);

  const alerts = useMemo(() => {
    return (data.agentAlerts || [])
      .filter((alert) => showResolved ? alert.status !== 'active' : alert.status === 'active')
      .filter((alert) => filter === 'all' || displaySeverity(alert.severity) === filter)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, good: 2, info: 3 };
        return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
      });
  }, [data.agentAlerts, filter, showResolved]);

  const activeAlerts = useMemo(
    () => data.agentAlerts.filter((alert) => alert.status === 'active'),
    [data.agentAlerts]
  );
  const criticalCount = activeAlerts.filter((alert) => alert.severity === 'critical').length;
  const warningCount = activeAlerts.filter((alert) => alert.severity === 'warning').length;

  const dismissAlert = (alertId: string) => {
    updateData((current) => ({
      ...current,
      agentAlerts: current.agentAlerts.map((alert) =>
        alert.id === alertId ? { ...alert, status: 'dismissed' as const } : alert
      ),
    }));
  };

  const dismissAll = () => {
    updateData((current) => ({
      ...current,
      agentAlerts: current.agentAlerts.map((alert) =>
        alert.status === 'active' ? { ...alert, status: 'dismissed' as const } : alert
      ),
    }));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Central de Alertas</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Pendências operacionais do workspace. Performance de mídia é analisada exclusivamente no Analytics com dados validados da Meta.
          </p>
        </div>
        <div className="flex gap-2">
          {criticalCount > 0 ? (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-center">
              <p className="text-xs text-rose-400">Críticos</p>
              <p className="text-xl font-bold text-rose-300">{criticalCount}</p>
            </div>
          ) : null}
          {warningCount > 0 ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-center">
              <p className="text-xs text-amber-400">Atenção</p>
              <p className="text-xl font-bold text-amber-300">{warningCount}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['all', 'critical', 'warning', 'info'] as const).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === item ? 'bg-violet-500 text-white' : 'bg-white/8 text-zinc-400 hover:bg-white/12'
              }`}
            >
              {item === 'all' ? 'Todos' : item === 'critical' ? 'Críticos' : item === 'warning' ? 'Atenção' : 'Info'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
              className="rounded border-white/20"
            />
            Ver encerrados
          </label>
          {activeAlerts.length > 0 ? (
            <button
              type="button"
              onClick={dismissAll}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-zinc-400 transition hover:border-white/20 hover:text-white"
            >
              Dispensar todos
            </button>
          ) : null}
        </div>
      </div>

      {alerts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <AlertItem
              key={alert.id}
              alert={alert}
              clientName={data.clients.find((client) => client.id === alert.clientId)?.name}
              onDismiss={alert.status === 'active' ? () => dismissAlert(alert.id) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-3xl">✓</div>
          <p className="text-lg font-semibold text-emerald-400">Operação sob controle</p>
          <p className="text-sm text-zinc-500">Nenhum alerta operacional para o filtro selecionado.</p>
        </div>
      )}
    </div>
  );
}
