import type { Client, Project } from '../../types';
import type { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import type { ClientAnalyticsDecision } from '../performance/clientAnalyticsDecision';
import type { GlobalClientStatus } from '../performance/globalPerformanceDashboard';
import type { ClientMetaAccount, MetaRunSummary } from '../meta/clientMetaAssetService';
import { isClientActive, isProjectActive, type OperationalEntry } from '../../data/receivablesForecast';

// Mesmo limiar de "sincronização desatualizada" usado em clientAnalyticsDecision.ts
// (STALE_DATA_HOURS). Mantido como constante própria em vez de importado porque os
// dois módulos avaliam entidades diferentes (cliente agregado vs. execução de sync
// por conta) e podem divergir de propósito no futuro.
const STALE_SYNC_HOURS = 24;

export type GlobalReadinessStatus = 'ready' | 'attention' | 'blocked' | 'inactive';
export type AnalyticsReadinessStatus = 'ready' | 'blocked' | 'limited';
export type MetaReadinessStatus = 'ready' | 'blocked' | 'partial' | 'stale' | 'failed';
export type FinanceReadinessStatus = 'ready' | 'blocked' | 'inactive';
export type CampaignsReadinessStatus = 'ready' | 'blocked' | 'partial' | 'stale';

export interface ReadinessArea<TStatus extends string> {
  status: TStatus;
  missing: string[];
  warnings: string[];
  action: string;
}

export interface ClientOperationalReadiness {
  clientId: string;
  globalStatus: GlobalReadinessStatus;
  analytics: ReadinessArea<AnalyticsReadinessStatus>;
  meta: ReadinessArea<MetaReadinessStatus>;
  finance: ReadinessArea<FinanceReadinessStatus>;
  campaigns: ReadinessArea<CampaignsReadinessStatus>;
}

export interface ClientOperationalReadinessInput {
  clientId: string;
  client: Client | null | undefined;
  project?: Project | null;
  analysisProfile: ClientAnalysisProfile | null | undefined;
  /**
   * Contas Meta já vinculadas a este cliente (do catálogo client_meta_assets).
   * Quando omitido (undefined, não array vazio), a área "meta" é derivada de
   * `globalClientStatus` - usado por telas que só têm o status agregado do
   * dashboard (GlobalClientStatus), não o catálogo bruto de contas/execuções.
   */
  metaAccounts?: ClientMetaAccount[];
  /**
   * Status agregado já calculado pelo backend (RPC do dashboard), usado como
   * origem da área "meta" quando `metaAccounts` não é fornecido.
   */
  globalClientStatus?: GlobalClientStatus;
  /**
   * Período avaliado (ex: 'this_month'), no mesmo formato usado em
   * availablePeriods/MetaRunSummary.period. Só é relevante quando `metaAccounts`
   * é fornecido (o caminho por `globalClientStatus` já vem resolvido para o
   * período atual pelo backend); por isso é opcional, com 'this_month' como default.
   */
  period?: string;
  /**
   * Lançamentos de Recebimentos deste cliente (mês atual + próximo), de
   * buildOperationalView. Opcional: quando omitido (undefined), a área
   * "finance" fica com status 'blocked' por falta de dado - só forneça esta
   * lista em telas que realmente carregam Recebimentos (não use [] "fake" para
   * telas que simplesmente não modelam essa área, já que isso reportaria
   * "blocked" de forma enganosa; nesses casos, ignore `readiness.finance`).
   */
  receivableEntries?: OperationalEntry[];
  currentDate?: Date;
  /**
   * Resultado já computado de buildClientAnalyticsDecision, quando disponível.
   * Opcional: quando ausente, a área "analytics" é derivada apenas do estado de
   * sincronização Meta (mais raso, mas não exige montar o contrato completo do
   * decision engine em telas que não o carregam, ex: Recebimentos/Clientes).
   */
  analyticsDecision?: Pick<ClientAnalyticsDecision, 'status'> | null;
}

function runForPeriod(account: ClientMetaAccount, period: string): MetaRunSummary | null {
  const success = account.lastSuccess && account.lastSuccess.period === period ? account.lastSuccess : null;
  const attempt = account.lastAttempt && account.lastAttempt.period === period ? account.lastAttempt : null;
  if (success && attempt) {
    // O tentativa mais recente é a última palavra sobre o período, mesmo que um
    // sucesso anterior também exista (ex: sucesso seguido de uma nova tentativa parcial).
    return new Date(attempt.startedAt) >= new Date(success.startedAt) ? attempt : success;
  }
  return attempt || success;
}

function hoursSince(iso: string | null | undefined, currentDate: Date): number | null {
  if (!iso) return null;
  return (currentDate.getTime() - new Date(iso).getTime()) / (60 * 60 * 1000);
}

function isRunStale(run: MetaRunSummary, currentDate: Date): boolean {
  if (run.status !== 'success' || !run.finishedAt) return false;
  const hours = hoursSince(run.finishedAt, currentDate);
  return hours !== null && hours >= STALE_SYNC_HOURS;
}

function evaluateMeta(
  metaAccounts: ClientMetaAccount[],
  period: string,
  currentDate: Date
): ReadinessArea<MetaReadinessStatus> {
  if (metaAccounts.length === 0) {
    return { status: 'blocked', missing: ['Conta Meta não vinculada'], warnings: [], action: 'Vincular conta Meta' };
  }

  const runs = metaAccounts
    .map((account) => runForPeriod(account, period))
    .filter((run): run is MetaRunSummary => run !== null);

  if (runs.length === 0) {
    return {
      status: 'blocked',
      missing: ['Sincronização do período pendente'],
      warnings: [],
      action: 'Sincronizar Meta',
    };
  }

  const warnings: string[] = [];
  const hasRunning = runs.some((run) => run.status === 'running');
  if (hasRunning) warnings.push('Sincronização em andamento');

  const hasSuccess = runs.some((run) => run.status === 'success');
  const hasPartial = runs.some((run) => run.status === 'partial');
  const hasFailed = runs.some((run) => run.status === 'failed');

  // Só "running" (nenhum resultado terminal ainda para o período) - não bloquear
  // com a ação genérica de sincronizar, que sugeriria disparar um sync duplicado
  // enquanto um já está em andamento.
  if (hasRunning && !hasSuccess && !hasPartial && !hasFailed) {
    return {
      status: 'blocked',
      missing: [],
      warnings,
      action: 'Aguardar sincronização em andamento',
    };
  }

  if (hasFailed && !hasSuccess && !hasPartial) {
    return {
      status: 'failed',
      missing: [],
      warnings: [...warnings, 'Última sincronização falhou'],
      action: 'Corrigir falha de sincronização',
    };
  }

  // Partial nunca deve ser mascarado como sucesso total, mesmo que outra conta do
  // mesmo cliente tenha sincronizado com sucesso.
  if (hasPartial) {
    return {
      status: 'partial',
      missing: [],
      warnings: [...warnings, 'Leitura parcial — análise limitada'],
      action: 'Revisar sincronização parcial',
    };
  }

  const successRuns = runs.filter((run) => run.status === 'success');
  if (hasSuccess && successRuns.every((run) => isRunStale(run, currentDate))) {
    return {
      status: 'stale',
      missing: [],
      warnings: [...warnings, `Última sincronização com mais de ${STALE_SYNC_HOURS}h`],
      action: 'Sincronizar Meta novamente',
    };
  }

  if (hasSuccess) {
    return { status: 'ready', missing: [], warnings, action: '' };
  }

  return {
    status: 'blocked',
    missing: ['Sincronização do período pendente'],
    warnings,
    action: 'Sincronizar Meta',
  };
}

/**
 * Deriva a área "meta" a partir do status agregado do dashboard (GlobalClientStatus),
 * para telas que não têm o catálogo bruto de contas Meta (ex: cards do dashboard
 * principal, que já resolvem esse status via RPC no backend).
 */
function evaluateMetaFromGlobalStatus(status: GlobalClientStatus): ReadinessArea<MetaReadinessStatus> {
  switch (status) {
    case 'not_connected':
      return { status: 'blocked', missing: ['Conta Meta não vinculada'], warnings: [], action: 'Vincular conta Meta' };
    case 'never_synced':
    case 'period_not_synced':
      return {
        status: 'blocked',
        missing: ['Sincronização do período pendente'],
        warnings: [],
        action: 'Sincronizar Meta',
      };
    case 'sync_without_metrics':
      return {
        status: 'blocked',
        missing: ['Sincronização sem métricas normalizadas'],
        warnings: [],
        action: 'Sincronizar Meta',
      };
    case 'syncing':
      return {
        status: 'blocked',
        missing: [],
        warnings: ['Sincronização em andamento'],
        action: 'Aguardar sincronização em andamento',
      };
    case 'failed':
      return {
        status: 'failed',
        missing: [],
        warnings: ['Última sincronização falhou'],
        action: 'Corrigir falha de sincronização',
      };
    case 'partial':
      return {
        status: 'partial',
        missing: [],
        warnings: ['Leitura parcial — análise limitada'],
        action: 'Revisar sincronização parcial',
      };
    case 'stale':
      return {
        status: 'stale',
        missing: [],
        warnings: [`Última sincronização com mais de ${STALE_SYNC_HOURS}h`],
        action: 'Sincronizar Meta novamente',
      };
    case 'no_delivery':
      return { status: 'ready', missing: [], warnings: ['Sem entrega no período'], action: '' };
    case 'available':
    default:
      return { status: 'ready', missing: [], warnings: [], action: '' };
  }
}

function hasUsableProfile(profile: ClientAnalysisProfile | null | undefined): boolean {
  return Boolean(profile && profile.analysisEnabled && profile.primaryConversionMetric);
}

function evaluateAnalytics(
  analysisProfile: ClientAnalysisProfile | null | undefined,
  meta: ReadinessArea<MetaReadinessStatus>,
  analyticsDecision: Pick<ClientAnalyticsDecision, 'status'> | null | undefined
): ReadinessArea<AnalyticsReadinessStatus> {
  if (!hasUsableProfile(analysisProfile)) {
    return {
      status: 'blocked',
      missing: ['Perfil de análise não configurado'],
      warnings: [],
      action: 'Configurar metas do cliente',
    };
  }

  if (analyticsDecision) {
    if (analyticsDecision.status === 'no_profile') {
      return {
        status: 'blocked',
        missing: ['Perfil de análise não configurado'],
        warnings: [],
        action: 'Configurar metas do cliente',
      };
    }
    if (analyticsDecision.status === 'no_data') {
      return meta.status === 'blocked'
        ? { status: 'blocked', missing: meta.missing, warnings: [], action: meta.action }
        : { status: 'blocked', missing: ['Sincronização do período pendente'], warnings: [], action: 'Sincronizar Meta' };
    }
    if (analyticsDecision.status === 'stale_data') {
      return {
        status: 'limited',
        missing: [],
        warnings: [`Dados desatualizados (mais de ${STALE_SYNC_HOURS}h sem sincronização)`],
        action: 'Sincronizar Meta novamente',
      };
    }
    // healthy | attention | critical: dados existem e são analisáveis - o veredito
    // de performance em si é responsabilidade do decision engine, não da prontidão.
    return meta.status === 'partial'
      ? {
          status: 'limited',
          missing: [],
          warnings: ['Sincronização parcial: alguns dados podem estar incompletos'],
          action: 'Revisar sincronização parcial',
        }
      : { status: 'ready', missing: [], warnings: [], action: '' };
  }

  // Sem decision engine pré-computado: deriva do estado de sincronização Meta já avaliado.
  if (meta.status === 'blocked') {
    return { status: 'blocked', missing: meta.missing, warnings: [], action: meta.action };
  }
  if (meta.status === 'failed') {
    return { status: 'blocked', missing: [], warnings: [], action: 'Corrigir falha de sincronização' };
  }
  if (meta.status === 'partial') {
    return {
      status: 'limited',
      missing: [],
      warnings: ['Sincronização parcial: alguns dados podem estar incompletos'],
      action: 'Revisar sincronização parcial',
    };
  }
  if (meta.status === 'stale') {
    return {
      status: 'limited',
      missing: [],
      warnings: [`Dados desatualizados (mais de ${STALE_SYNC_HOURS}h sem sincronização)`],
      action: 'Sincronizar Meta novamente',
    };
  }
  return { status: 'ready', missing: [], warnings: [], action: '' };
}

function evaluateCampaigns(meta: ReadinessArea<MetaReadinessStatus>): ReadinessArea<CampaignsReadinessStatus> {
  if (meta.status === 'failed') {
    return {
      status: 'blocked',
      missing: [],
      warnings: ['Última sincronização falhou'],
      action: 'Corrigir falha de sincronização',
    };
  }
  if (meta.status === 'blocked') {
    return { status: 'blocked', missing: meta.missing, warnings: [], action: meta.action };
  }
  if (meta.status === 'partial') {
    return {
      status: 'partial',
      missing: [],
      warnings: ['Sincronização parcial: dados de campanha podem estar incompletos'],
      action: 'Revisar sincronização parcial',
    };
  }
  if (meta.status === 'stale') {
    return { status: 'stale', missing: [], warnings: meta.warnings, action: 'Sincronizar Meta novamente' };
  }
  return { status: 'ready', missing: [], warnings: [], action: '' };
}

function evaluateFinance(
  client: Client | null | undefined,
  project: Project | null | undefined,
  entries: OperationalEntry[]
): ReadinessArea<FinanceReadinessStatus> {
  // client === null/undefined significa "esta tela não carrega o registro do
  // cliente" (ex: MetaIntegrationView, ClientCampaignDrawer), não "cliente
  // inativo" - só declarar 'inactive' quando há um Client real e ele (ou o
  // projeto) está de fato inativo, para não forçar globalStatus: 'inactive'
  // em telas que simplesmente não modelam essa área.
  if (client != null && (!isClientActive(client) || !isProjectActive(project ?? undefined))) {
    return {
      status: 'inactive',
      missing: [],
      warnings: [],
      action: 'Cliente/projeto inativo — fora da operação financeira principal',
    };
  }

  const activeEntries = entries.filter((entry) => entry.active);
  const warnings = activeEntries.some((entry) => entry.status === 'overdue') ? ['Cobrança em atraso'] : [];

  if (activeEntries.length === 0) {
    return {
      status: 'blocked',
      missing: ['Cobrança recorrente não configurada para o mês atual/próximo'],
      warnings,
      action: 'Configurar cobrança do cliente',
    };
  }

  return { status: 'ready', missing: [], warnings, action: '' };
}

function computeGlobalStatus(
  analytics: ReadinessArea<AnalyticsReadinessStatus>,
  meta: ReadinessArea<MetaReadinessStatus>,
  finance: ReadinessArea<FinanceReadinessStatus>,
  campaigns: ReadinessArea<CampaignsReadinessStatus>
): GlobalReadinessStatus {
  if (finance.status === 'inactive') return 'inactive';

  const statuses: string[] = [analytics.status, meta.status, finance.status, campaigns.status];
  if (statuses.includes('blocked') || statuses.includes('failed')) return 'blocked';

  const attentionStatuses = ['limited', 'partial', 'stale'];
  if (statuses.some((status) => attentionStatuses.includes(status))) return 'attention';

  return 'ready';
}

/** Avalia, de forma determinística, se um cliente está pronto para cada área do sistema. */
export function evaluateClientOperationalReadiness(
  input: ClientOperationalReadinessInput
): ClientOperationalReadiness {
  const currentDate = input.currentDate ?? new Date();
  const period = input.period ?? 'this_month';
  const meta = input.metaAccounts !== undefined
    ? evaluateMeta(input.metaAccounts, period, currentDate)
    : input.globalClientStatus !== undefined
      ? evaluateMetaFromGlobalStatus(input.globalClientStatus)
      : evaluateMeta([], period, currentDate);
  const analytics = evaluateAnalytics(input.analysisProfile, meta, input.analyticsDecision);
  const campaigns = evaluateCampaigns(meta);
  const finance = evaluateFinance(input.client, input.project, input.receivableEntries ?? []);

  return {
    clientId: input.clientId,
    globalStatus: computeGlobalStatus(analytics, meta, finance, campaigns),
    analytics,
    meta,
    finance,
    campaigns,
  };
}

export interface AggregatedMetaReadinessSummary {
  total: number;
  readyCount: number;
  partialCount: number;
  staleCount: number;
  failedCount: number;
  /** Verdadeiro quando nenhum cliente do conjunto tem leitura Meta pronta. */
  allDegraded: boolean;
  /** Causa (mensagem de warning) mais frequente entre os clientes degradados, se houver. */
  dominantCause: string | null;
}

/** Agrega o estado Meta de vários clientes para exibir uma causa comum, ex: "todas as contas com sincronização parcial". */
export function summarizeMetaReadinessAcrossClients(
  metaAreas: Array<Pick<ReadinessArea<MetaReadinessStatus>, 'status' | 'warnings'>>
): AggregatedMetaReadinessSummary {
  const total = metaAreas.length;
  const readyCount = metaAreas.filter((area) => area.status === 'ready').length;
  const partialCount = metaAreas.filter((area) => area.status === 'partial').length;
  const staleCount = metaAreas.filter((area) => area.status === 'stale').length;
  const failedCount = metaAreas.filter((area) => area.status === 'failed').length;

  const causeCounts = new Map<string, number>();
  metaAreas.forEach((area) => {
    area.warnings.forEach((warning) => causeCounts.set(warning, (causeCounts.get(warning) ?? 0) + 1));
  });
  let dominantCause: string | null = null;
  let dominantCount = 0;
  causeCounts.forEach((count, cause) => {
    if (count > dominantCount) {
      dominantCount = count;
      dominantCause = cause;
    }
  });

  return {
    total,
    readyCount,
    partialCount,
    staleCount,
    failedCount,
    allDegraded: total > 0 && readyCount === 0,
    dominantCause,
  };
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

function joinWithE(items: string[]): string {
  const normalized = items.map(lowerFirst);
  if (normalized.length === 1) return normalized[0];
  return `${normalized.slice(0, -1).join(', ')} e ${normalized[normalized.length - 1]}`;
}

/** Constrói a frase única exibida no ClientReadinessBanner/Checklist para um cliente. */
export function buildReadinessSummaryMessage(readiness: ClientOperationalReadiness): string {
  const allMissing = [
    ...readiness.analytics.missing,
    ...readiness.meta.missing,
    ...readiness.campaigns.missing,
    ...readiness.finance.missing,
  ];
  const allWarnings = [
    ...readiness.analytics.warnings,
    ...readiness.meta.warnings,
    ...readiness.campaigns.warnings,
    ...readiness.finance.warnings,
  ];

  if (readiness.globalStatus === 'inactive') {
    return 'Cliente ou projeto inativo — fora da operação principal.';
  }
  if (readiness.globalStatus === 'blocked' && allMissing.length > 0) {
    return `Este cliente ainda não pode ser analisado: falta ${joinWithE(allMissing)}.`;
  }
  if (readiness.globalStatus === 'attention' && allWarnings.length > 0) {
    return allWarnings.join(' ');
  }
  return 'Cliente pronto para análise.';
}
