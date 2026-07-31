import fs from 'fs';

// 1. evaluateOperationalSignals.ts
let evalCode = fs.readFileSync('src/lib/operational/evaluateOperationalSignals.ts', 'utf-8');

// Remove high_cost
evalCode = evalCode.replace(/if \(campaign.cpr && campaign.benchmarks\?.cpr\) \{[\s\S]*?\} else if \(pct >=\s*\d+\)/, 'if (pct >= 90)');
evalCode = evalCode.replace(/if \(campaign.cpr && client.benchmarks\?.cpr\) \{[\s\S]*?\}\s*if \(pct >=/, 'if (pct >=');
// Remove generic high cost logic entirely if it's there
evalCode = evalCode.replace(/const highCostSignal = evaluateHighCost[\s\S]*?\n/, '');

// Fix budget logic and remove magic numbers
const budgetRegex = /if \(pct >= 90\) \{[\s\S]*?\} else if \(pct >= 70\) \{[\s\S]*?\}/;
const newBudgetLogic = `
        const pct = (campaign.spent / campaign.budget) * 100;
        const configCrit = resolveRuleConfiguration('campaign_budget_critical', agentRules);
        const configWarn = resolveRuleConfiguration('campaign_budget_warning', agentRules);
        
        let addedBudget = false;
        if (configCrit.enabled && pct >= (configCrit.threshold ?? 90)) {
          signals.push({
            id: \`budget_critical_\${campaign.id}\`,
            deduplicationKey: \`budget_critical_\${campaign.id}\`,
            clientId: client.id,
            signalType: 'operational_budget_consumption',
            severity: 'critical',
            title: 'Risco crítico de orçamento',
            message: \`A campanha \${campaign.name} excedeu o limite seguro de consumo.\`,
            suggestedAction: 'Confirmar se os valores cadastrados estão atualizados.',
            evidence: [
              { key: 'manual_budget', label: 'Verba cadastrada', value: campaign.budget, source: 'user_input', quality: 'manual' },
              { key: 'manual_spent', label: 'Consumo informado', value: campaign.spent, source: 'user_input', quality: 'manual' },
              { key: 'consumption_percentage', label: 'Percentual calculado', value: pct, source: 'system_calculation', quality: 'computed' }
            ],
            triggeredAt: new Date().toISOString(),
            lastDetectedAt: new Date().toISOString(),
            occurrenceCount: 1,
            status: 'active'
          });
          addedBudget = true;
        } else if (!addedBudget && configWarn.enabled && pct >= (configWarn.threshold ?? 70)) {
          signals.push({
            id: \`budget_warning_\${campaign.id}\`,
            deduplicationKey: \`budget_warning_\${campaign.id}\`,
            clientId: client.id,
            signalType: 'operational_budget_consumption',
            severity: 'warning',
            title: 'Consumo de orçamento acelerado',
            message: \`A campanha \${campaign.name} já consumiu \${pct.toFixed(0)}% da verba.\`,
            suggestedAction: 'Confirmar se os valores cadastrados estão atualizados.',
            evidence: [
              { key: 'manual_budget', label: 'Verba cadastrada', value: campaign.budget, source: 'user_input', quality: 'manual' },
              { key: 'manual_spent', label: 'Consumo informado', value: campaign.spent, source: 'user_input', quality: 'manual' },
              { key: 'consumption_percentage', label: 'Percentual calculado', value: pct, source: 'system_calculation', quality: 'computed' }
            ],
            triggeredAt: new Date().toISOString(),
            lastDetectedAt: new Date().toISOString(),
            occurrenceCount: 1,
            status: 'active'
          });
        }
`;
evalCode = evalCode.replace(/const pct = \(campaign\.spent \/ campaign\.budget\) \* 100;[\s\S]*?\} else if \(pct >= 70\) \{[\s\S]*?\}/, newBudgetLogic);

// Receivables Logic Fix
const recRegex = /client\.receivables\?.forEach\(rec => \{[\s\S]*?\}\);/;
const newRecLogic = `
  client.receivables?.forEach(rec => {
    if (rec.status === 'paid') return;
    
    const dueDate = new Date(rec.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    
    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      signals.push({
        id: \`rec_overdue_\${rec.id}\`,
        deduplicationKey: \`rec_overdue_\${rec.id}\`,
        clientId: client.id,
        signalType: 'pagamento_atrasado',
        severity: 'critical',
        title: 'Pagamento Vencido',
        message: \`O recebível no valor de R$ \${rec.amount} venceu no dia \${rec.dueDate}.\`,
        suggestedAction: 'Cobrar cliente.',
        evidence: [{ key: 'due_date', label: 'Vencimento', value: rec.dueDate }],
        triggeredAt: new Date().toISOString(),
        lastDetectedAt: new Date().toISOString(),
        occurrenceCount: 1,
        status: 'active'
      });
    } else if (diffDays <= 3) {
      signals.push({
        id: \`rec_upcoming_\${rec.id}\`,
        deduplicationKey: \`rec_upcoming_\${rec.id}\`,
        clientId: client.id,
        signalType: 'pagamento_proximo',
        severity: 'info',
        title: 'Pagamento Próximo',
        message: \`O recebível de R$ \${rec.amount} vencerá em \${diffDays} dias.\`,
        suggestedAction: 'Acompanhar vencimento.',
        evidence: [{ key: 'due_date', label: 'Vencimento', value: rec.dueDate }],
        triggeredAt: new Date().toISOString(),
        lastDetectedAt: new Date().toISOString(),
        occurrenceCount: 1,
        status: 'active'
      });
    }
  });
`;
evalCode = evalCode.replace(recRegex, newRecLogic);
fs.writeFileSync('src/lib/operational/evaluateOperationalSignals.ts', evalCode);

// 2. signalFilters.ts
const filtersCode = `import { OperationalSignal } from '../../types';

export function isActionableSignal(signal: OperationalSignal): boolean {
  return (
    signal.status === 'active' &&
    signal.severity !== 'good' &&
    signal.signalType !== 'all_clear'
  );
}

export function selectActiveActionableSignals(signals: OperationalSignal[] | undefined): OperationalSignal[] {
  if (!signals) return [];
  return signals.filter(isActionableSignal);
}

export function countActiveActionableSignals(signals: OperationalSignal[] | undefined): number {
  return selectActiveActionableSignals(signals).length;
}
`;
fs.writeFileSync('src/lib/operational/signalFilters.ts', filtersCode);

