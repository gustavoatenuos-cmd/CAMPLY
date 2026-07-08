/**
 * AlertCenterView.tsx
 * Phase 2 — Unified alert center showing all active agent alerts grouped by severity.
 * Also shows cost-related alerts derived from campaign data in real time.
 */
import React, { useMemo, useState } from 'react';
import { Bell, ShieldCheck } from 'lucide-react';
import type { CamplyData, AgentAlert, Campaign, Client } from '../types';
import { AlertBadge } from './ui/AlertBadge';
import { EmptyState } from './ui/EmptyState';
import { formatMetricValue } from '../lib/meta/metricsSelector';

interface AlertCenterViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

// Derives real-time cost alerts from campaign data
function deriveCostAlerts(data: CamplyData): Array<{
  id: string;
  clientId: string;
  campaignId?: string;
  severity: 'critical' | 'warning' | 'info';
  type: string;
  title: string;
  message: string;
  action: string;
  client?: Client;
  campaign?: Campaign;
}> {
  const alerts: ReturnType<typeof deriveCostAlerts> = [];

  data.campaigns.forEach(campaign => {
    const client = data.clients.find(c => c.id === campaign.clientId);
    const base = { clientId: campaign.clientId, campaignId: campaign.id, client, campaign };

    // Budget exhausted (>90%)
    if (campaign.budget > 0) {
      const pct = (campaign.spent / campaign.budget) * 100;
      if (pct >= 90 && !['paused', 'setup'].includes(campaign.status)) {
        alerts.push({
          ...base,
          id: `budget_exhausted_${campaign.id}`,
          severity: 'critical',
          type: 'budget_exhausted',
          title: 'Budget esgotado',
          message: `${campaign.name} consumiu ${pct.toFixed(0)}% do budget (${formatMetricValue('spent', campaign.spent)})`,
          action: 'Revisar orçamento ou pausar campanha',
        });
      } else if (pct >= 70 && !['paused', 'setup'].includes(campaign.status)) {
        alerts.push({
          ...base,
          id: `budget_high_${campaign.id}`,
          severity: 'warning',
          type: 'budget_high',
          title: 'Budget acima de 70%',
          message: `${campaign.name} já consumiu ${pct.toFixed(0)}% do budget`,
          action: 'Monitorar consumo e ajustar se necessário',
        });
      }
    }

    // Campaign without optimization for 3+ days
    if (campaign.lastOptimizedAt && !['paused', 'setup'].includes(campaign.status)) {
      const days = Math.floor((Date.now() - new Date(campaign.lastOptimizedAt).getTime()) / 86400000);
      if (days >= 7) {
        alerts.push({
          ...base,
          id: `no_optim_critical_${campaign.id}`,
          severity: 'critical',
          type: 'no_optimization',
          title: 'Sem otimização há 7+ dias',
          message: `${campaign.name} está há ${days} dias sem otimização`,
          action: 'Revisar métricas e otimizar urgentemente',
        });
      } else if (days >= 3) {
        alerts.push({
          ...base,
          id: `no_optim_warning_${campaign.id}`,
          severity: 'warning',
          type: 'no_optimization',
          title: `Sem otimização há ${days} dias`,
          message: `${campaign.name} precisa de revisão`,
          action: 'Analisar métricas e registrar otimização',
        });
      }
    }

    // High CPM vs benchmark
    if (campaign.cpr !== undefined && client?.benchmarks?.cpr) {
      const ratio = campaign.cpr / client.benchmarks.cpr;
      if (ratio > 2) {
        alerts.push({
          ...base,
          id: `high_cpr_${campaign.id}`,
          severity: 'warning',
          type: 'high_cost',
          title: 'Custo por resultado alto',
          message: `${campaign.name}: CPR ${formatMetricValue('cpr', campaign.cpr)} vs benchmark ${formatMetricValue('cpr', client.benchmarks.cpr)}`,
          action: 'Revisar criativos e segmentação',
        });
      }
    }
  });

  return alerts;
}

// ==================== ALERT ITEM ====================

interface AlertItemProps {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  action?: string;
  clientName?: string;
  campaignName?: string;
  onDismiss?: () => void;
}

