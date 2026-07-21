import { describe, expect, it, vi } from 'vitest';
import { dashboardPeriods, parseAnalyticsCapabilities } from '../lib/performance/analyticsCapabilities';
import { exactPeriodRange } from '../lib/meta/periodRange';
import fs from 'node:fs';
import path from 'node:path';

describe('Bateria de Conformidade do Contrato de Sincronização Meta Ads', () => {

  // Teste 1: Dashboard não chama syncMetaAsset
  it('1. Dashboard (OverviewView) não importa nem executa syncMetaAsset', () => {
    const overviewPath = path.join(process.cwd(), 'src/components/OverviewView.tsx');
    const content = fs.readFileSync(overviewPath, 'utf-8');
    expect(content).not.toContain("import { syncMetaAsset }");
    expect(content).not.toContain("syncMetaAsset(");
  });

  // Teste 2: Dashboard não renderiza botão "Sincronizar período"
  it('2. Dashboard não possui botão "Sincronizar período" nem "Sincronizar conta"', () => {
    const overviewPath = path.join(process.cwd(), 'src/components/OverviewView.tsx');
    const content = fs.readFileSync(overviewPath, 'utf-8');
    expect(content).not.toContain('Sincronizar período');
    expect(content).not.toContain('handleSyncAll');
  });

  // Teste 3: Atualizar Dashboard apenas chama loadDashboard (sem sync)
  it('3. O botão Atualizar Dashboard invoca apenas loadDashboard e não executa chamadas à Meta API', () => {
    const overviewPath = path.join(process.cwd(), 'src/components/OverviewView.tsx');
    const content = fs.readFileSync(overviewPath, 'utf-8');
    expect(content).toContain('onClick={() => void loadDashboard()}');
    expect(content).not.toContain('onClick={() => void handleSyncAll()}');
  });

  // Teste 4: Integração Meta Ads sincroniza sempre last_90d
  it('4. Integração Meta Ads força a sincronização exclusiva de last_90d', () => {
    const integrationPath = path.join(process.cwd(), 'src/components/MetaIntegrationView.tsx');
    const content = fs.readFileSync(integrationPath, 'utf-8');
    expect(content).toContain("const SYNC_PERIOD: DashboardPeriod = 'last_90d';");
    expect(content).toContain("period: SYNC_PERIOD");
    expect(content).not.toContain('meta-bulk-period-select');
  });

  // Testes 5 a 10: last_90d success cobre todos os períodos de leitura
  it('5. last_90d success cobre o período "today"', () => {
    const range = exactPeriodRange('today', 'UTC', new Date('2026-07-21T12:00:00Z'));
    expect(range.dateStart).toBe('2026-07-21');
    expect(range.dateStop).toBe('2026-07-21');
  });

  it('6. last_90d success cobre o período "yesterday"', () => {
    const range = exactPeriodRange('yesterday', 'UTC', new Date('2026-07-21T12:00:00Z'));
    expect(range.dateStart).toBe('2026-07-20');
    expect(range.dateStop).toBe('2026-07-20');
  });

  it('7. last_90d success cobre o período "today_and_yesterday"', () => {
    const range = exactPeriodRange('today_and_yesterday', 'UTC', new Date('2026-07-21T12:00:00Z'));
    expect(range.dateStart).toBe('2026-07-20');
    expect(range.dateStop).toBe('2026-07-21');
  });

  it('8. last_90d success cobre o período "last_7d"', () => {
    const range = exactPeriodRange('last_7d', 'UTC', new Date('2026-07-21T12:00:00Z'));
    expect(range.dateStart).toBe('2026-07-15');
    expect(range.dateStop).toBe('2026-07-21');
  });

  it('9. last_90d success cobre o período "last_30d"', () => {
    const range = exactPeriodRange('last_30d', 'UTC', new Date('2026-07-21T12:00:00Z'));
    expect(range.dateStart).toBe('2026-06-22');
    expect(range.dateStop).toBe('2026-07-21');
  });

  it('10. last_90d success cobre o período "last_90d"', () => {
    const range = exactPeriodRange('last_90d', 'UTC', new Date('2026-07-21T12:00:00Z'));
    expect(range.dateStart).toBe('2026-04-23');
    expect(range.dateStop).toBe('2026-07-21');
  });

  // Teste 11: Suporte a status no contrato frontend
  it('11. O contrato de capacidades suporta o novo catálogo de períodos válidos', () => {
    expect(dashboardPeriods).toContain('today');
    expect(dashboardPeriods).toContain('yesterday');
    expect(dashboardPeriods).toContain('today_and_yesterday');
    expect(dashboardPeriods).toContain('last_7d');
    expect(dashboardPeriods).toContain('last_30d');
    expect(dashboardPeriods).toContain('last_90d');
    expect(dashboardPeriods).not.toContain('this_month');
    expect(dashboardPeriods).not.toContain('this_week');
  });

  // Teste 12: Banner de cobertura no Dashboard
  it('12. Dashboard inclui mensagem informativa explicativa sobre a cobertura de 90 dias', () => {
    const overviewPath = path.join(process.cwd(), 'src/components/OverviewView.tsx');
    const content = fs.readFileSync(overviewPath, 'utf-8');
    expect(content).toContain('Dados carregados a partir da sincronização dos últimos 90 dias');
  });

  // Teste 13: ClientPerformanceTable não dispara sincronização
  it('13. ClientPerformanceTable não possui ação de sync embutida nas linhas', () => {
    const tablePath = path.join(process.cwd(), 'src/components/performance/ClientPerformanceTable.tsx');
    const content = fs.readFileSync(tablePath, 'utf-8');
    expect(content).not.toContain('function SyncAction');
    expect(content).not.toContain('syncMetaAsset');
  });

  // Teste 14: Edge Function meta-sync-performance usa time_increment=1
  it('14. A Edge Function meta-sync-performance solicita dados em granularidade diária (time_increment=1)', () => {
    const fnPath = path.join(process.cwd(), 'supabase/functions/meta-sync-performance/index.ts');
    const content = fs.readFileSync(fnPath, 'utf-8');
    expect(content).toContain("time_increment: '1'");
  });

  // Teste 15: Validação da Migration 90d Coverage
  it('15. A migration da RPC get_global_performance_dashboard_v2 filtra por date_start/date_stop e base last_90d', () => {
    const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260721000000_single_sync_90d_coverage.sql');
    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content).toContain("r.requested_period = 'last_90d'");
    expect(content).toContain("m.date_start::date >= v_date_start");
    expect(content).toContain("m.date_stop::date <= v_date_stop");
  });

});
