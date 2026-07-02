import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { History, LoaderCircle, Target, X } from 'lucide-react';
import { deriveCostMetric, type TraceableMetric } from '../../lib/performance/traceableMetrics';
import {
  closePerformanceTarget,
  loadTargetHistory,
  setPerformanceTarget,
  type PerformanceTargetHistoryItem,
  type PerformanceTargetKind,
} from '../../lib/meta/targetService';

interface TargetSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  clientMetaAssetId: string;
  campaignId?: string;
  campaignName?: string;
  metrics?: Record<string, TraceableMetric>;
  onSaved?: () => void;
}

const metricOptions = [
  ['messaging_conversations_started_total', 'Conversas'],
  ['cost_per_messaging_conversation', 'Custo por conversa'],
  ['leads', 'Leads'],
  ['cost_per_lead', 'CPL'],
  ['purchases', 'Compras'],
  ['cost_per_purchase', 'CPA'],
  ['purchase_roas', 'ROAS'],
  ['cpm', 'CPM'],
  ['link_ctr', 'CTR de link'],
  ['frequency', 'Frequência'],
  ['landing_page_views', 'Landing page views'],
  ['spend', 'Investimento'],
] as const;

const kindOptions: Array<[PerformanceTargetKind, string]> = [
  ['cost_per_result', 'Custo por resultado'],
  ['daily_budget', 'Orçamento diário'],
  ['weekly_budget', 'Orçamento semanal'],
  ['monthly_budget', 'Orçamento mensal'],
  ['minimum_results', 'Quantidade mínima'],
  ['maximum_metric', 'Métrica máxima'],
  ['minimum_metric', 'Métrica mínima'],
  ['target_range', 'Faixa ideal'],
];

export function TargetSettingsDrawer(props: TargetSettingsDrawerProps) {
  const [history, setHistory] = useState<PerformanceTargetHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await loadTargetHistory(props.clientMetaAssetId, props.campaignId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as metas.');
    } finally {
      setLoading(false);
    }
  }, [props.campaignId, props.clientMetaAssetId]);

  useEffect(() => {
    if (props.open) void refresh();
  }, [props.open, refresh]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70">
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-brand-line bg-brand-ink shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-brand-line bg-brand-ink p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-green">Metas versionadas</p>
            <h2 className="mt-1 text-xl font-black text-white">{props.campaignName || 'Meta da conta'}</h2>
            <p className="mt-1 text-sm text-brand-muted">Alterações encerram a versão vigente e preservam o histórico.</p>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Fechar metas" className="rounded-lg p-2 text-brand-muted hover:bg-brand-surface hover:text-white">
            <X size={20} />
          </button>
        </header>

        <div className="space-y-6 p-5">
          <TargetForm
            clientMetaAssetId={props.clientMetaAssetId}
            campaignId={props.campaignId}
            onSaved={async () => {
              await refresh();
              props.onSaved?.();
            }}
          />
          {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-brand-muted"><LoaderCircle className="animate-spin" size={16} /> Carregando histórico...</div>
          ) : (
            <TargetHistory history={history} metrics={props.metrics} onCloseTarget={async (id) => {
              await closePerformanceTarget(id);
              await refresh();
              props.onSaved?.();
            }} />
          )}
        </div>
      </aside>
    </div>
  );
}

