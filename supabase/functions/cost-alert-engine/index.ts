/**
 * cost-alert-engine/index.ts
 * Edge Function — Motor de alertas de custo
 * Analisa métricas de campanhas e gera alertas em budget_alerts
 * baseado em cost_thresholds configurados pelo usuário.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CampaignSummary {
  campaignId: string;
  clientId: string;
  name: string;
  status: string;
  budget: number;
  spent: number;
  lastOptimizedAt?: string;
  metrics?: {
    cpm?: number;
    cpc?: number;
    cpl?: number;
    cpr?: number;
    roas?: number;
    ctr?: number;
    frequency?: number;
  };
}

interface AlertToInsert {
  user_id: string;
  client_id: string;
  campaign_id?: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  metric_name: string;
  current_value?: number;
  threshold_value?: number;
  message: string;
  is_resolved: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get user from auth token
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body — expects list of campaign summaries
    const body = await req.json() as { campaigns: CampaignSummary[] };
    const campaigns = body.campaigns ?? [];

    if (campaigns.length === 0) {
      return new Response(JSON.stringify({ alerts: [], generated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load custom thresholds for this user
    const { data: thresholds } = await supabase
      .from('cost_thresholds')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    // Load existing unresolved alerts to avoid duplicates (within last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existingAlerts } = await supabase
      .from('budget_alerts')
      .select('alert_type, campaign_id, client_id')
      .eq('user_id', user.id)
      .eq('is_resolved', false)
      .gte('triggered_at', since);

    const existingKeys = new Set(
      (existingAlerts ?? []).map((a: any) => `${a.alert_type}:${a.campaign_id ?? a.client_id}`)
    );

    const alertsToInsert: AlertToInsert[] = [];

    for (const campaign of campaigns) {
      const addAlert = (
        type: string,
        severity: 'critical' | 'warning' | 'info',
        metricName: string,
        message: string,
        currentValue?: number,
        thresholdValue?: number,
      ) => {
        const key = `${type}:${campaign.campaignId}`;
        if (existingKeys.has(key)) return; // deduplicate
        existingKeys.add(key);
        alertsToInsert.push({
          user_id: user.id,
          client_id: campaign.clientId,
          campaign_id: campaign.campaignId,
          alert_type: type,
          severity,
          metric_name: metricName,
          current_value: currentValue,
          threshold_value: thresholdValue,
          message,
          is_resolved: false,
        });
      };

      // Rule 1: Budget exhausted (>90%)
      if (campaign.budget > 0) {
        const pct = (campaign.spent / campaign.budget) * 100;
        if (pct >= 90 && !['paused', 'setup'].includes(campaign.status)) {
          addAlert(
            'budget_exhausted', 'critical', 'budget_pct',
            `${campaign.name}: budget ${pct.toFixed(0)}% esgotado (R$ ${campaign.spent.toFixed(2)} de R$ ${campaign.budget.toFixed(2)})`,
            pct, 90
          );
        } else if (pct >= 70 && !['paused', 'setup'].includes(campaign.status)) {
          addAlert(
            'budget_high', 'warning', 'budget_pct',
            `${campaign.name}: budget ${pct.toFixed(0)}% consumido`,
            pct, 70
          );
        }
      }

      // Rule 2: No optimization for 3+ days
      if (campaign.lastOptimizedAt && !['paused', 'setup'].includes(campaign.status)) {
        const daysSince = Math.floor(
          (Date.now() - new Date(campaign.lastOptimizedAt).getTime()) / 86400000
        );
        if (daysSince >= 7) {
          addAlert(
            'no_optimization_critical', 'critical', 'days_since_optimization',
            `${campaign.name}: ${daysSince} dias sem otimização — revisão urgente necessária`,
            daysSince, 7
          );
        } else if (daysSince >= 3) {
          addAlert(
            'no_optimization', 'warning', 'days_since_optimization',
            `${campaign.name}: ${daysSince} dias sem otimização`,
            daysSince, 3
          );
        }
      }

      // Rule 3: High frequency (>3)
      if (campaign.metrics?.frequency !== undefined && campaign.metrics.frequency > 3) {
        addAlert(
          'high_frequency', 'warning', 'frequency',
          `${campaign.name}: frequência ${campaign.metrics.frequency.toFixed(1)} — possível fadiga de criativo`,
          campaign.metrics.frequency, 3
        );
      }

      // Rule 4: Custom thresholds
      if (thresholds && campaign.metrics) {
        for (const threshold of thresholds as any[]) {
          if (threshold.client_id !== campaign.clientId) continue;
          if (threshold.campaign_id && threshold.campaign_id !== campaign.campaignId) continue;

          const metricValue = campaign.metrics[threshold.metric as keyof typeof campaign.metrics];
          if (metricValue === undefined) continue;

          const isROAS = threshold.metric === 'roas';

          // For ROAS: lower is worse (invert comparison)
          const criticalBreach = isROAS
            ? metricValue < threshold.critical_level
            : metricValue >= threshold.critical_level;
          const warningBreach = isROAS
            ? metricValue < threshold.warning_level
            : metricValue >= threshold.warning_level;

          if (criticalBreach) {
            addAlert(
              `custom_${threshold.metric}_critical`, 'critical', threshold.metric,
              `${campaign.name}: ${threshold.metric.toUpperCase()} ${metricValue.toFixed(2)} ${isROAS ? 'abaixo' : 'acima'} do limite crítico (${threshold.critical_level})`,
              metricValue, threshold.critical_level
            );
          } else if (warningBreach) {
            addAlert(
              `custom_${threshold.metric}_warning`, 'warning', threshold.metric,
              `${campaign.name}: ${threshold.metric.toUpperCase()} ${metricValue.toFixed(2)} ${isROAS ? 'abaixo' : 'acima'} do limite de atenção (${threshold.warning_level})`,
              metricValue, threshold.warning_level
            );
          }
        }
      }
    }

    // Batch insert new alerts
    let inserted = 0;
    if (alertsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('budget_alerts')
        .insert(alertsToInsert);

      if (insertError) {
        console.error('Error inserting alerts:', insertError);
      } else {
        inserted = alertsToInsert.length;
      }
    }

    // Auto-resolve old alerts for campaigns that no longer breach
    // (mark as resolved if campaign no longer triggers that alert type)
    const activeCampaignIds = new Set(campaigns.map(c => c.campaignId));
    const { data: oldAlerts } = await supabase
      .from('budget_alerts')
      .select('id, alert_type, campaign_id')
      .eq('user_id', user.id)
      .eq('is_resolved', false)
      .in('alert_type', ['budget_high', 'no_optimization', 'high_frequency']);

    const toResolve = (oldAlerts ?? [])
      .filter((a: any) => !alertsToInsert.some(
        i => i.alert_type === a.alert_type && i.campaign_id === a.campaign_id
      ))
      .map((a: any) => a.id);

    if (toResolve.length > 0) {
      await supabase
        .from('budget_alerts')
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .in('id', toResolve);
    }

    return new Response(JSON.stringify({
      alerts: alertsToInsert,
      generated: inserted,
      resolved: toResolve.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('cost-alert-engine error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
