import type { Campaign } from '../../types';
import type { AttributionGroup } from '../../lib/meta/metaSyncTypes';
import type { MetricValueMap } from '../../lib/meta/metricRegistry';
import { money } from '../../data/camplyStore';

const hasMetric = (metrics: MetricValueMap, metricId: string): boolean =>
  typeof metrics[metricId] === 'number' && Number.isFinite(metrics[metricId]);

const metricNumber = (metrics: MetricValueMap, metricId: string): string =>
  hasMetric(metrics, metricId)
    ? String(metrics[metricId])
    : 'Métrica indisponível';

const metricDecimal = (metrics: MetricValueMap, metricId: string): string =>
  hasMetric(metrics, metricId)
    ? Number(metrics[metricId]).toFixed(2)
    : 'Métrica indisponível';

const metricMoney = (metrics: MetricValueMap, metricId: string): string =>
  hasMetric(metrics, metricId)
    ? money(Number(metrics[metricId]))
    : 'Métrica indisponível';

const costPer = (metrics: MetricValueMap, denominatorMetric: string): string => {
  if (!hasMetric(metrics, 'spend') || !hasMetric(metrics, denominatorMetric)) {
    return 'Métrica indisponível';
  }
  const denominator = Number(metrics[denominatorMetric]);
  return denominator > 0 ? money(Number(metrics.spend) / denominator) : 'Métrica indisponível';
};

export function CampaignObjectiveBlocks({ campaign, period }: { campaign: Campaign; period: string }) {
  const groups = campaign.attributionGroupsByPeriod?.[period] || [];
  const global = campaign.globalMetricsByPeriod?.[period];
  const effectiveMixedAttribution = campaign.mixedAttributionByPeriod?.[period] || false;
  const trend = campaign.trendAvailabilityByPeriod?.[period];

  if (groups.length === 0) {
    return campaign.dataIsPartial ? (
      <div className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-2 text-[10px] font-semibold text-amber-300">
        Campanha encontrada em sincronização parcial; totais e tendências definitivos estão bloqueados.
      </div>
    ) : null;
  }

  return (
    <div className="space-y-3">
      {campaign.dataIsPartial && (
        <div className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-300">
          Dados parciais — não use estes totais como snapshot definitivo.
        </div>
      )}
      {campaign.mixedObjective && (
        <div className="rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-semibold text-purple-300">
          Objetivos mistos na estrutura — cada Ad Set usa sua própria normalização.
        </div>
      )}
      {effectiveMixedAttribution && (
        <div className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-500">
          Atribuição efetivamente mista neste período — métricas segregadas por grupo.
        </div>
      )}
      {campaign.mixedDestination && (
        <div className="rounded border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-300">
          Destinos diferentes foram configurados nesta campanha.
        </div>
      )}
      {trend && !trend.available && (
        <div className="rounded border border-brand-line bg-brand-surface2 px-2 py-1 text-[10px] text-brand-muted">
          Tendência indisponível: {trend.reason || 'períodos incompatíveis'}.
        </div>
      )}

      {global && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-brand-line bg-brand-surface2 p-3 text-xs md:grid-cols-4">
          <div>Alcance global: <span className="font-mono">{typeof global.reach === 'number' ? global.reach : 'Métrica indisponível'}</span></div>
          <div>Impressões: <span className="font-mono">{typeof global.impressions === 'number' ? global.impressions : 'Métrica indisponível'}</span></div>
          <div>Frequência: <span className="font-mono">{typeof global.frequency === 'number' ? global.frequency.toFixed(2) : 'Métrica indisponível'}</span></div>
          <div>Investimento: <span className="font-mono">{typeof global.spend === 'number' ? money(global.spend) : 'Métrica indisponível'}</span></div>
        </div>
      )}

      {groups.map((group) => (
        <ObjectiveBlock
          key={`${group.attributionSetting}:${group.classifiedObjective}:${group.adsetIds.join(',')}`}
          group={group}
          showAttribution={effectiveMixedAttribution || campaign.structuralMixedAttribution || false}
        />
      ))}
    </div>
  );
}

