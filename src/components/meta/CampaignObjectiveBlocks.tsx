import { Campaign } from '../../types';
import { money } from '../../data/camplyStore';

export function CampaignObjectiveBlocks({ campaign, metrics, period }: { campaign: Campaign, metrics: any, period: string }) {
  if (!metrics) return null;
  const obj = campaign.classifiedObjective || 'UNCLASSIFIED';

  if (obj === 'WHATSAPP') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-green-400">Objetivo: WhatsApp</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Conversas: <span className="font-mono">{metrics.whatsapp_conversations_started || 0}</span></div>
          <div>Custo p/ Conversa: <span className="font-mono">{money(metrics.cpa_whatsapp || (metrics.spend / (metrics.whatsapp_conversations_started || 1)))}</span></div>
        </div>
      </div>
    );
  }

  if (obj === 'SALES') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-blue-400">Objetivo: Vendas</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Compras: <span className="font-mono">{metrics.purchases || 0}</span></div>
          <div>ROAS: <span className="font-mono">{metrics.purchase_roas ? metrics.purchase_roas.toFixed(2) : '0.00'}</span></div>
        </div>
      </div>
    );
  }
  
  if (obj === 'LEADS') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-purple-400">Objetivo: Leads</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Leads: <span className="font-mono">{metrics.leads || 0}</span></div>
          <div>Custo p/ Lead: <span className="font-mono">{money(metrics.spend / (metrics.leads || 1))}</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
      <h4 className="text-xs font-bold text-gray-400">Objetivo: {obj}</h4>
      <div className="text-xs">Dados aguardando sincronização ou objetivo não específico.</div>
    </div>
  );
}
