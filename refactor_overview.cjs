const fs = require('fs');
let code = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');

// 1. Add OperationalDashboardSection at the top
const operationalSection = `
function OperationalDashboardSection({
  activeClients,
  activeCampaigns,
  openTasks,
  openProjects,
  activeAlerts,
  pendingReceivables,
  setActiveView
}: {
  activeClients: number;
  activeCampaigns: number;
  openTasks: number;
  openProjects: number;
  activeAlerts: number;
  pendingReceivables: number;
  setActiveView: (v: ViewId) => void;
}) {
  return (
    <article className="glass-card rounded-2xl p-5 mb-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Operação de hoje</p>
      <h2 className="mt-1 text-xl font-black text-white">Visibilidade rápida do sistema</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <QuickMetric icon={Users} label="Clientes ativos" value={activeClients} onClick={() => setActiveView('clients')} />
        <QuickMetric icon={Megaphone} label="Campanhas ativas" value={activeCampaigns} onClick={() => setActiveView('campaigns')} />
        <QuickMetric icon={CheckSquare2} label="Tarefas abertas" value={openTasks} onClick={() => setActiveView('today')} />
        <QuickMetric icon={BriefcaseBusiness} label="Projetos abertos" value={openProjects} onClick={() => setActiveView('projects')} />
        <QuickMetric icon={AlertTriangle} label="Alertas ativos" value={activeAlerts} onClick={() => setActiveView('intelligence')} />
        <QuickMetric icon={Banknote} label="A receber" value={formatCurrency(pendingReceivables)} onClick={() => setActiveView('mediaFinance')} />
      </div>
    </article>
  );
}

export function OverviewView({ data, updateData, setActiveView }: OverviewViewProps) {
`;

code = code.replace('export function OverviewView({ data, updateData, setActiveView }: OverviewViewProps) {', operationalSection);

// 2. Remove the old "Operação de hoje" article
const oldOperacao = `              <article className="glass-card rounded-2xl p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Operação de hoje</p>
                <h2 className="mt-1 text-xl font-black text-white">Visibilidade rápida do sistema</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <QuickMetric icon={Users} label="Clientes ativos" value={activeClients} onClick={() => setActiveView('clients')} />
                  <QuickMetric icon={Megaphone} label="Campanhas ativas" value={activeCampaigns} onClick={() => setActiveView('campaigns')} />
                  <QuickMetric icon={CheckSquare2} label="Tarefas abertas" value={openTasks} onClick={() => setActiveView('today')} />
                  <QuickMetric icon={BriefcaseBusiness} label="Projetos abertos" value={openProjects} onClick={() => setActiveView('projects')} />
                  <QuickMetric icon={AlertTriangle} label="Alertas ativos" value={activeAlerts} onClick={() => setActiveView('intelligence')} />
                  <QuickMetric icon={Banknote} label="A receber" value={formatCurrency(pendingReceivables)} onClick={() => setActiveView('mediaFinance')} />
                </div>
              </article>`;

// In the code it might be slightly different. Wait, let's use a regex to remove the second article.
code = code.replace(/<article className="glass-card rounded-2xl p-5">\s*<p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Operação de hoje<\/p>[\s\S]*?<\/article>/, '');

// Also change grid xl:grid-cols-[1.35fr_0.65fr] to xl:grid-cols-1 if we only have one article left in that grid
code = code.replace(/className="grid gap-6 xl:grid-cols-\[1\.35fr_0\.65fr\]"/, 'className="grid gap-6 xl:grid-cols-1"');


// 3. Move the analytics loading/error state into an AnalyticsDashboardSection wrapper.
// Actually, I will just wrap the return from line 496 to 717 with the Operational section inserted.
// Wait, the early returns are the issue. Let's extract the early returns into a `renderAnalyticsContent` function.
const earlyReturns = `  if (capabilitiesLoading || !capabilityState) {
    return (
      <div className="h-full overflow-y-auto bg-brand-ink">
        <div className="grid min-h-full place-items-center text-brand-muted p-6">
          <div className="text-center">
            <RefreshCw className="mx-auto animate-spin text-brand-green" size={26} />
            <p className="mt-3">Verificando o contrato analítico seguro...</p>
          </div>
        </div>
      </div>
    );
  }

  if (capabilityState.mode === 'compatibility') {
    return (
      <DashboardUnavailable
        message={compatibilityReasonMessage(capabilityState.reason)}
        retrying={capabilitiesLoading}
        onRetry={() => void loadCapabilities()}
      />
    );
  }

  if (error && clients.length === 0 && !loading) {
    return (
      <DashboardUnavailable
        message="A capacidade foi confirmada, mas o dashboard analítico ficou temporariamente indisponível."
        retrying={loading}
        onRetry={() => void loadDashboard()}
      />
    );
  }`;

