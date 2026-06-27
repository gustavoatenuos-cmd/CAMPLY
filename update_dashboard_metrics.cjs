const fs = require('fs');
let code = fs.readFileSync('src/components/TodayView.tsx', 'utf8');

// 1. Add variable declarations
code = code.replace(
  'let clientImpressions = 0;',
  'let clientImpressions = 0;\n            let clientConversations = 0;\n            let clientCheckouts = 0;\n            let clientPageViews = 0;'
);

// 2. Add accumulations
code = code.replace(
  'clientImpressions += (metrics.impressions || 0);',
  'clientImpressions += (metrics.impressions || 0);\n              clientConversations += (metrics.conversations || 0);\n              clientCheckouts += (metrics.checkouts || 0);\n              clientPageViews += (metrics.pageViews || 0);'
);

// 3. Replace the JSX grid
const oldGrid = `<div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Gasto</p>
                    <p className="font-bold text-white">{money(clientSpent)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Alcance / Impr.</p>
                    <p className="font-bold text-white">{clientImpressions.toLocaleString('pt-BR')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Resultados</p>
                    <p className="font-bold text-white">{clientResults.toLocaleString('pt-BR')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Vendas</p>
                    <p className="font-bold text-brand-green">{clientPurchases.toLocaleString('pt-BR')}</p>
                  </div>
                </div>`;

const newGrid = `<div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Gasto</p>
                    <p className="font-bold text-white">{money(clientSpent)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Alcance / Impr.</p>
                    <p className="font-bold text-white">{clientImpressions.toLocaleString('pt-BR')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Resultados</p>
                    <p className="font-bold text-white">{clientResults.toLocaleString('pt-BR')}</p>
                  </div>
                  
                  {clientConversations > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#25D366]">Conversas (WhatsApp)</p>
                      <p className="font-bold text-white">{clientConversations.toLocaleString('pt-BR')}</p>
                    </div>
                  )}

                  {(clientPurchases > 0 || clientCheckouts > 0 || clientPageViews > 0 || clientConversations === 0) && (
                    <>
                      {clientPageViews > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Visitas na Página</p>
                          <p className="font-bold text-white">{clientPageViews.toLocaleString('pt-BR')}</p>
                        </div>
                      )}
                      {clientCheckouts > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400">Finalização de Venda</p>
                          <p className="font-bold text-white">{clientCheckouts.toLocaleString('pt-BR')}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-green">Vendas</p>
                        <p className="font-bold text-brand-green">{clientPurchases.toLocaleString('pt-BR')}</p>
                      </div>
                    </>
                  )}
                </div>`;

code = code.replace(oldGrid, newGrid);

fs.writeFileSync('src/components/TodayView.tsx', code);
