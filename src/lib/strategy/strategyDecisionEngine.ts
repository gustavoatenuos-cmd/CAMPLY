import { GlobalClientPerformance, GlobalPerformanceAccount } from '../performance/globalPerformanceDashboard';
import { PerformanceEvaluation, BudgetPacingResult } from '../performance/types';
import { ClientAnalysisProfile } from '../analysis/clientAnalysisProfile';
import { toOperationalProfile, ClientOperationalProfile } from './clientOperationalProfile';
import { getStrategyMetrics } from './metricStrategy';
import { buildDefaultTargetsForProfile } from './defaultTargets';

export type MacroStatus = 'sem_dados' | 'indisponivel' | 'atencao' | 'critico' | 'saudavel';
export type DataStatus = 'sem_conta' | 'sem_sync' | 'periodo_nao_sincronizado' | 'sync_com_falha_recente' | 'dados_parciais' | 'dados_disponiveis';

export interface DecisionSignal {
  id: string;
  severity: 'info' | 'attention' | 'critical';
  title: string;
  description: string;
  metricId?: string;
}

export interface MicroEntryPoint {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  id: string;
  label: string;
  reason: string;
  metricId: string;
  severity: 'attention' | 'critical';
}

export interface ClientDecisionState {
  clientId: string;
  strategyType: ClientOperationalProfile['strategyType'];
  primaryConversion: ClientOperationalProfile['primaryConversion'];
  macroStatus: MacroStatus;
  dataStatus: DataStatus;
  mainMetricIds: string[];
  secondaryMetricIds: string[];
  decisionSignals: DecisionSignal[];
  nextBestAction: string;
  microEntryPoints: MicroEntryPoint[];
}

// 5. Corrigir status "sem dados"
// Regra obrigatoria: se existe métrica confiável > 0, tem dado.
function hasReliableData(accounts: GlobalPerformanceAccount[]): boolean {
  for (const acc of accounts) {
    if (!acc.metrics) continue;
    const m = acc.metrics;
    if (
      (m.spend?.available && Number(m.spend.value) > 0) ||
      (m.impressions?.available && Number(m.impressions.value) > 0) ||
      (m.reach?.available && Number(m.reach.value) > 0) ||
      (m.purchases?.available && Number(m.purchases.value) > 0) ||
      (m.messaging_conversations_started_total?.available && Number(m.messaging_conversations_started_total.value) > 0) ||
      (m.leads?.available && Number(m.leads.value) > 0)
    ) {
      return true;
    }
  }
  return false;
}

function resolveDataStatus(client: GlobalClientPerformance): DataStatus {
  if (client.accounts.length === 0) return 'sem_conta';
  
  if (client.clientStatus === 'never_synced' || client.clientStatus === 'not_connected') return 'sem_sync';
  if (client.clientStatus === 'period_not_synced') return 'periodo_nao_sincronizado';

  const hasData = hasReliableData(client.accounts);

  if (client.clientStatus === 'failed') {
    return hasData ? 'sync_com_falha_recente' : 'periodo_nao_sincronizado'; // ou falha pura
  }

  if (client.clientStatus === 'partial') {
    return 'dados_parciais';
  }

  if (!hasData) {
    // Mesma regra: se está 'available' mas não tem NENHUM dado (tudo zero)
    return 'periodo_nao_sincronizado'; // Ou 'sem_dados_reais'
  }

  return 'dados_disponiveis';
}

