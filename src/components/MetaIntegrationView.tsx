import React, { useEffect, useState } from 'react';
import { Facebook, Link as LinkIcon, Unlink, RefreshCw, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface MetaIntegrationViewProps {
  // Pass the supabase client if available or handle it internally
}

export function MetaIntegrationView({}: MetaIntegrationViewProps) {
  const [integration, setIntegration] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In a real implementation, you would use your initialized supabaseClient here
  // For this UI scaffolding, we simulate the state or assume window.supabase exists.
  
  const checkStatus = async () => {
    // try {
    //   setIsLoading(true);
    //   const { data, error } = await supabase.functions.invoke('meta-validate-token');
    //   if (data && data.status === 'active') {
    //     setIntegration(data.integration);
    //     // fetch assets as well
    //   }
    // } catch (e: any) {
    //   setError(e.message);
    // } finally {
    //   setIsLoading(false);
    // }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleConnect = async () => {
    // try {
    //   setIsLoading(true);
    //   const { data, error } = await supabase.functions.invoke('meta-oauth-start');
    //   if (error) throw error;
    //   if (data?.url) {
    //     window.location.href = data.url;
    //   }
    // } catch (e: any) {
    //   setError(e.message);
    //   setIsLoading(false);
    // }
  };

  const handleDisconnect = async () => {
    if (!confirm('Tem certeza que deseja desconectar a conta do Facebook? Isso parará todas as sincronizações.')) return;
    
    // try {
    //   setIsLoading(true);
    //   await supabase.functions.invoke('meta-disconnect');
    //   setIntegration(null);
    //   setAssets([]);
    // } catch (e: any) {
    //   setError(e.message);
    // } finally {
    //   setIsLoading(false);
    // }
  };

  const handleSyncAssets = async () => {
    // try {
    //   setIsSyncing(true);
    //   const { data, error } = await supabase.functions.invoke('meta-list-assets');
    //   if (error) throw error;
    //   setAssets(data.assets || []);
    // } catch (e: any) {
    //   setError(e.message);
    // } finally {
    //   setIsSyncing(false);
    // }
  };

  const handleSyncAds = async (adAccountId: string) => {
    // try {
    //   setIsLoading(true);
    //   const { data, error } = await supabase.functions.invoke('meta-sync-ads', {
    //     body: { adAccountId }
    //   });
    //   if (error) throw error;
    //   alert(`Sucesso! ${data.ads?.length || 0} anúncios ativos sincronizados.`);
    //   console.log(data.ads);
    // } catch (e: any) {
    //   setError(e.message);
    // } finally {
    //   setIsLoading(false);
    // }
    alert('Simulação: sincronizando anúncios ativos da conta ' + adAccountId);
  };

  return (
    <section className="flex h-full flex-col bg-brand-ink">
      <div className="flex items-center justify-between border-b border-brand-line bg-brand-surface p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/20 text-blue-500">
            <Facebook size={24} />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">Integração Meta Ads</h1>
            <p className="text-xs text-brand-muted">Conecte sua conta para gerenciar campanhas e ler dados com segurança</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-8">
          
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-4 text-rose-500">
              <AlertTriangle size={20} />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Connection Status Card */}
          <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Status da Conexão</h3>
                <p className="mt-1 text-sm text-brand-muted">
                  {integration 
                    ? `Conectado como ${integration.meta_user_name}` 
                    : 'Nenhuma conta conectada. Seus tokens ficarão criptografados e seguros.'}
                </p>
              </div>
              {integration ? (
                <div className="flex items-center gap-2 rounded-full bg-brand-green/20 px-3 py-1 text-xs font-bold text-brand-green">
                  <ShieldCheck size={14} />
                  Ativo e Seguro
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full bg-brand-surface2 px-3 py-1 text-xs font-bold text-brand-soft">
                  <Unlink size={14} />
                  Desconectado
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              {!integration ? (
                <button
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  <Facebook size={18} />
                  {isLoading ? 'Conectando...' : 'Conectar com Facebook'}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSyncAssets}
                    disabled={isSyncing}
                    className="flex items-center gap-2 rounded-lg bg-brand-green px-5 py-2.5 font-bold text-brand-ink transition disabled:opacity-50"
                  >
                    <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
                    Sincronizar Ativos
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={isLoading}
                    className="flex items-center gap-2 rounded-lg border border-brand-line px-5 py-2.5 font-bold text-rose-500 transition hover:bg-brand-surface2 disabled:opacity-50"
                  >
                    <Unlink size={18} />
                    Desconectar
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Assets Card */}
          {integration && (
            <div className="rounded-xl border border-brand-line bg-brand-surface overflow-hidden">
              <div className="border-b border-brand-line p-6">
                <h3 className="text-lg font-bold text-white">Contas de Anúncio e Páginas</h3>
                <p className="mt-1 text-sm text-brand-muted">Ativos sincronizados da sua conta Meta.</p>
              </div>
              <div className="divide-y divide-brand-line bg-brand-surface2/30">
                {assets.length === 0 ? (
                  <div className="p-8 text-center text-brand-muted">
                    Nenhum ativo sincronizado ainda. Clique em "Sincronizar Ativos" acima.
                  </div>
                ) : (
                  assets.map((asset, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 px-6 hover:bg-brand-surface2/50">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-surface border border-brand-line">
                          {asset.asset_type === 'adaccount' ? <CheckCircle2 size={14} className="text-brand-green" /> : <LinkIcon size={14} className="text-blue-400" />}
                        </div>
                        <div>
                          <p className="font-semibold text-white">{asset.asset_name}</p>
                          <p className="text-[10px] uppercase text-brand-soft">{asset.asset_type} • ID: {asset.asset_id}</p>
                        </div>
                      </div>
                      {asset.asset_type === 'adaccount' && (
                        <div className="flex gap-2">
                          <button className="rounded-lg border border-brand-line px-3 py-1.5 text-xs font-semibold text-brand-soft hover:bg-brand-surface hover:text-white">
                            Campanhas
                          </button>
                          <button onClick={() => handleSyncAds(asset.asset_id)} className="rounded-lg bg-brand-green/10 px-3 py-1.5 text-xs font-bold text-brand-green hover:bg-brand-green/20">
                            Sync Anúncios e Insights
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Security Info */}
          <div className="rounded-xl border border-brand-line/50 bg-brand-ink p-6">
            <h4 className="flex items-center gap-2 font-semibold text-brand-soft">
              <ShieldCheck size={16} className="text-brand-green" />
              Segurança e Privacidade
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-brand-muted">
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Seu token é criptografado com AES-GCM (criptografia de grau militar) antes de ser salvo no banco de dados.</li>
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Nenhum token ou segredo da Meta é exposto no seu navegador ou frontend.</li>
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Toda comunicação com a Graph API acontece exclusivamente através de Edge Functions isoladas.</li>
              <li className="flex gap-2"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" /> Usamos <code className="rounded bg-brand-surface px-1 py-0.5 text-brand-soft">appsecret_proof</code> em todas as chamadas para garantir que apenas nossos servidores autorizados consultem a Meta.</li>
            </ul>
          </div>

        </div>
      </div>
    </section>
  );
}
