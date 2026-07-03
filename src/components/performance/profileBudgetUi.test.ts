import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const form = readFileSync(new URL('../ClientFormModal.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('./ClientPerformanceTable.tsx', import.meta.url), 'utf8');

describe('profile and budget responsive UI contract', () => {
  it('exposes the product fields and hides technical confidence gates', () => {
    expect(form).toContain('Objetivo principal da operação');
    expect(form).toContain('Metas de performance');
    expect(form).toContain('+ Adicionar métrica');
    expect(form).toContain('Salvar como modelo');
    expect(form).not.toContain('Investimento mínimo para análise');
    expect(form).not.toContain('Impressões mínimas');
    expect(form).not.toContain('Resultados mínimos');
    expect(form).not.toContain('Atraso de atribuição tolerado');
    expect(form).not.toContain('Modelo de negócio</span>');
  });

  it('keeps dedicated mobile and desktop dashboard layouts with full pacing language', () => {
    expect(dashboard).toContain('data-testid="client-performance-mobile"');
    expect(dashboard).toContain('data-testid="client-performance-desktop"');
    expect(dashboard).toContain('Ritmo do orçamento');
    expect(dashboard).toContain('Média necessária/dia');
    expect(dashboard).toContain('Ação recomendada:');
  });
});
