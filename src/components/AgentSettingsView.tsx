import { useState } from 'react';
import { CamplyData, AgentRule } from '../types';
import { makeId } from '../data/camplyStore';
import { Settings, Plus, Trash2, ToggleLeft, ToggleRight, ShieldAlert, Save } from 'lucide-react';

interface AgentSettingsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

const DEFAULT_RULES: Omit<AgentRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Prazo Vencido',
    description: 'Marca como atrasado tarefas e projetos com prazo expirado.',
    entityType: 'task',
    conditionType: 'overdue',
    severity: 'critical',
    enabled: true,
  },
  {
    name: 'Vence Hoje',
    description: 'Marca como urgente tarefas e projetos que vencem hoje.',
    entityType: 'task',
    conditionType: 'deadline_today',
    severity: 'warning',
    enabled: true,
  },
  {
    name: 'Projeto Parado',
    description: 'Alerta quando um projeto fica sem atualização por muitos dias.',
    entityType: 'project',
    conditionType: 'idle_days',
    thresholdValue: 7,
    thresholdUnit: 'days',
    severity: 'warning',
    enabled: true,
  },
  {
    name: 'Campanha sem Otimização',
    description: 'Alerta quando uma campanha ativa fica sem otimização por vários dias.',
    entityType: 'campaign',
    conditionType: 'idle_days',
    thresholdValue: 3,
    thresholdUnit: 'days',
    severity: 'warning',
    enabled: true,
  },
  {
    name: 'Cliente Crítico',
    description: 'Alerta quando um cliente acumula muitas pendências críticas.',
    entityType: 'client',
    conditionType: 'many_pending',
    thresholdValue: 3,
    thresholdUnit: 'count',
    severity: 'critical',
    enabled: true,
  },
];

