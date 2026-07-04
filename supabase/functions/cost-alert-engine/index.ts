import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type Json = Record<string, unknown>;
type Severity = 'critical' | 'warning' | 'info';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): Json[] => Array.isArray(value) ? value.filter((item): item is Json => Boolean(item && typeof item === 'object')) : [];
const finite = (value: unknown): number | null => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };

function violation(target: Json, actual: number): { active: boolean; severity: Severity; threshold: number } | null {
  const kind = String(target.expectationType ?? '');
  const value = finite(target.targetValue); const min = finite(target.targetMin); const max = finite(target.targetMax);
  const warning = finite(target.warningTolerancePercent) ?? 10; const critical = finite(target.criticalTolerancePercent) ?? 25;
  let deviation = 0; let active = false; let threshold = value ?? min ?? max ?? 0;
  if (kind === 'maximum' && value != null && value > 0 && actual > value) { active = true; deviation = (actual - value) / value * 100; }
  else if ((kind === 'minimum' || kind === 'quantity_minimum') && value != null && value > 0 && actual < value) { active = true; deviation = (value - actual) / value * 100; }
  else if (kind === 'range' && min != null && max != null && (actual < min || actual > max)) {
    active = true; threshold = actual < min ? min : max; deviation = Math.abs(actual - threshold) / Math.max(threshold, 0.0001) * 100;
  }
  if (!['maximum', 'minimum', 'quantity_minimum', 'range'].includes(kind) || threshold <= 0) return null;
  return { active, severity: deviation > critical ? 'critical' : deviation > warning ? 'warning' : 'info', threshold };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !anonKey || !serviceKey) return json({ error: 'Server configuration unavailable' }, 500);
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const service = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Invalid token' }, 401);
    const body = object(await req.json()); const clientId = String(body.client_id ?? '').trim();
    const period = String(body.period ?? 'this_month');
    if (!clientId || !['today', 'this_month', 'last_7d', 'last_30d'].includes(period)) return json({ error: 'client_id or period is invalid' }, 400);

    const { data: ownedClient, error: ownershipError } = await caller.from('client_identity')
      .select('client_id').eq('client_id', clientId).is('archived_at', null).maybeSingle();
    if (ownershipError) return json({ error: `Ownership validation failed: ${ownershipError.message}` }, 500);
    if (!ownedClient) return json({ error: 'Client not found' }, 403);

    const { data: dashboard, error: dashboardError } = await caller.rpc('get_client_intelligence_dashboard_v1', { p_client_id: clientId, p_period: period });
    if (dashboardError) return json({ error: `Qualified metrics read failed: ${dashboardError.message}` }, 502);
    const dto = object(dashboard); const quality = object(dto.dataQuality); const reliable = object(dto.reliableRun);
    if (quality.status !== 'complete' || !reliable.id) return json({ error: 'No qualified successful run is available; alerts were not changed.' }, 409);

    const metrics = object(dto.metrics); const targets = array(dto.targets);
    const evaluatedRuleKeys = new Set<string>(); const evaluatedActiveKeys = new Set<string>();
    let created = 0; let updated = 0; let resolved = 0;
    for (const target of targets) {
      const metricId = String(target.metricId ?? ''); const metric = object(metrics[metricId]);
      const actual = metric.available === true ? finite(metric.value) : null;
      if (!metricId || actual == null) continue;
      const ruleKey = `target:${String(target.id ?? `${metricId}:${target.expectationType}`)}`;
      evaluatedRuleKeys.add(ruleKey);
      const result = violation(target, actual); if (!result) continue;
      const { data: existing, error: existingError } = await service.from('budget_alerts')
        .select('id,status').eq('user_id', user.id).eq('client_id', clientId).eq('rule_key', ruleKey)
        .eq('metric_name', metricId).eq('period', period).is('campaign_id', null).in('status', ['active', 'acknowledged']).maybeSingle();
      if (existingError) return json({ error: `Alert read failed: ${existingError.message}` }, 500);
      if (!result.active) continue;
      evaluatedActiveKeys.add(ruleKey);
      const payload = { user_id: user.id, client_id: clientId, campaign_id: null, client_meta_asset_id: null,
        alert_type: 'performance_target', rule_key: ruleKey, severity: result.severity, status: existing?.status ?? 'active',
        metric_name: metricId, current_value: actual, threshold_value: result.threshold,
        message: `${metricId}: ${actual} fora da meta ${result.threshold}.`, is_resolved: false, period,
        run_id: String(reliable.id), last_triggered_at: new Date().toISOString(),
        first_triggered_at: new Date().toISOString(), evidence: { target, metric, runId: reliable.id } };
      if (existing?.id) {
        const { error } = await service.from('budget_alerts').update({ ...payload, first_triggered_at: undefined }).eq('id', existing.id);
        if (error) return json({ error: `Alert update failed: ${error.message}` }, 500); updated += 1;
      } else {
        const { error } = await service.from('budget_alerts').insert(payload);
        if (error) return json({ error: `Alert insert failed: ${error.message}` }, 500); created += 1;
      }
    }

    const { data: currentAlerts, error: currentError } = await service.from('budget_alerts').select('id,rule_key')
      .eq('user_id', user.id).eq('client_id', clientId).eq('period', period).is('campaign_id', null).in('status', ['active', 'acknowledged']);
    if (currentError) return json({ error: `Alert readback failed: ${currentError.message}` }, 500);
    const toResolve = (currentAlerts ?? []).filter((item) => evaluatedRuleKeys.has(item.rule_key) && !evaluatedActiveKeys.has(item.rule_key)).map((item) => item.id);
    if (toResolve.length) {
      const { error } = await service.from('budget_alerts').update({ status: 'resolved', is_resolved: true, resolved_at: new Date().toISOString() }).in('id', toResolve);
      if (error) return json({ error: `Alert resolution failed: ${error.message}` }, 500); resolved = toResolve.length;
    }
    const { data: readback, error: readbackError } = await service.from('budget_alerts').select('*')
      .eq('user_id', user.id).eq('client_id', clientId).eq('period', period).in('status', ['active', 'acknowledged']);
    if (readbackError) return json({ error: `Alert confirmation failed: ${readbackError.message}` }, 500);
    return json({ clientId, period, runId: reliable.id, created, updated, resolved, alerts: readback ?? [] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
