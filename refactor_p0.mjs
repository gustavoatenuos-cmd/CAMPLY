import fs from 'fs';

// 1. types.ts - Make lastDetectedAt and occurrenceCount mandatory
let typesStr = fs.readFileSync('src/types.ts', 'utf-8');
typesStr = typesStr.replace(/lastDetectedAt\?: string;/g, 'lastDetectedAt: string;');
typesStr = typesStr.replace(/occurrenceCount\?: number;/g, 'occurrenceCount: number;');
fs.writeFileSync('src/types.ts', typesStr);

// 2. operationalRuleRegistry.ts - Add min/max, configurations and remove high cost manual
const ruleRegistryContent = `import { AgentRule } from '../types';

export type SeverityLevel = 'critical' | 'warning' | 'good' | 'info';

export interface ResolvedRuleConfiguration {
  enabled: boolean;
  severity: SeverityLevel;
  threshold?: number;
  configurationSource: 'user' | 'system_default' | 'invalid_fallback';
  version: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  description: string;
  defaultSeverity: SeverityLevel;
  configurable: boolean;
  minThreshold?: number;
  maxThreshold?: number;
  defaultThreshold?: number;
}

export const OPERATIONAL_RULES: Record<string, RuleDefinition> = {
  campaign_budget_warning: {
    id: 'campaign_budget_warning',
    name: 'Alerta de Orçamento',
    description: 'A campanha consumiu grande parte do orçamento planejado.',
    defaultSeverity: 'warning',
    configurable: true,
    minThreshold: 50,
    maxThreshold: 89.99,
    defaultThreshold: 70
  },
  campaign_budget_critical: {
    id: 'campaign_budget_critical',
    name: 'Risco Crítico de Orçamento',
    description: 'A campanha está muito próxima ou excedeu o orçamento.',
    defaultSeverity: 'critical',
    configurable: true,
    minThreshold: 90,
    maxThreshold: 200,
    defaultThreshold: 90
  },
  project_due_soon: {
    id: 'project_due_soon',
    name: 'Projeto Vencendo',
    description: 'O projeto está próximo da data de vencimento.',
    defaultSeverity: 'warning',
    configurable: false,
    defaultThreshold: 7
  },
  receivable_upcoming: {
    id: 'receivable_upcoming',
    name: 'Recebível Próximo',
    description: 'Um recebível está próximo da data de vencimento.',
    defaultSeverity: 'info',
    configurable: false,
    defaultThreshold: 3
  }
};

const VALID_SEVERITIES = ['critical', 'warning', 'good', 'info'];

export function resolveRuleConfiguration(
  ruleId: string,
  persistedRules?: AgentRule[]
): ResolvedRuleConfiguration {
  const definition = OPERATIONAL_RULES[ruleId];
  if (!definition) {
    return {
      enabled: false,
      severity: 'info',
      configurationSource: 'invalid_fallback',
      version: '1.0'
    };
  }

  if (!definition.configurable) {
    return {
      enabled: true,
      severity: definition.defaultSeverity,
      threshold: definition.defaultThreshold,
      configurationSource: 'system_default',
      version: '1.0'
    };
  }

  const persisted = persistedRules?.find(r => r.conditionType === ruleId);
  if (!persisted) {
    return {
      enabled: true,
      severity: definition.defaultSeverity,
      threshold: definition.defaultThreshold,
      configurationSource: 'system_default',
      version: '1.0'
    };
  }

  if (!persisted.isActive) {
    return {
      enabled: false,
      severity: definition.defaultSeverity,
      configurationSource: 'user',
      version: '1.0'
    };
  }

  let finalSeverity = definition.defaultSeverity;
  if (persisted.severity && VALID_SEVERITIES.includes(persisted.severity)) {
    finalSeverity = persisted.severity as SeverityLevel;
  } else if (persisted.severity) {
    return {
      enabled: true,
      severity: definition.defaultSeverity,
      threshold: definition.defaultThreshold,
      configurationSource: 'invalid_fallback',
      version: '1.0'
    };
  }

  let finalThreshold = definition.defaultThreshold;
  if (persisted.threshold !== undefined && persisted.threshold !== null) {
    if (typeof persisted.threshold !== 'number' || isNaN(persisted.threshold) || persisted.threshold < 0) {
      return {
        enabled: true,
        severity: definition.defaultSeverity,
        threshold: definition.defaultThreshold,
        configurationSource: 'invalid_fallback',
        version: '1.0'
      };
    }
    
    if (definition.minThreshold !== undefined && persisted.threshold < definition.minThreshold) {
      return {
        enabled: true,
        severity: definition.defaultSeverity,
        threshold: definition.defaultThreshold,
        configurationSource: 'invalid_fallback',
        version: '1.0'
      };
    }

    if (definition.maxThreshold !== undefined && persisted.threshold > definition.maxThreshold) {
      return {
        enabled: true,
        severity: definition.defaultSeverity,
        threshold: definition.defaultThreshold,
        configurationSource: 'invalid_fallback',
        version: '1.0'
      };
    }

    finalThreshold = persisted.threshold;
  }

  return {
    enabled: true,
    severity: finalSeverity,
    threshold: finalThreshold,
    configurationSource: 'user',
    version: '1.0'
  };
}
`;
fs.writeFileSync('src/lib/operational/operationalRuleRegistry.ts', ruleRegistryContent);

// Write test for registry
fs.writeFileSync('src/lib/operational/operationalRuleRegistry.test.ts', `import { describe, it, expect } from 'vitest';
import { resolveRuleConfiguration } from './operationalRuleRegistry';

describe('resolveRuleConfiguration', () => {
  it('returns invalid_fallback for unknown rules', () => {
    const res = resolveRuleConfiguration('unknown_rule');
    expect(res.configurationSource).toBe('invalid_fallback');
  });

  it('returns system_default for non-configurable rules even with persisted data', () => {
    const res = resolveRuleConfiguration('project_due_soon', [{ conditionType: 'project_due_soon', isActive: false, severity: 'critical', threshold: 1 } as any]);
    expect(res.configurationSource).toBe('system_default');
    expect(res.enabled).toBe(true);
  });

  it('returns system_default when configurable rule has no persisted config', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', []);
    expect(res.configurationSource).toBe('system_default');
    expect(res.threshold).toBe(70);
  });

  it('returns user config when valid', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, severity: 'warning', threshold: 75 } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.threshold).toBe(75);
  });

  it('returns user config disabled', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: false } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.enabled).toBe(false);
  });

  it('rejects negative thresholds', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, threshold: -5 } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
    expect(res.threshold).toBe(70);
  });

  it('rejects thresholds below min', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, threshold: 10 } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
    expect(res.threshold).toBe(70);
  });

  it('rejects thresholds above max', () => {
    const res = resolveRuleConfiguration('campaign_budget_critical', [{ conditionType: 'campaign_budget_critical', isActive: true, threshold: 300 } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
    expect(res.threshold).toBe(90);
  });

  it('accepts threshold exactly at min', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, threshold: 50 } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.threshold).toBe(50);
  });

  it('accepts threshold exactly at max', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, threshold: 89.99 } as any]);
    expect(res.configurationSource).toBe('user');
    expect(res.threshold).toBe(89.99);
  });

  it('rejects NaN thresholds', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, threshold: NaN } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
  });

  it('rejects invalid severities', () => {
    const res = resolveRuleConfiguration('campaign_budget_warning', [{ conditionType: 'campaign_budget_warning', isActive: true, severity: 'fatal' as any } as any]);
    expect(res.configurationSource).toBe('invalid_fallback');
  });
});
`);