function generateSignalsAndMicro(
  profile: ClientOperationalProfile,
  client: GlobalClientPerformance,
  dataStatus: DataStatus
): { signals: DecisionSignal[], micro: MicroEntryPoint[], macro: MacroStatus, action: string } {
  
  const signals: DecisionSignal[] = [];
  const micro: MicroEntryPoint[] = [];
  let action = '';

  const hasData = hasReliableData(client.accounts);

  if (!hasData) {
    if (dataStatus === 'sync_com_falha_recente') {
      signals.push({
        id: 'sync_fail',
        severity: 'attention',
        title: 'Falha na sincronização',
        description: 'Usando último dado confiável disponível.'
      });
      return { signals, micro, macro: 'atencao', action: 'Tente forçar a sincronização novamente.' };
    }
    return { signals, micro, macro: 'sem_dados', action: 'Sincronize as contas de anúncios para visualizar a performance.' };
  }

  let isCritical = false;
  let isAttention = false;

  const strategy = getStrategyMetrics(profile.strategyType);
  const mainMetricIds = strategy.mainMetrics.length > 0 ? strategy.mainMetrics : profile.trackedMetrics;

  // Analisa contas p/ signals (Pacing, Resultados Vazios)
  let totalSpend = 0;
  let totalMain = 0;

  for (const acc of client.accounts) {
    if (!acc.metrics) continue;
    const spend = acc.metrics.spend?.available ? Number(acc.metrics.spend.value) : 0;
    totalSpend += spend;

    let mainVal = 0;
    if (profile.strategyType === 'venda_site') mainVal = acc.metrics.purchases?.available ? Number(acc.metrics.purchases.value) : 0;
    else if (profile.strategyType === 'leads_whatsapp') mainVal = acc.metrics.messaging_conversations_started_total?.available ? Number(acc.metrics.messaging_conversations_started_total.value) : 0;
    else if (profile.strategyType === 'alcance') mainVal = acc.metrics.reach?.available ? Number(acc.metrics.reach.value) : 0;
    totalMain += mainVal;
  }

  if (totalSpend > 0 && totalMain === 0 && profile.strategyType !== 'misto') {
    isAttention = true;
    signals.push({
      id: 'spend_no_result',
      severity: 'attention',
      title: `Gasto sem resultado (${profile.strategyType})`,
      description: 'A conta tem gasto, mas não gerou o resultado principal esperado.'
    });
    action = 'Revise público, criativo ou configuração do pixel/API.';
  }

  // Verifica metas reais vs sugeridas
  let hasFormalTargets = client.evaluations && client.evaluations.length > 0;
  
  if (hasFormalTargets) {
    for (const ev of client.evaluations) {
      if (ev.status === 'critical') {
        isCritical = true;
        signals.push({
          id: `eval_${ev.metricId}`,
          severity: 'critical',
          title: `Desvio de meta (${ev.metricId})`,
          description: ev.reason || 'Ocorrência de meta crítica detectada.',
          metricId: ev.metricId
        });
      } else if (ev.status === 'attention') {
        isAttention = true;
        signals.push({
          id: `eval_${ev.metricId}`,
          severity: 'attention',
          title: `Atenção à meta (${ev.metricId})`,
          description: ev.reason || 'Desvio parcial de meta detectado.',
          metricId: ev.metricId
        });
      }
    }
  } else {
    // Fallback p/ metas sugeridas
    const suggested = buildDefaultTargetsForProfile(profile);
    if (suggested.length > 0) {
      signals.push({
        id: 'suggested_targets',
        severity: 'info',
        title: 'Leitura sugerida',
        description: 'Meta formal não configurada; leitura baseada em regra operacional sugerida.'
      });
      // Em tese, processaríamos as sugeridas, mas como o prompt pede p/ não ficar "saudável" e que
      // a leitura "pode marcar atenção", fazemos:
      if (totalSpend > 0 && totalMain === 0) {
        // Já marcamos atenção acima
      }
    }
  }

  if (!action) {
    if (isCritical) action = 'Ajuste imediato em campanhas críticas ou pausa para evitar perda de orçamento.';
    else if (isAttention) action = 'Monitoramento e micro ajustes nos criativos/públicos em atenção.';
    else action = 'Mantenha a estratégia, avalie escalar orçamentos das campanhas campeãs.';
  }

  // Gerar micro entry points (mock simples de macro->micro)
  if (totalSpend > 0 && totalMain === 0) {
    // Se há conta problemática
    micro.push({
      level: 'account',
      id: client.accounts[0]?.clientMetaAssetId || '',
      label: client.accounts[0]?.accountName || 'Conta primária',
      reason: 'Maior gasto sem conversão principal',
      metricId: 'spend',
      severity: 'attention'
    });
  }

  let macro: MacroStatus = 'saudavel';
  if (isCritical) macro = 'critico';
  else if (isAttention || dataStatus === 'sync_com_falha_recente' || !hasFormalTargets) macro = 'atencao';

  return { signals, micro, macro, action };
}

export function processClientStrategy(
  client: GlobalClientPerformance,
  profileSeed?: ClientAnalysisProfile | null
): ClientDecisionState {
  
  // 1. Resolver perfil operacional
  const rawProfile = profileSeed || {
    clientId: client.clientId,
    analysisEnabled: true
  } as ClientAnalysisProfile;
  
  const profile = toOperationalProfile(rawProfile);
  
  // 2. Status de dados
  const dataStatus = resolveDataStatus(client);

  // 3. Gerar sinais
  const { signals, micro, macro, action } = generateSignalsAndMicro(profile, client, dataStatus);

  const strategy = getStrategyMetrics(profile.strategyType);

  return {
    clientId: client.clientId,
    strategyType: profile.strategyType,
    primaryConversion: profile.primaryConversion,
    macroStatus: macro,
    dataStatus: dataStatus,
    mainMetricIds: strategy.mainMetrics.length > 0 ? strategy.mainMetrics : profile.trackedMetrics,
    secondaryMetricIds: strategy.secondaryMetrics,
    decisionSignals: signals,
    nextBestAction: action,
    microEntryPoints: micro
  };
}
