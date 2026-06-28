import { METRIC_REGISTRY, MetaObjective } from './metricRegistry';
import { classifyCampaignObjective, ClassifierEntityContext } from './campaignObjectiveClassifier';

export interface NormalizedMetricResult {
  value: number;
  metadata: any;
}

export function normalizeMetaMetrics(
  rawInsights: any[],
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
    let rawValue: any = undefined;
    let formulaOrAction = '';

    if (metricDef.source === 'insights') {
      const fbField = metricDef.id === 'link_clicks' ? 'inline_link_clicks' : metricDef.id;
      formulaOrAction = `Source field: ${fbField}`;
      
      const sum = rawInsights.reduce((acc, row) => acc + Number(row[fbField] || 0), 0);
      rawValue = sum;
      
      if (sum > 0 || rawInsights.some(r => r[fbField] !== undefined)) {
        value = sum;
        found = true;
      }
    } else if (metricDef.source === 'actions') {
      let matchedActions: any[] = [];
      rawInsights.forEach(row => {
        if (row.actions && Array.isArray(row.actions)) {
          matchedActions.push(...row.actions.filter((a: any) => metricDef.acceptedActionTypes?.includes(a.action_type)));
        }
      });

      if (metricDef.id === 'purchase_value') {
        matchedActions = [];
        rawInsights.forEach(row => {
          if (row.action_values && Array.isArray(row.action_values)) {
             matchedActions.push(...row.action_values.filter((a: any) => metricDef.acceptedActionTypes?.includes(a.action_type)));
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
        formulaOrAction = `Actions: ${Array.from(new Set(matchedActions.map(a => a.action_type))).join(', ')}`;
      } else {
        formulaOrAction = `No matching actions found for ${metricDef.acceptedActionTypes?.join(', ')}`;
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
          action_type: formulaOrAction
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
              raw_value: calcValue,
              formula: 'Calculated metric based on ' + (metricDef.denominator ? metricDef.denominator : 'other metrics')
            }
          };
        }
      }
    }
  }

  return normalized;
}
