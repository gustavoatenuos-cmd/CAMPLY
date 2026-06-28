import { Campaign } from '../../types';
import { money } from '../../data/camplyStore';

export function CampaignObjectiveBlocks({ campaign, metrics, period }: { campaign: Campaign, metrics: any, period: string }) {
  if (!metrics) return null;
  const obj = campaign.classifiedObjective || 'UNCLASSIFIED';

  const safeDivide = (num: number, den: number) => den > 0 ? (num / den) : 0;
  const renderMoney = (num: number, den: number) => {
    if (!den || den === 0) return 'Indisponível';
    return money(num / den);
  };

  if (obj === 'WHATSAPP') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-green-400">Objetivo: WhatsApp</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Conversas: <span className="font-mono">{metrics.whatsapp_conversations_started || 0}</span></div>
          <div>Custo p/ Conversa: <span className="font-mono">{renderMoney(metrics.spend, metrics.whatsapp_conversations_started)}</span></div>
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
          <div>Custo p/ Lead: <span className="font-mono">{renderMoney(metrics.spend, metrics.leads)}</span></div>
        </div>
      </div>
    );
  }

  if (obj === 'TRAFFIC') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-cyan-400">Objetivo: Tráfego</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Visitas à Página: <span className="font-mono">{metrics.landing_page_views || 0}</span></div>
          <div>Custo p/ Visita: <span className="font-mono">{renderMoney(metrics.spend, metrics.landing_page_views)}</span></div>
        </div>
      </div>
    );
  }

  if (obj === 'PROFILE_VISITS') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-pink-400">Objetivo: Visitas ao Perfil</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Visitas: <span className="font-mono">{metrics.profile_visits || 0}</span></div>
          <div>Custo p/ Visita: <span className="font-mono">{renderMoney(metrics.spend, metrics.profile_visits)}</span></div>
        </div>
      </div>
    );
  }

  if (obj === 'VIDEO') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-orange-400">Objetivo: Visualizações de Vídeo</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>ThruPlays: <span className="font-mono">{metrics.thru_plays || 0}</span></div>
          <div>Custo p/ ThruPlay: <span className="font-mono">{renderMoney(metrics.spend, metrics.thru_plays)}</span></div>
        </div>
      </div>
    );
  }

  if (obj === 'ENGAGEMENT' || obj === 'AWARENESS') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-orange-400">Objetivo: Reconhecimento/Engajamento</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Alcance: <span className="font-mono">{metrics.reach || 0}</span></div>
          <div>CPM: <span className="font-mono">{metrics.cpm ? money(metrics.cpm) : 'Indisponível'}</span></div>
        </div>
      </div>
    );
  }
  
  if (obj === 'MESSENGER' || obj === 'INSTAGRAM_DIRECT' || obj === 'MESSAGING_OTHER') {
    const convCount = obj === 'MESSENGER' ? metrics.messenger_conversations_started :
                      obj === 'INSTAGRAM_DIRECT' ? metrics.instagram_direct_conversations_started :
                      metrics.messaging_conversations_started_generic;
                      
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-teal-400">Objetivo: Mensagens ({obj})</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Conversas: <span className="font-mono">{convCount || 0}</span></div>
          <div>Custo p/ Conversa: <span className="font-mono">{renderMoney(metrics.spend, convCount)}</span></div>
        </div>
      </div>
    );
  }

  if (obj === 'APP') {
    return (
      <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
        <h4 className="text-xs font-bold text-indigo-400">Objetivo: App</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>Instalações: <span className="font-mono">{metrics.app_installs || 0}</span></div>
          <div>Custo p/ Instalação: <span className="font-mono">{renderMoney(metrics.spend, metrics.app_installs)}</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-gray-800 rounded-lg mt-2 space-y-1">
      <h4 className="text-xs font-bold text-gray-400">Objetivo: {obj}</h4>
      <div className="text-xs text-gray-500">Dados aguardando sincronização ou objetivo não específico.</div>
    </div>
  );
}
