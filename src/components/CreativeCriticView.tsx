import React, { useState, useEffect } from 'react';
import { invokeFunction } from '../lib/invokeFunction';
import { CreativeCriticResponse, CamplyData } from '../types';
import { Bot, ImageOff, RefreshCw, CheckCircle2, XCircle, AlertTriangle, PlayCircle } from 'lucide-react';

interface Props {
  data: CamplyData;
}

export function CreativeCriticView({ data }: Props) {
  const [activeAccount, setActiveAccount] = useState<string>('');
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<string>('');
  const [kpi, setKpi] = useState<string>('roas');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CreativeCriticResponse | null>(null);

  // Auto-select first active integration
  useEffect(() => {
    invokeFunction<any>('meta-validate-token').then((data) => {
      if (data && data.status === 'active' && data.assets) {
        const accounts = data.assets.filter((a: any) => a.asset_type === 'adaccount');
        setAdAccounts(accounts);
        if (accounts.length > 0) {
          setActiveAccount(accounts[0].asset_id);
        }
      }
    }).catch((requestError) => setError(requestError.message));
  }, []);

  const handleAnalyze = async () => {
    if (!activeCampaign && !activeAccount) {
      setError('Selecione uma conta de anúncio ou campanha para analisar.');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // 1. Fetch Creative Data from Meta
      let targetId = activeAccount;
      let type = 'adaccount';
      let scopeName = 'Conta Inteira';

      if (activeCampaign) {
        const camp = data.campaigns.find(c => c.id === activeCampaign);
        if (!camp?.metaCampaignId) {
           setError('A campanha selecionada não possui um Meta ID vinculado. Ela precisa ser importada da tela de Integração Meta.');
           setLoading(false);
           return;
        }
        targetId = camp.metaCampaignId;
        type = 'campaign';
        scopeName = camp.name;
      }
      
      const fetchRes = await invokeFunction<any>('meta-fetch-creatives', { targetId, type });
      
      const ads = fetchRes.ads;
      if (!ads || ads.length === 0) {
        throw new Error('Nenhum anúncio ativo/pausado encontrado neste escopo (últimos 90 dias).');
      }

      // 2. Call the Critic Agent
      const agentRes = await invokeFunction<any>('meta-creative-critic', { adsData: ads, kpi, scopeName });
      
      setAnalysis(agentRes.analysis);
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-brand-ink">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl space-y-8">
          
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
                <SparklesIcon className="text-brand-green" /> Meta Ads Creative Critic
              </h1>
              <p className="mt-1 text-sm text-brand-soft">Agente especialista em análise de criativos e padrões vencedores.</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={activeAccount}
                onChange={(e) => { setActiveAccount(e.target.value); setActiveCampaign(''); }}
                className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-white focus:border-brand-green focus:outline-none"
              >
                <option value="" disabled>Selecione a Conta...</option>
                {adAccounts.map(acc => (
                  <option key={acc.asset_id} value={acc.asset_id}>{acc.asset_name}</option>
                ))}
              </select>

              <select
                value={activeCampaign}
                onChange={(e) => setActiveCampaign(e.target.value)}
                className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-white focus:border-brand-green focus:outline-none"
              >
                <option value="">Analisar a Conta Inteira</option>
                {data.campaigns.filter(c => c.status !== 'setup' && c.platform === 'Meta Ads').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={kpi}
                onChange={(e) => setKpi(e.target.value)}
                className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-white focus:border-brand-green focus:outline-none"
              >
                <option value="roas">KPI: ROAS</option>
                <option value="ctr">KPI: CTR</option>
                <option value="cpa">KPI: CPA/CPL</option>
              </select>

              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-brand-ink transition hover:brightness-110 disabled:opacity-50"
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Bot size={16} />}
                {loading ? 'Analisando...' : 'Analisar Criativos'}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-200">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle size={18} />
                Erro na Análise
              </div>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          )}

          {/* Analysis Results */}
          {analysis && !loading && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              
              {/* Executive Summary */}
              <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
                <h3 className="mb-2 text-lg font-bold text-white">Resumo Executivo</h3>
                <p className="text-brand-muted">{analysis.summary}</p>
                {analysis.data_gaps?.length > 0 && (
                  <div className="mt-4 flex gap-2 text-sm text-amber-400">
                    <AlertTriangle size={16} className="shrink-0" />
                    <span><strong>Atenção:</strong> {analysis.data_gaps.join(', ')}</span>
                  </div>
                )}
              </div>

              {/* Scorecard */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Winners */}
                <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-emerald-400">
                    <CheckCircle2 size={20} />
                    Top Performers
                  </h3>
                  <div className="space-y-4">
                    {analysis.top_creatives?.map((item, i) => (
                      <div key={i} className="rounded-lg border border-brand-line bg-brand-ink p-4">
                        <div className="font-bold text-white">{item.name}</div>
                        <div className="mt-1 text-sm text-brand-soft">{item.metrics}</div>
                        <div className="mt-2 text-sm text-brand-muted">{item.reason}</div>
                      </div>
                    ))}
                    {!analysis.top_creatives?.length && <p className="text-sm text-brand-soft">Nenhum vencedor claro identificado.</p>}
                  </div>
                </div>

                {/* Losers */}
                <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
                  <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-rose-400">
                    <XCircle size={20} />
                    Underperformers
                  </h3>
                  <div className="space-y-4">
                    {analysis.underperformers?.map((item, i) => (
                      <div key={i} className="rounded-lg border border-brand-line bg-brand-ink p-4">
                        <div className="font-bold text-white">{item.name}</div>
                        <div className="mt-1 text-sm text-brand-soft">{item.metrics}</div>
                        <div className="mt-2 text-sm text-brand-muted">{item.reason}</div>
                      </div>
                    ))}
                    {!analysis.underperformers?.length && <p className="text-sm text-brand-soft">Nenhum underperformer claro identificado.</p>}
                  </div>
                </div>
              </div>

              {/* Patterns */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
                  <h3 className="mb-3 font-bold text-white">Padrões de Sucesso</h3>
                  <ul className="list-inside list-disc space-y-2 text-sm text-brand-muted">
                    {analysis.winner_patterns?.map((pattern, i) => <li key={i}>{pattern}</li>)}
                  </ul>
                </div>
                <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
                  <h3 className="mb-3 font-bold text-white">Padrões de Baixa Performance</h3>
                  <ul className="list-inside list-disc space-y-2 text-sm text-brand-muted">
                    {analysis.losing_patterns?.map((pattern, i) => <li key={i}>{pattern}</li>)}
                  </ul>
                </div>
              </div>

              {/* Variants */}
              <div>
                <h3 className="mb-4 text-xl font-bold text-white">Sugestões de Criativos (Briefs)</h3>
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {analysis.variant_briefs?.map((brief, i) => (
                    <div key={i} className="flex flex-col rounded-xl border border-brand-line bg-brand-surface p-5">
                      <div className="mb-3 inline-flex items-center gap-1.5 self-start rounded-full bg-brand-ink px-2.5 py-1 text-xs font-medium text-brand-soft border border-brand-line">
                        <PlayCircle size={12} /> {brief.format}
                      </div>
                      <h4 className="mb-2 font-bold text-brand-green">{brief.headline}</h4>
                      <p className="mb-4 text-sm text-brand-muted">"{brief.primary_text}"</p>
                      <div className="mt-auto rounded bg-brand-ink p-3 text-xs text-brand-soft">
                        <strong className="block text-white mb-1">Por que vai funcionar:</strong>
                        {brief.insight}
                        <div className="mt-2 border-t border-brand-line pt-2 text-[10px]">
                          Inspirado em: {brief.source_ad}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {!analysis && !loading && !error && (
            <div className="flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-brand-line text-center">
              <Bot size={48} className="mb-4 text-brand-line" />
              <p className="text-brand-soft">Selecione o escopo e clique em analisar para gerar insights sobre seus criativos.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// Simple Sparkles SVG replacement since it wasn't imported from lucide-react in my write
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/>
      <path d="M19 17v4"/>
      <path d="M3 5h4"/>
      <path d="M17 19h4"/>
    </svg>
  );
}