function ObjectiveBlock({ group, showAttribution }: { group: AttributionGroup; showAttribution: boolean }) {
  const { classifiedObjective: objective, metrics, attributionSetting } = group;
  const badge = showAttribution ? (
    <span className="ml-2 rounded border border-brand-line bg-brand-surface px-1.5 py-0.5 font-mono text-[9px] uppercase text-brand-muted">
      Attr: {attributionSetting}
    </span>
  ) : null;
  const shell = (title: string, color: string, rows: Array<[string, string]>) => (
    <div className="mt-2 space-y-1 rounded-lg bg-gray-800 p-3">
      <h4 className={`flex text-xs font-bold ${color}`}>{title}{badge}</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label}>{label}: <span className="font-mono">{value}</span></div>
        ))}
      </div>
      {group.completeness !== 'complete' && (
        <p className="pt-1 text-[10px] text-amber-400">Coleta do grupo: {group.completeness}</p>
      )}
    </div>
  );

  if (objective === 'WHATSAPP') return shell('Objetivo: WhatsApp', 'text-green-400', [
    ['Conversas', metricNumber(metrics, 'whatsapp_conversations_started')],
    ['Custo p/ Conversa', costPer(metrics, 'whatsapp_conversations_started')],
  ]);
  if (objective === 'SALES') return shell('Objetivo: Vendas', 'text-blue-400', [
    ['Compras', metricNumber(metrics, 'purchases')],
    ['ROAS', metricDecimal(metrics, 'purchase_roas')],
  ]);
  if (objective === 'LEADS') return shell('Objetivo: Leads', 'text-purple-400', [
    ['Leads', metricNumber(metrics, 'leads')],
    ['Custo p/ Lead', costPer(metrics, 'leads')],
  ]);
  if (objective === 'TRAFFIC') return shell('Objetivo: Tráfego', 'text-cyan-400', [
    ['Visitas à Página', metricNumber(metrics, 'landing_page_views')],
    ['Custo p/ Visita', costPer(metrics, 'landing_page_views')],
  ]);
  if (objective === 'PROFILE_VISITS') return shell('Objetivo: Visitas ao Perfil', 'text-pink-400', [
    ['Visitas', metricNumber(metrics, 'profile_visits')],
    ['Custo p/ Visita', costPer(metrics, 'profile_visits')],
  ]);
  if (objective === 'VIDEO') return shell('Objetivo: Vídeo', 'text-orange-400', [
    ['Visualizações', metricNumber(metrics, 'video_views')],
    ['ThruPlays', metricNumber(metrics, 'thru_plays')],
  ]);
  if (objective === 'ENGAGEMENT' || objective === 'AWARENESS') return shell(
    `Objetivo: ${objective === 'ENGAGEMENT' ? 'Engajamento' : 'Reconhecimento'}`,
    'text-orange-400',
    [
      ['Impressões', metricNumber(metrics, 'impressions')],
      ['CPM', metricMoney(metrics, 'cpm')],
    ]
  );
  if (objective === 'MESSENGER') return shell('Objetivo: Messenger', 'text-teal-400', [
    ['Conversas', metricNumber(metrics, 'messenger_conversations_started')],
    ['Custo p/ Conversa', costPer(metrics, 'messenger_conversations_started')],
  ]);
  if (objective === 'INSTAGRAM_DIRECT') return shell('Objetivo: Instagram Direct', 'text-teal-400', [
    ['Conversas', metricNumber(metrics, 'instagram_direct_conversations_started')],
    ['Custo p/ Conversa', costPer(metrics, 'instagram_direct_conversations_started')],
  ]);
  if (objective === 'MESSAGING_OTHER') return shell('Objetivo: Mensagens', 'text-teal-400', [
    ['Conversas', metricNumber(metrics, 'messaging_conversations_started_generic')],
    ['Custo p/ Conversa', costPer(metrics, 'messaging_conversations_started_generic')],
  ]);

  return shell(`Objetivo: ${objective}`, 'text-gray-400', [
    ['Investimento', metricMoney(metrics, 'spend')],
    ['Impressões', metricNumber(metrics, 'impressions')],
  ]);
}
