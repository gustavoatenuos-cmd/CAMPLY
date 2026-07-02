import { METRIC_REGISTRY, type MetaCanonicalMetric, type MetricValueMap } from './metricRegistry';

export interface RawSnapshotRecord {
  id: string;
  entity_level: 'campaign' | 'adset' | string;
  payload: unknown;
}

export interface NormalizedMetricRecord {
  id: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id?: string | null;
  creative_id?: string | null;
  metric_id: string;
  metric_value: number | string;
  action_type: string | null;
  source_field: string | null;
  date_start: string | null;
  date_stop: string | null;
  source_level: 'campaign' | 'adset' | 'ad' | null;
  attribution_setting: string | null;
  completeness_status: string | null;
  calculation_metadata?: { formula?: string } | null;
}

export interface AdSetEntityRecord {
  adset_id: string;
  campaign_id?: string;
  attribution_setting: string | null;
}

export interface ReconciliationResult {
  metricId: string;
  rawValue: number | undefined;
  normalizedValue: number;
  absoluteDifference: number | undefined;
  percentageDifference: number | undefined;
  formula: string;
  sourceAvailable: boolean;
}

type InsightRow = Record<string, unknown> & {
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  date_start?: string;
  date_stop?: string;
  actions?: Array<{ action_type?: string; value?: string | number }>;
  action_values?: Array<{ action_type?: string; value?: string | number }>;
};

const rowsFromSnapshots = (snapshots: RawSnapshotRecord[], level: string): InsightRow[] =>
  snapshots
    .filter((snapshot) => snapshot.entity_level === level && Array.isArray(snapshot.payload))
    .flatMap((snapshot) => snapshot.payload as InsightRow[]);

function matchingRows(
  metric: NormalizedMetricRecord,
  snapshots: RawSnapshotRecord[],
  adsets: AdSetEntityRecord[]
): InsightRow[] {
  if (metric.source_level === 'adset' && metric.adset_id) {
    const entity = adsets.find((candidate) => candidate.adset_id === metric.adset_id);
    const entityAttribution = entity?.attribution_setting || null;
    if (entityAttribution !== metric.attribution_setting) return [];
  } else if (metric.source_level === 'campaign' && metric.attribution_setting) {
    const campaignAdsets = adsets.filter((candidate) => candidate.campaign_id === metric.campaign_id);
    if (
      campaignAdsets.length > 0
      && !campaignAdsets.some((candidate) => candidate.attribution_setting === metric.attribution_setting)
    ) return [];
  }

  return rowsFromSnapshots(snapshots, metric.source_level || 'campaign').filter((row) => {
    const entityMatches = metric.source_level === 'ad'
      ? row.ad_id === metric.ad_id
      : metric.source_level === 'adset'
        ? row.adset_id === metric.adset_id
        : row.campaign_id === metric.campaign_id;
    return entityMatches
      && (metric.date_start === null || row.date_start === metric.date_start)
      && (metric.date_stop === null || row.date_stop === metric.date_stop);
  });
}

function actionValue(
  rows: InsightRow[],
  definition: MetaCanonicalMetric,
  acceptedTypes = definition.acceptedActionTypes || []
): number | undefined {
  const source = definition.id === 'purchase_value' ? 'action_values' : 'actions';
  let actions = rows.flatMap((row) => Array.isArray(row[source]) ? row[source] || [] : []);
  actions = actions.filter((action) => acceptedTypes.includes(action.action_type || ''));
  if (actions.length === 0) return definition.missingDataRule === 'zero' ? 0 : undefined;

  if (definition.deduplicationRule === 'priority_alias') {
    const priorityType = definition.acceptedActionTypes?.[0];
    if (actions.some((action) => action.action_type === priorityType)) {
      actions = actions.filter((action) => action.action_type === priorityType);
    }
  }
  return actions.reduce((total, action) => total + Number(action.value || 0), 0);
}

function directValue(
  rows: InsightRow[],
  definition: MetaCanonicalMetric,
  sourceField?: string | null
): number | undefined {
  const field = sourceField || (definition.id === 'link_clicks' ? 'inline_link_clicks' : definition.id);
  const present = rows.filter((row) => row[field] !== undefined && row[field] !== null);
  if (present.length === 0) return definition.missingDataRule === 'zero' ? 0 : undefined;
  return present.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function rawMetricValues(rows: InsightRow[]): MetricValueMap {
  const values: MetricValueMap = {};
  for (const [metricId, definition] of Object.entries(METRIC_REGISTRY)) {
    if (definition.source === 'insights') values[metricId] = directValue(rows, definition);
    if (definition.source === 'actions') values[metricId] = actionValue(rows, definition);
  }
  for (const [metricId, definition] of Object.entries(METRIC_REGISTRY)) {
    if (definition.source !== 'calculated' || !definition.calculate) continue;
    const calculated = definition.calculate(values);
    if (calculated !== null && Number.isFinite(calculated)) values[metricId] = calculated;
  }
  return values;
}

export function reconcileNormalizedMetric(
  metric: NormalizedMetricRecord,
  snapshots: RawSnapshotRecord[],
  adsets: AdSetEntityRecord[]
): ReconciliationResult {
  const rows = matchingRows(metric, snapshots, adsets);
  const definition = METRIC_REGISTRY[metric.metric_id];
  const values = definition ? rawMetricValues(rows) : {};
  const storedActionTypes = metric.action_type
    ?.split(',')
    .map((actionType) => actionType.trim())
    .filter(Boolean);
  const rawValue = definition?.source === 'insights'
    ? directValue(rows, definition, metric.source_field)
    : definition?.source === 'actions'
      ? actionValue(rows, definition, storedActionTypes?.length ? storedActionTypes : undefined)
      : definition
        ? values[metric.metric_id]
        : undefined;
  const normalizedValue = Number(metric.metric_value);
  const absoluteDifference = rawValue === undefined
    ? undefined
    : normalizedValue - rawValue;
  const percentageDifference = rawValue === undefined || rawValue === 0
    ? undefined
    : (absoluteDifference! / Math.abs(rawValue)) * 100;

  return {
    metricId: metric.metric_id,
    rawValue,
    normalizedValue,
    absoluteDifference,
    percentageDifference,
    formula: metric.calculation_metadata?.formula
      || (definition?.source === 'calculated'
        ? `${metric.metric_id} recalculated from compatible raw operands`
        : `sum(${metric.source_field || definition?.id || metric.metric_id})`),
    sourceAvailable: rows.length > 0 && rawValue !== undefined,
  };
}
