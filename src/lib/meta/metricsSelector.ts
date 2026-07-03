/**
 * metricsSelector.ts
 * Selects the correct metrics to display for a campaign/client based on objective and category.
 */

import type { ClientCategory, MetaCampaignObjective } from '../../types';

export interface MetricDefinition {
  key: string;
  label: string;
  format: 'currency' | 'percent' | 'number' | 'multiplier';
  description: string;
  higherIsBetter: boolean; // true = alto é bom, false = baixo é bom
}

// Registry completo de métricas disponíveis
export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  spent: {
    key: 'spent', label: 'Gasto Total',
    format: 'currency', description: 'Valor total investido no período',
    higherIsBetter: false,
  },
  impressions: {
    key: 'impressions', label: 'Impressões',
    format: 'number', description: 'Número de vezes que o anúncio foi exibido',
    higherIsBetter: true,
  },
  reach: {
    key: 'reach', label: 'Alcance',
    format: 'number', description: 'Pessoas únicas que viram o anúncio',
    higherIsBetter: true,
  },
  frequency: {
    key: 'frequency', label: 'Frequência',
    format: 'number', description: 'Média de vezes que cada pessoa viu o anúncio',
    higherIsBetter: false,
  },
  cpm: {
    key: 'cpm', label: 'CPM',
    format: 'currency', description: 'Custo por mil impressões',
    higherIsBetter: false,
  },
  ctr: {
    key: 'ctr', label: 'CTR',
    format: 'percent', description: 'Taxa de cliques (% que clicou após ver)',
    higherIsBetter: true,
  },
  cpc: {
    key: 'cpc', label: 'CPC',
    format: 'currency', description: 'Custo por clique no link',
    higherIsBetter: false,
  },
  results: {
    key: 'results', label: 'Resultados',
    format: 'number', description: 'Total de conversões do objetivo principal',
    higherIsBetter: true,
  },
  cpr: {
    key: 'cpr', label: 'Custo por Resultado',
    format: 'currency', description: 'Custo médio por resultado/conversão',
    higherIsBetter: false,
  },
  leads: {
    key: 'leads', label: 'Leads',
    format: 'number', description: 'Formulários preenchidos / leads gerados',
    higherIsBetter: true,
  },
  cpl: {
    key: 'cpl', label: 'CPL',
    format: 'currency', description: 'Custo por lead gerado',
    higherIsBetter: false,
  },
  purchases: {
    key: 'purchases', label: 'Compras',
    format: 'number', description: 'Número de compras atribuídas',
    higherIsBetter: true,
  },
  cpa: {
    key: 'cpa', label: 'CPA',
    format: 'currency', description: 'Custo por aquisição (por compra)',
    higherIsBetter: false,
  },
  roas: {
    key: 'roas', label: 'ROAS',
    format: 'multiplier', description: 'Retorno sobre o investimento em anúncios',
    higherIsBetter: true,
  },
  pageViews: {
    key: 'pageViews', label: 'Visualizações de Página',
    format: 'number', description: 'Visitas ao link de destino',
    higherIsBetter: true,
  },
  checkouts: {
    key: 'checkouts', label: 'Checkouts',
    format: 'number', description: 'Inícios de checkout',
    higherIsBetter: true,
  },
};

// Métricas primárias por objetivo de campanha
const OBJECTIVE_METRICS: Record<string, string[]> = {
  'Reconhecimento':   ['spent', 'impressions', 'reach', 'frequency', 'cpm', 'ctr'],
  'Tráfego':          ['spent', 'cpc', 'ctr', 'pageViews', 'cpm', 'reach'],
  'Engajamento':      ['spent', 'results', 'cpr', 'reach', 'cpm', 'ctr'],
  'Cadastros':        ['spent', 'leads', 'cpl', 'ctr', 'cpc', 'cpm'],
  'Promoção do app':  ['spent', 'results', 'cpr', 'ctr', 'cpc', 'reach'],
  'Vendas':           ['spent', 'roas', 'purchases', 'cpa', 'ctr', 'cpm'],
  'MIXED':            ['spent', 'results', 'cpr', 'ctr', 'cpc', 'cpm'],
  'UNCLASSIFIED':     ['spent', 'results', 'cpr', 'ctr', 'cpc', 'cpm'],
};

// Métricas primárias por categoria de cliente (fallback quando sem objetivo)
const CATEGORY_METRICS: Record<ClientCategory, string[]> = {
  ecommerce:       ['spent', 'roas', 'cpa', 'purchases', 'ctr', 'cpm'],
  lead_generation: ['spent', 'cpl', 'leads', 'ctr', 'cpc', 'cpm'],
  local_business:  ['spent', 'reach', 'cpm', 'frequency', 'ctr', 'results'],
  saas:            ['spent', 'cpl', 'results', 'ctr', 'cpc', 'cpm'],
  content:         ['spent', 'reach', 'impressions', 'ctr', 'cpm', 'frequency'],
  other:           ['spent', 'results', 'cpr', 'ctr', 'cpc', 'cpm'],
};

/**
 * Returns the ordered list of MetricDefinition to display for a given campaign objective + client category.
 */
export function selectMetricsForCampaign(
  objective: MetaCampaignObjective | string | undefined,
  category: ClientCategory | undefined,
  maxMetrics = 6
): MetricDefinition[] {
  let keys: string[] = [];

  if (objective && OBJECTIVE_METRICS[objective]) {
    keys = OBJECTIVE_METRICS[objective];
  } else if (category && CATEGORY_METRICS[category]) {
    keys = CATEGORY_METRICS[category];
  } else {
    keys = OBJECTIVE_METRICS['UNCLASSIFIED'];
  }

  return keys
    .slice(0, maxMetrics)
    .map(k => METRIC_DEFINITIONS[k])
    .filter(Boolean);
}

/**
 * Returns all available metrics for a campaign (primary + secondary).
 */
export function getAllMetricsForCampaign(
  objective: MetaCampaignObjective | string | undefined,
  category: ClientCategory | undefined
): { primary: MetricDefinition[]; secondary: MetricDefinition[] } {
  const primary = selectMetricsForCampaign(objective, category, 6);
  const primaryKeys = new Set(primary.map(m => m.key));

  const secondary = Object.values(METRIC_DEFINITIONS).filter(m => !primaryKeys.has(m.key));

  return { primary, secondary };
}

/**
 * Format a metric value for display.
 */
export function formatMetricValue(key: string, value: number | undefined | null): string {
  if (value === undefined || value === null) return '—';
  const def = METRIC_DEFINITIONS[key];
  if (!def) return String(value);

  switch (def.format) {
    case 'currency':
      return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'multiplier':
      return `${value.toFixed(2)}x`;
    case 'number':
      return value >= 1000
        ? `${(value / 1000).toFixed(1)}k`
        : value.toLocaleString('pt-BR');
    default:
      return String(value);
  }
}

/**
 * Compare current vs previous value and return trend direction.
 */
export function calcTrend(
  current: number | undefined,
  previous: number | undefined,
  higherIsBetter: boolean
): 'up_good' | 'up_bad' | 'down_good' | 'down_bad' | 'neutral' {
  if (current === undefined || previous === undefined || previous === 0) return 'neutral';
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 2) return 'neutral';
  if (delta > 0) return higherIsBetter ? 'up_good' : 'up_bad';
  return higherIsBetter ? 'down_bad' : 'down_good';
}