export function TargetForm({
  clientMetaAssetId,
  campaignId,
  onSaved,
}: {
  clientMetaAssetId: string;
  campaignId?: string;
  onSaved: () => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const targetKind = String(form.get('targetKind')) as PerformanceTargetKind;
    const metricId = targetKind === 'daily_budget' || targetKind === 'weekly_budget' || targetKind === 'monthly_budget'
      ? 'spend'
      : String(form.get('metricId'));
    const targetMin = form.get('targetMin') === '' ? null : Number(form.get('targetMin'));
    const targetMax = form.get('targetMax') === '' ? null : Number(form.get('targetMax'));
    const targetValue = targetKind === 'target_range'
      ? Number.isFinite(targetMax) && targetMax! > 0 ? targetMax! : Number(targetMin)
      : Number(form.get('targetValue'));
    if (targetKind === 'target_range' && (
      !Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin! <= 0 || targetMax! <= 0 || targetMin! >= targetMax!
    )) {
      setError('Informe uma faixa válida, com mínimo menor que o máximo.');
      return;
    }
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setPerformanceTarget({
        clientMetaAssetId,
        campaignId,
        metricId,
        targetKind,
        targetValue,
        targetMin: Number.isFinite(targetMin) ? targetMin : null,
        targetMax: Number.isFinite(targetMax) ? targetMax : null,
        warningTolerancePercent: form.get('warningTolerancePercent') === '' ? null : Number(form.get('warningTolerancePercent')),
        criticalTolerancePercent: form.get('criticalTolerancePercent') === '' ? null : Number(form.get('criticalTolerancePercent')),
        priorityWeight: form.get('priorityWeight') === '' ? null : Number(form.get('priorityWeight')),
        evaluationPeriod: String(form.get('evaluationPeriod') || ''),
      });
      formElement.reset();
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a meta.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-brand-line bg-brand-surface p-4">
      <div className="flex items-center gap-2"><Target className="text-brand-green" size={18} /><h3 className="font-black text-white">Nova versão de meta</h3></div>
      <label className="block text-sm text-brand-soft">
        Tipo
        <select name="targetKind" defaultValue="cost_per_result" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">
          {kindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-sm text-brand-soft">
        Métrica de resultado
        <select name="metricId" defaultValue="messaging_conversations_started_total" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">
          {metricOptions.filter(([id]) => id !== 'spend').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block text-sm text-brand-soft">
        Valor
        <input name="targetValue" type="number" min="0.01" step="0.01" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-brand-soft">
          Mínimo da faixa
          <input name="targetMin" type="number" min="0" step="0.01" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" placeholder="Ex: 1,5" />
        </label>
        <label className="block text-sm text-brand-soft">
          Máximo da faixa
          <input name="targetMax" type="number" min="0" step="0.01" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" placeholder="Ex: 3" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm text-brand-soft">
          Atenção (%)
          <input name="warningTolerancePercent" type="number" min="0" step="0.1" defaultValue="10" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" />
        </label>
        <label className="block text-sm text-brand-soft">
          Crítico (%)
          <input name="criticalTolerancePercent" type="number" min="0" step="0.1" defaultValue="25" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" />
        </label>
        <label className="block text-sm text-brand-soft">
          Peso
          <input name="priorityWeight" type="number" min="0" step="0.1" defaultValue="1" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white" />
        </label>
      </div>
      <label className="block text-sm text-brand-soft">
        Período de avaliação
        <select name="evaluationPeriod" defaultValue="inherit" className="mt-2 w-full rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-white">
          <option value="inherit">Usar período do dashboard</option>
          <option value="today">Hoje</option>
          <option value="this_week">Semana atual</option>
          <option value="this_month">Mês atual</option>
          <option value="last_7d">Últimos 7 dias</option>
          <option value="last_30d">Últimos 30 dias</option>
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink disabled:opacity-60">
        {saving && <LoaderCircle className="animate-spin" size={15} />} Salvar nova versão
      </button>
    </form>
  );
}

export function TargetHistory({
  history,
  metrics,
  onCloseTarget,
}: {
  history: PerformanceTargetHistoryItem[];
  metrics?: Record<string, TraceableMetric>;
  onCloseTarget: (id: string) => Promise<void>;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2"><History className="text-brand-green" size={18} /><h3 className="font-black text-white">Histórico</h3></div>
      <div className="space-y-3">
        {history.map((target) => (
          <article key={target.id} className="rounded-xl border border-brand-line bg-brand-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-white">{target.targetKind} · {target.metricId}</p>
                <p className="mt-1 text-sm text-brand-muted">
                  Meta: {target.targetKind === 'target_range' && target.targetMin != null && target.targetMax != null
                    ? `${target.targetMin.toLocaleString('pt-BR')} a ${target.targetMax.toLocaleString('pt-BR')}`
                    : target.targetValue.toLocaleString('pt-BR')}
                </p>
                <p className="mt-1 text-xs text-brand-muted">Desde {new Date(target.effectiveFrom).toLocaleString('pt-BR')}</p>
              </div>
              <TargetComparisonBadge target={target} metrics={metrics} />
            </div>
            {target.active && (
              <button type="button" onClick={() => void onCloseTarget(target.id)} className="mt-3 text-xs font-bold text-rose-300 hover:text-rose-200">Encerrar meta vigente</button>
            )}
          </article>
        ))}
        {history.length === 0 && <div className="rounded-xl border border-dashed border-brand-line p-6 text-center text-sm text-brand-muted">Nenhuma meta configurada neste escopo.</div>}
      </div>
    </section>
  );
}

export function TargetComparisonBadge({ target, metrics }: { target: PerformanceTargetHistoryItem; metrics?: Record<string, TraceableMetric> }) {
  const comparison = useMemo(() => {
    if (!target.active || !metrics) return null;
    const metric = target.targetKind === 'cost_per_result'
      ? deriveCostMetric(`cost_per_${target.metricId}`, metrics.spend, metrics[target.metricId])
      : ['minimum_results', 'minimum_metric', 'maximum_metric', 'target_range'].includes(target.targetKind)
        ? metrics[target.metricId]
        : undefined;
    if (!metric?.available || metric.value === null) return null;
    const rangeGood = target.targetKind === 'target_range'
      && target.targetMin != null
      && target.targetMax != null
      && metric.value >= target.targetMin
      && metric.value <= target.targetMax;
    const reference = target.targetKind === 'target_range'
      ? metric.value < (target.targetMin ?? 0) ? target.targetMin ?? target.targetValue : target.targetMax ?? target.targetValue
      : target.targetValue;
    const difference = metric.value - reference;
    const good = target.targetKind === 'target_range'
      ? rangeGood
      : target.targetKind === 'minimum_results' || target.targetKind === 'minimum_metric'
        ? difference >= 0
        : difference <= 0;
    return { difference, good };
  }, [metrics, target]);

  if (!target.active) return <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold text-brand-muted">Histórica</span>;
  if (!comparison) return <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-200">Sem comparação</span>;
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${comparison.good ? 'bg-emerald-400/10 text-emerald-200' : 'bg-rose-400/10 text-rose-200'}`}>
      {comparison.good ? 'Na meta' : 'Fora da meta'} · {comparison.difference.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
    </span>
  );
}
