/**
 * get_global_performance_dashboard_v2 sends `dataQuality.reason` as a raw
 * code — either a completeness_status value from meta_normalized_metrics
 * ('partial_page', 'rate_limit_exhausted', ...), a meta_sync_runs
 * termination_reason ('partial_collection', 'meta_api_error', ...), or a
 * free-text fallback (a raw error_message, or 'no_successful_run' /
 * 'newer_incomplete_attempt'). Showing that code as-is ("partial_page") to
 * an operator explains nothing. This maps every known code to a specific,
 * actionable sentence; anything unrecognized (almost always a free-text
 * error_message) is shown as-is, since that is still more useful than a
 * generic fallback.
 */
const KNOWN_REASONS: Record<string, string> = {
  no_successful_run: 'Nenhuma sincronização concluída com sucesso ainda.',
  newer_incomplete_attempt: 'A sincronização mais recente não terminou completa; a leitura mostra o último dado confiável.',
  partial_page: 'Coleta limitada pelo número máximo de páginas por sincronização — parte dos dados do período não foi buscada.',
  rate_limit_exhausted: 'A Meta limitou a taxa de requisições durante a sincronização e as tentativas de repetição se esgotaram.',
  timeout: 'A sincronização excedeu o tempo limite antes de concluir a coleta.',
  api_error: 'A Meta retornou um erro durante a coleta.',
  missing_insight_row: 'Algumas métricas não vieram na resposta da Meta para o período.',
  validation_error: 'Os dados retornados pela Meta não passaram na validação (moeda, fuso ou datas ausentes).',
  partial_collection: 'A sincronização coletou parte dos dados; outra parte não pôde ser concluída.',
  meta_api_error: 'A Meta retornou um erro durante a sincronização.',
  persistence_error: 'Falha ao salvar os dados coletados no banco.',
  unexpected_error: 'Erro inesperado durante a sincronização.',
};

export function describeDataQualityReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return KNOWN_REASONS[reason] ?? reason;
}