const replacementForEarlyReturns = `
  const renderAnalytics = () => {
${earlyReturns.replace(/return \(/g, 'return (')}
    return (
      <>
`;

code = code.replace(earlyReturns, replacementForEarlyReturns);

// Replace the return of OverviewView with the main layout
const mainReturn = `  return (
    <motion.section 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-full overflow-y-auto bg-brand-ink px-4 py-5 sm:px-5 lg:px-8 lg:py-8"
    >
      <div className="mx-auto max-w-[1700px] space-y-6">
        <OperationalDashboardSection 
          activeClients={activeClients}
          activeCampaigns={activeCampaigns}
          openTasks={openTasks}
          openProjects={openProjects}
          activeAlerts={activeAlerts}
          pendingReceivables={pendingReceivables}
          setActiveView={setActiveView}
        />
        {renderAnalytics()}
      </div>
`;

code = code.replace(/  return \(\n    <motion\.section[\s\S]*?<div className="mx-auto max-w-\[1700px\] space-y-6">/, mainReturn);

// Now we have to close the renderAnalytics function and the main return.
// Around line 714, it was:
//       </div>
//
//       <ConfirmDialog
//         open={deactivatingClientId !== null}
// ...
//       />
//     </motion.section>
//   );
// }

// The old code had `<ConfirmDialog ... />` inside the section, outside the mx-auto div.
// The renderAnalytics() is returning a fragment. We need to close the fragment where the mx-auto div closes, and then return the rest.
// Wait, renderAnalytics shouldn't return `<ConfirmDialog>`. `<ConfirmDialog>` can stay in the main return.

const endOfFile = `        )}
      </>
    );
  };

  return (
    <motion.section 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-full overflow-y-auto bg-brand-ink px-4 py-5 sm:px-5 lg:px-8 lg:py-8"
    >
      <div className="mx-auto max-w-[1700px] space-y-6">
        <OperationalDashboardSection 
          activeClients={activeClients}
          activeCampaigns={activeCampaigns}
          openTasks={openTasks}
          openProjects={openProjects}
          activeAlerts={activeAlerts}
          pendingReceivables={pendingReceivables}
          setActiveView={setActiveView}
        />
        {renderAnalytics()}
      </div>

      <ConfirmDialog
        open={deactivatingClientId !== null}
        title="Desativar cliente?"
        description="Desativar este cliente remove ele da operação ativa e da sincronização em massa, mas mantém o histórico salvo."
        confirmLabel="Desativar cliente"
        tone="danger"
        onCancel={() => setDeactivatingClientId(null)}
        onConfirm={confirmDeactivateClient}
      />
    </motion.section>
  );
}
`;

// Let's just find `        )}` which was at the end of the `loading && clients.length === 0` ternary, followed by `</div>` and `<ConfirmDialog`.
// It's safer to just split by the exact closing sequence:
const oldEnd = `        )}
      </div>

      <ConfirmDialog
        open={deactivatingClientId !== null}
        title="Desativar cliente?"
        description="Desativar este cliente remove ele da operação ativa e da sincronização em massa, mas mantém o histórico salvo."
        confirmLabel="Desativar cliente"
        tone="danger"
        onCancel={() => setDeactivatingClientId(null)}
        onConfirm={confirmDeactivateClient}
      />
    </motion.section>
  );
}`;

code = code.replace(oldEnd, `        )}
      </>
    );
  };

  return (
    <motion.section 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-full overflow-y-auto bg-brand-ink px-4 py-5 sm:px-5 lg:px-8 lg:py-8"
    >
      <div className="mx-auto max-w-[1700px] space-y-6">
        <OperationalDashboardSection 
          activeClients={activeClients}
          activeCampaigns={activeCampaigns}
          openTasks={openTasks}
          openProjects={openProjects}
          activeAlerts={activeAlerts}
          pendingReceivables={pendingReceivables}
          setActiveView={setActiveView}
        />
        {renderAnalytics()}
      </div>

      <ConfirmDialog
        open={deactivatingClientId !== null}
        title="Desativar cliente?"
        description="Desativar este cliente remove ele da operação ativa e da sincronização em massa, mas mantém o histórico salvo."
        confirmLabel="Desativar cliente"
        tone="danger"
        onCancel={() => setDeactivatingClientId(null)}
        onConfirm={confirmDeactivateClient}
      />
    </motion.section>
  );
}`);

// Also fix the fact that we put a duplicate mainReturn earlier.
// I'll revert that earlier replace, and let the end handle it.
// Oh wait, in mainReturn replace I already added `OperationalDashboardSection` and `{renderAnalytics()}`. But that replaced the old `return (` up to `div mx-auto`! So I should remove that from the end!

fs.writeFileSync('src/components/OverviewView.tsx', code);