function AlertItem({ severity, title, message, action, clientName, campaignName, onDismiss }: AlertItemProps) {
  const bgMap = {
    critical: 'border-rose-500/20 bg-rose-500/8',
    warning:  'border-amber-500/20 bg-amber-500/8',
    info:     'border-sky-500/20 bg-sky-500/8',
  };

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${bgMap[severity]}`}>
      <AlertBadge severity={severity} showDot size="sm" />
      <div className="flex-1 min-w-0">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white">{title}</p>
          {clientName && (
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-brand-muted">{clientName}</span>
          )}
          {campaignName && (
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-brand-muted">{campaignName}</span>
          )}
        </div>
        <p className="mb-1.5 text-xs text-brand-muted">{message}</p>
        {action && (
          <p className="text-xs font-medium text-violet-400">→ {action}</p>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 rounded p-1 text-brand-muted transition hover:bg-white/8 hover:text-white"
          title="Dispensar alerta"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ==================== MAIN VIEW ====================

export function AlertCenterView({ data, updateData }: AlertCenterViewProps) {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [showResolved, setShowResolved] = useState(false);

  // Derived cost alerts
  const costAlerts = useMemo(() => deriveCostAlerts(data), [data]);

  // Existing agent alerts
  const agentAlerts = useMemo(() => {
    return (data.agentAlerts || [])
      .filter(a => showResolved ? a.status !== 'active' : a.status === 'active')
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, good: 2, info: 3 };
        return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
      });
  }, [data.agentAlerts, showResolved]);

  const filteredCostAlerts = useMemo(() => {
    if (filter === 'all') return costAlerts;
    return costAlerts.filter(a => a.severity === filter);
  }, [costAlerts, filter]);

  const filteredAgentAlerts = useMemo(() => {
    if (filter === 'all') return agentAlerts;
    return agentAlerts.filter(a => (a.severity as string) === filter);
  }, [agentAlerts, filter]);

  const criticalCount = costAlerts.filter(a => a.severity === 'critical').length
    + agentAlerts.filter(a => a.severity === 'critical').length;
  const warningCount = costAlerts.filter(a => a.severity === 'warning').length
    + agentAlerts.filter(a => a.severity === 'warning').length;
  const totalActive = criticalCount + warningCount;

  function dismissAlert(alertId: string) {
    updateData(d => ({
      ...d,
      agentAlerts: d.agentAlerts.map(a =>
        a.id === alertId ? { ...a, status: 'dismissed' as const } : a
      ),
    }));
  }

  function dismissAll() {
    updateData(d => ({
      ...d,
      agentAlerts: d.agentAlerts.map(a =>
        a.status === 'active' ? { ...a, status: 'dismissed' as const } : a
      ),
    }));
  }

  return (
    <section className="h-full overflow-y-auto bg-brand-ink p-4 sm:p-5 lg:p-8">
      <div className="mx-auto flex min-h-full max-w-[1200px] flex-col space-y-6">
      {/* Header */}
      <div className="glass-panel flex animate-fade-in flex-wrap items-start justify-between gap-4 rounded-2xl p-5 lg:p-6">
        <div>
          <div className="flex items-center gap-2 text-brand-green"><Bell size={17} /><p className="text-xs font-bold uppercase tracking-[0.2em]">Alertas</p></div>
          <h1 className="mt-2 text-3xl font-black text-white">Central de Alertas</h1>
          <p className="mt-1 text-sm text-brand-muted">
            {totalActive === 0
              ? 'Nenhum alerta ativo — operação saudável'
              : `${totalActive} alerta${totalActive !== 1 ? 's' : ''} ativo${totalActive !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Summary pills */}
        <div className="flex gap-2">
          {criticalCount > 0 && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-center">
              <p className="text-xs text-rose-400">Críticos</p>
              <p className="text-xl font-bold text-rose-300">{criticalCount}</p>
            </div>
          )}
          {warningCount > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-center">
              <p className="text-xs text-amber-400">Atenção</p>
              <p className="text-xl font-bold text-amber-300">{warningCount}</p>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['all', 'critical', 'warning', 'info'] as const).map(f => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green/60 ${
                filter === f
                  ? 'border-brand-green/60 bg-brand-green/15 text-brand-green'
                  : 'border-brand-line text-brand-muted hover:bg-white/5 hover:text-white'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'critical' ? 'Críticos' : f === 'warning' ? 'Atenção' : 'Info'}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-brand-muted transition hover:text-white">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={e => setShowResolved(e.target.checked)}
              className="rounded border-white/20 accent-[#00E599]"
            />
            Ver dispensados
          </label>
          {agentAlerts.filter(a => a.status === 'active').length > 0 && (
            <button
              onClick={dismissAll}
              className="rounded-lg border border-brand-line px-3 py-1 text-xs font-bold text-brand-muted transition hover:border-brand-green/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green/60"
            >
              Dispensar todos
            </button>
          )}
        </div>
      </div>

      {/* Cost Alerts (real-time derived) */}
      {filteredCostAlerts.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Alertas de Custo e Performance
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-brand-muted">
              {filteredCostAlerts.length}
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {filteredCostAlerts.map(alert => (
              <AlertItem
                key={alert.id}
                severity={alert.severity}
                title={alert.title}
                message={alert.message}
                action={alert.action}
                clientName={alert.client?.name}
                campaignName={alert.campaign?.name !== alert.message.split(':')[0] ? undefined : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {/* Agent Alerts (operational) */}
      {filteredAgentAlerts.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Alertas Operacionais
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-brand-muted">
              {filteredAgentAlerts.length}
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {filteredAgentAlerts.map(alert => {
              const client = data.clients.find(c => c.id === alert.clientId);
              return (
                <AlertItem
                  key={alert.id}
                  severity={alert.severity === 'good' ? 'info' : alert.severity as any}
                  title={alert.title}
                  message={alert.message}
                  action={alert.suggestedAction}
                  clientName={client?.name}
                  onDismiss={alert.status === 'active' ? () => dismissAlert(alert.id) : undefined}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state */}
      {filteredCostAlerts.length === 0 && filteredAgentAlerts.length === 0 && (
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-lg">
            <EmptyState
              icon={ShieldCheck}
              title="Operação saudável"
              description="Nenhum alerta para o filtro selecionado. O agente segue monitorando budget, otimizações e custos por resultado."
            />
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
