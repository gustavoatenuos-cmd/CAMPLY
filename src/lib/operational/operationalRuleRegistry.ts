import { EntityType, SeverityLevel, AgentRule } from '../../types';

export interface RuleDefinition {
  id: string; // e.g., 'task_overdue'
  entityType: EntityType;
  conditionType: string;
  defaultEnabled: boolean;
  defaultSeverity: SeverityLevel;
  defaultThreshold?: number;
  unit?: 'days' | 'hours' | 'count' | 'percent';
  minThreshold?: number;
  maxThreshold?: number;
  configurable: boolean;
  version: string;
}

export const operationalRuleRegistry: Record<string, RuleDefinition> = {
  // Task Rules
  task_overdue: {
    id: 'task_overdue',
    entityType: 'task',
    conditionType: 'overdue',
    defaultEnabled: true,
    defaultSeverity: 'critical',
    configurable: true,
    version: '1.0',
  },
  task_deadline_today: {
    id: 'task_deadline_today',
    entityType: 'task',
    conditionType: 'deadline_today',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    configurable: true,
    version: '1.0',
  },
  
  // Project Rules
  project_overdue: {
    id: 'project_overdue',
    entityType: 'project',
    conditionType: 'overdue',
    defaultEnabled: true,
    defaultSeverity: 'critical',
    configurable: true,
    version: '1.0',
  },
  project_deadline_today: {
    id: 'project_deadline_today',
    entityType: 'project',
    conditionType: 'deadline_today',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    configurable: true,
    version: '1.0',
  },
  project_idle_days: {
    id: 'project_idle_days',
    entityType: 'project',
    conditionType: 'idle_days',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultThreshold: 7,
    unit: 'days',
    minThreshold: 1,
    maxThreshold: 90,
    configurable: true,
    version: '1.0',
  },
  
  // Campaign Rules
  campaign_idle_days: {
    id: 'campaign_idle_days',
    entityType: 'campaign',
    conditionType: 'idle_days',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultThreshold: 3,
    unit: 'days',
    minThreshold: 1,
    maxThreshold: 30,
    configurable: true,
    version: '1.0',
  },
  campaign_budget_consumption: {
    id: 'campaign_budget_consumption',
    entityType: 'campaign',
    conditionType: 'operational_budget_consumption',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultThreshold: 70, // will warn at 70%, critical at 90% (handled in logic)
    unit: 'percent',
    minThreshold: 1,
    maxThreshold: 100,
    configurable: true,
    version: '1.0',
  },
  campaign_high_cost: {
    id: 'campaign_high_cost',
    entityType: 'campaign',
    conditionType: 'high_cost',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    configurable: true,
    version: '1.0',
  },
  
  // Receivable Rules
  receivable_overdue: {
    id: 'receivable_overdue',
    entityType: 'receivable',
    conditionType: 'pagamento_atrasado',
    defaultEnabled: true,
    defaultSeverity: 'critical',
    configurable: true,
    version: '1.0',
  },
  receivable_upcoming: {
    id: 'receivable_upcoming',
    entityType: 'receivable',
    conditionType: 'pagamento_proximo',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    defaultThreshold: 3,
    unit: 'days',
    minThreshold: 1,
    maxThreshold: 15,
    configurable: true,
    version: '1.0',
  },
  
  // Client Rules
  client_many_pending: {
    id: 'client_many_pending',
    entityType: 'client',
    conditionType: 'many_pending',
    defaultEnabled: true,
    defaultSeverity: 'critical',
    defaultThreshold: 3,
    unit: 'count',
    minThreshold: 1,
    maxThreshold: 20,
    configurable: true,
    version: '1.0',
  },
};

/**
 * Resolves the configuration for a given rule definition, applying overrides from
 * the active agentRules if they exist.
 */
export function resolveRuleConfiguration(definition: RuleDefinition, activeRules: AgentRule[] = []): { enabled: boolean; severity: SeverityLevel; threshold: number | undefined } {
  const override = activeRules.find(r => r.conditionType === definition.conditionType && r.entityType === definition.entityType);
  
  if (override) {
    return {
      enabled: override.enabled ?? definition.defaultEnabled,
      severity: override.severity || definition.defaultSeverity,
      threshold: override.thresholdValue !== undefined ? override.thresholdValue : definition.defaultThreshold,
    };
  }
  
  return {
    enabled: definition.defaultEnabled,
    severity: definition.defaultSeverity,
    threshold: definition.defaultThreshold,
  };
}
