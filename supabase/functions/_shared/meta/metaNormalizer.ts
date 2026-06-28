import { METRIC_REGISTRY, MetaObjective, MetricValueMap } from './metricRegistry.ts';

export interface MetaRawAction {
  action_type?: string;
  value?: string | number | null;
}

export interface MetaRawInsight {
  actions?: MetaRawAction[] | null;
  action_values?: MetaRawAction[] | null;
  [field: string]: unknown;
}

export interface NormalizedMetricMetadata {
  raw_value?: number;
  source_field?: string;
  action_types?: string[];
  formula?: string;
  inputs?: MetricValueMap;
}

export interface NormalizedMetricResult {
  value: number;
  metadata: NormalizedMetricMetadata;
}

export function normalizeMetaMetrics(
  rawInsights: MetaRawInsight[],
  classifiedObjective: MetaObjective,
  campaignId: string,
  adsetId?: string
): Record<string, NormalizedMetricResult> {
  const normalized: Record<string, NormalizedMetricResult> = {};
  const flatValues: Record<string, number> = {};

  for (const [key, metricDef] of Object.entries(METRIC_REGISTRY)) {
    if (metricDef.compatibleObjectives !== 'ALL' && !metricDef.compatibleObjectives.includes(classifiedObjective)) {
      continue; 
    }

    let value = 0;
    let found = false;
    let rawValue: number | undefined;
    let sourceField: string | undefined;
    let actionTypes: string[] | undefined;

    if (metricDef.source === 'insights') {
      const fbField = metricDef.id === 'link_clicks' ? 'inline_link_clicks' : metricDef.id;
      sourceField = fbField;
      
      const sum = rawInsights.reduce((acc, row) => acc + Number(row[fbField] || 0), 0);
      rawValue = sum;
      
      if (sum > 0 || rawInsights.some(r => r[fbField] !== undefined)) {
        value = sum;
        found = true;
      }
    } else if (metricDef.source === 'actions') {
      let matchedActions: MetaRawAction[] = [];
      rawInsights.forEach(row => {
        if (row.actions && Array.isArray(row.actions)) {
          matchedActions.push(...row.actions.filter((action) =>
            action.action_type ? metricDef.acceptedActionTypes?.includes(action.action_type) : false
          ));
        }
      });

      if (metricDef.id === 'purchase_value') {
        matchedActions = [];
        rawInsights.forEach(row => {
          if (row.action_values && Array.isArray(row.action_values)) {
             matchedActions.push(...row.action_values.filter((action) =>
               action.action_type ? metricDef.acceptedActionTypes?.includes(action.action_type) : false
             ));
          }
        });
      }

      if (matchedActions.length > 0) {
        found = true;
        if (metricDef.deduplicationRule === 'priority_alias') {
           const priorityType = metricDef.acceptedActionTypes?.[0];
           const hasPriority = matchedActions.some(a => a.action_type === priorityType);
           if (hasPriority) {
              matchedActions = matchedActions.filter(a => a.action_type === priorityType);
           }
        }
        value = matchedActions.reduce((acc, a) => acc + Number(a.value || 0), 0);
        rawValue = value;
        sourceField = metricDef.id === 'purchase_value' ? 'action_values' : 'actions';
        actionTypes = Array.from(new Set(matchedActions.map(a => String(a.action_type))));
      }
    } else if (metricDef.source === 'calculated') {
      continue;
    }

    if (found || metricDef.missingDataRule === 'zero') {
      flatValues[key] = value;
      normalized[key] = {
        value,
        metadata: {
          raw_value: rawValue,
          source_field: sourceField,
          action_types: actionTypes,
        }
      };
    }
  }

  // Second pass for calculated metrics
  for (const [key, metricDef] of Object.entries(METRIC_REGISTRY)) {
    if (metricDef.source === 'calculated' && metricDef.calculate) {
      if (metricDef.compatibleObjectives === 'ALL' || metricDef.compatibleObjectives.includes(classifiedObjective)) {
        const calcValue = metricDef.calculate(flatValues);
        if (calcValue !== null) {
          flatValues[key] = calcValue;
          normalized[key] = {
            value: calcValue,
            metadata: {
              formula: `${key} recalculated from compatible additive metrics`,
              inputs: { ...flatValues },
            }
          };
        }
      }
    }
  }

  return normalized;
}
