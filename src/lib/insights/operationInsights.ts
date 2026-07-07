import { ClientDecisionState } from '../strategy/strategyDecisionEngine';

export interface OperationInsight {
  id: string;
  severity: 'info' | 'attention' | 'critical';
  clientId?: string;
  title: string;
  description: string;
  evidence: string[];
  nextBestAction: string;
  source: 'dashboard' | 'meta' | 'financeiro' | 'perfil' | 'sync';
}

export function generateDeterministicInsights(states: ClientDecisionState[]): OperationInsight[] {
  const insights: OperationInsight[] = [];

  for (const state of states) {
    // Insights de status de dados (Prioridade 1)
    if (state.dataStatus === 'sync_com_falha_recente') {
      insights.push({
        id: `sync_falha_${state.clientId}`,
        severity: 'attention',
        clientId: state.clientId,
        title: 'Sincronização com falha recente',
        description: 'A última tentativa de sincronização falhou, mas ainda existem dados confiáveis para leitura.',
        evidence: ['Tentativa de sincronização retornou erro.'],
        nextBestAction: 'Verifique se há bloqueios na conta Meta ou tente forçar sincronização novamente.',
        source: 'sync'
      });
    } else if (state.dataStatus === 'sem_sync' || state.dataStatus === 'periodo_nao_sincronizado') {
      insights.push({
        id: `sem_sync_${state.clientId}`,
        severity: 'attention',
        clientId: state.clientId,
        title: 'Sem dados atualizados no período',
        description: 'O cliente não possui dados sincronizados para o período solicitado.',
        evidence: ['Não foi encontrada corrida de sincronização válida no período.'],
        nextBestAction: 'Execute a sincronização manual pelo painel.',
        source: 'sync'
      });
    }

    // Insights operacionais de resultado (Prioridade 2)
    const spendNoResult = state.decisionSignals.find(s => s.id === 'spend_no_result');
    if (spendNoResult) {
      insights.push({
        id: `spend_no_result_${state.clientId}`,
        severity: 'critical',
        clientId: state.clientId,
        title: spendNoResult.title,
        description: spendNoResult.description,
        evidence: ['Existe gasto ativo.', `Nenhuma conversão principal de ${state.strategyType} registrada.`],
        nextBestAction: state.nextBestAction || 'Pause campanhas sem retorno e revise o funil.',
        source: 'meta'
      });
    }

    // Outras validações de sinais
    for (const signal of state.decisionSignals) {
      if (signal.id.startsWith('eval_') && signal.severity === 'critical') {
        insights.push({
          id: `metric_${signal.id}_${state.clientId}`,
          severity: 'critical',
          clientId: state.clientId,
          title: `Meta Crítica: ${signal.title}`,
          description: signal.description,
          evidence: [`Avaliação de meta: ${signal.metricId}`],
          nextBestAction: 'Intervenção imediata sugerida para corrigir o desvio da meta.',
          source: 'dashboard'
        });
      }
    }
  }

  // Agrupar e ordenar (críticos primeiro)
  return insights.sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (a.severity !== 'critical' && b.severity === 'critical') return 1;
    return 0;
  });
}
