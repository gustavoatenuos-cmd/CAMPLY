import { METRIC_REGISTRY, MetaObjective } from './metricRegistry';
export interface MetaRawAction {
  action_type?: string;
  value?: string | number | null;
}

export interface MetaRawInsight {
  actions?: MetaRawAction[] | null;
  action_values?: MetaRawAction[] | null;
  [field: string]: unknown;
}

export function normalizeMetaMetrics(
  rawInsights: MetaRawInsight[],
  classifiedObjective: MetaObjective,
  campaignId: string,
  adsetId?: string
) {
  const normalized: Record<string, number> = {};

  for (const [key, metricDef] of Object.entries(METRIC_REGISTRY)) {
    if (metricDef.compatibleObjectives !== 'ALL' && !metricDef.compatibleObjectives.includes(classifiedObjective)) {
      continue; // Skip if metric doesn't apply to this objective
    }

    let value = 0;
    let found = false;

    if (metricDef.source === 'insights') {
      const fbField = metricDef.id === 'link_clicks' ? 'inline_link_clicks' : metricDef.id; // basic mapping
      const sum = rawInsights.reduce((acc, row) => acc + Number(row[fbField] || 0), 0);
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
        // Look in action_values instead
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
        // Basic deduplication rule
        if (metricDef.deduplicationRule === 'priority_alias') {
           const priorityType = metricDef.acceptedActionTypes?.[0];
           const hasPriority = matchedActions.some(a => a.action_type === priorityType);
           if (hasPriority) {
              matchedActions = matchedActions.filter(a => a.action_type === priorityType);
           }
        }
        value = matchedActions.reduce((acc, a) => acc + Number(a.value || 0), 0);
      }
    } else if (metricDef.source === 'calculated') {
      // Defer calculation until all base metrics are computed
      continue;
    }

    if (found || metricDef.missingDataRule === 'zero') {
      normalized[key] = value;
    }
  }

  // Second pass for calculated metrics
  for (const [key, metricDef] of Object.entries(METRIC_REGISTRY)) {
    if (metricDef.source === 'calculated' && metricDef.calculate) {
      if (metricDef.compatibleObjectives === 'ALL' || metricDef.compatibleObjectives.includes(classifiedObjective)) {
        const calcValue = metricDef.calculate(normalized);
        if (calcValue !== null) {
          normalized[key] = calcValue;
        }
      }
    }
  }

  return normalized;
}