export function AgentSettingsView({ data, updateData }: AgentSettingsViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editThreshold, setEditThreshold] = useState<number>(0);

  const rules = data.agentRules || [];

  const initializeDefaults = () => {
    const now = new Date().toISOString();
    const newRules: AgentRule[] = DEFAULT_RULES.map((r) => ({
      ...r,
      id: makeId('rule'),
      createdAt: now,
      updatedAt: now,
    }));
    updateData((d) => ({ ...d, agentRules: newRules }));
  };

  const toggleRule = (ruleId: string) => {
    updateData((d) => ({
      ...d,
      agentRules: d.agentRules.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled, updatedAt: new Date().toISOString() } : r
      ),
    }));
  };

  const deleteRule = (ruleId: string) => {
    updateData((d) => ({
      ...d,
      agentRules: d.agentRules.filter((r) => r.id !== ruleId),
    }));
  };

  const saveThreshold = (ruleId: string) => {
    updateData((d) => ({
      ...d,
      agentRules: d.agentRules.map((r) =>
        r.id === ruleId ? { ...r, thresholdValue: editThreshold, updatedAt: new Date().toISOString() } : r
      ),
    }));
    setEditingId(null);
  };

  const clearAllAlerts = () => {
    updateData((d) => ({
      ...d,
      agentAlerts: d.agentAlerts.map((a) => ({ ...a, status: 'dismissed' as const })),
    }));
  };

  const severityLabel: Record<string, string> = {
    critical: 'Crítico',
    warning: 'Atenção',
    info: 'Informativo',
    good: 'Saudável',
  };

  const severityColor: Record<string, string> = {
    critical: 'text-red-400 bg-red-400/10',
    warning: 'text-amber-400 bg-amber-400/10',
    info: 'text-sky-400 bg-sky-400/10',
    good: 'text-brand-green bg-brand-green/10',
  };

  const entityLabel: Record<string, string> = {
    task: 'Tarefa',
    project: 'Projeto',
    campaign: 'Campanha',
    client: 'Cliente',
  };

  const conditionLabel: Record<string, string> = {
    deadline_today: 'Prazo para hoje',
    overdue: 'Prazo vencido',
    idle_days: 'Dias sem atualização',
    attention_required: 'Requer atenção',
    many_pending: 'Muitas pendências',
  };

  const activeAlerts = data.agentAlerts?.filter((a) => a.status === 'active').length || 0;
  const totalAlerts = data.agentAlerts?.length || 0;
  const totalLogs = data.agentLogs?.length || 0;

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Configurações do Agente</p>
          <h1 className="mt-1 text-2xl font-black text-white">Regras & Controle Operacional</h1>
          <p className="mt-1 text-sm text-brand-muted">Customize os gatilhos, pesos e comportamentos do agente inteligente.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={clearAllAlerts} className="rounded-lg border border-brand-line px-4 py-2 text-sm font-semibold text-brand-soft transition hover:text-white">
            Limpar todos os alertas
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
          <p className="text-sm text-brand-muted">Regras ativas</p>
          <p className="mt-2 text-2xl font-black text-white">{rules.filter((r) => r.enabled).length}/{rules.length}</p>
        </div>
        <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
          <p className="text-sm text-brand-muted">Alertas ativos agora</p>
          <p className="mt-2 text-2xl font-black text-white">{activeAlerts}</p>
        </div>
        <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
          <p className="text-sm text-brand-muted">Total de análises registradas</p>
          <p className="mt-2 text-2xl font-black text-white">{totalLogs}</p>
        </div>
      </div>

      {/* Rules */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <Settings size={18} className="text-brand-green" />
            Regras do Agente
          </h2>
          {rules.length === 0 && (
            <button onClick={initializeDefaults} className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-brand-ink">
              <Plus size={16} />
              Carregar regras padrão
            </button>
          )}
        </div>

        {rules.length === 0 && (
          <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-center">
            <ShieldAlert className="mx-auto mb-3 text-brand-muted" size={40} />
            <p className="text-brand-muted">Nenhuma regra configurada.</p>
            <p className="mt-1 text-sm text-brand-muted">Clique em "Carregar regras padrão" para inicializar o agente.</p>
          </div>
        )}

        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className={`rounded-xl border bg-brand-ink p-5 transition ${rule.enabled ? 'border-brand-line' : 'border-brand-line/50 opacity-50'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-white">{rule.name}</h3>
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${severityColor[rule.severity]}`}>
                      {severityLabel[rule.severity]}
                    </span>
                    <span className="rounded-full bg-brand-surface px-2.5 py-0.5 text-[10px] font-semibold text-brand-muted">
                      {entityLabel[rule.entityType]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-brand-muted">{rule.description}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-brand-soft">
                    <span>Condição: {conditionLabel[rule.conditionType]}</span>
                    {rule.thresholdValue !== undefined && (
                      <>
                        <span>•</span>
                        {editingId === rule.id ? (
                          <span className="flex items-center gap-2">
                            <span>Limite:</span>
                            <input
                              type="number"
                              min="1"
                              value={editThreshold}
                              onChange={(e) => setEditThreshold(Number(e.target.value))}
                              className="w-16 rounded border border-brand-line bg-brand-surface px-2 py-1 text-white text-xs"
                            />
                            <span>{rule.thresholdUnit}</span>
                            <button onClick={() => saveThreshold(rule.id)} className="text-brand-green hover:underline">
                              <Save size={12} />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { setEditingId(rule.id); setEditThreshold(rule.thresholdValue || 0); }}
                            className="hover:text-brand-green transition"
                          >
                            Limite: {rule.thresholdValue} {rule.thresholdUnit} ✏️
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggleRule(rule.id)} className="transition hover:scale-110">
                    {rule.enabled ? (
                      <ToggleRight size={28} className="text-brand-green" />
                    ) : (
                      <ToggleLeft size={28} className="text-brand-muted" />
                    )}
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="rounded-lg p-2 text-brand-muted transition hover:bg-red-500/10 hover:text-red-400">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Log */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
          <ShieldAlert size={18} className="text-brand-green" />
          Histórico de Alertas (Auditoria)
        </h2>
        <div className="rounded-xl border border-brand-line bg-brand-ink overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-line bg-brand-surface/50 text-left text-xs uppercase text-brand-muted">
                <th className="p-3">Tipo</th>
                <th className="p-3">Título</th>
                <th className="p-3 hidden sm:table-cell">Mensagem</th>
                <th className="p-3">Severidade</th>
                <th className="p-3">Status</th>
                <th className="p-3 hidden md:table-cell">Data</th>
              </tr>
            </thead>
            <tbody>
              {(data.agentAlerts || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-brand-muted">Nenhum alerta registrado ainda.</td>
                </tr>
              )}
              {(data.agentAlerts || []).slice(0, 50).map((alert) => (
                <tr key={alert.id} className="border-b border-brand-line/50 hover:bg-brand-surface/30 transition">
                  <td className="p-3">
                    <span className="rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-bold uppercase text-brand-soft">
                      {entityLabel[alert.relatedEntityType] || alert.relatedEntityType}
                    </span>
                  </td>
                  <td className="p-3 font-semibold text-white">{alert.title}</td>
                  <td className="p-3 text-brand-muted hidden sm:table-cell max-w-xs truncate">{alert.message}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${severityColor[alert.severity]}`}>
                      {severityLabel[alert.severity] || alert.severity}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`text-xs font-semibold ${alert.status === 'active' ? 'text-red-400' : alert.status === 'resolved' ? 'text-brand-green' : 'text-brand-muted'}`}>
                      {alert.status === 'active' ? 'Ativo' : alert.status === 'resolved' ? 'Resolvido' : 'Dispensado'}
                    </span>
                  </td>
                  <td className="p-3 text-brand-muted text-xs hidden md:table-cell whitespace-nowrap">
                    {new Date(alert.triggeredAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
