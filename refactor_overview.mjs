import fs from 'fs';
let code = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');

const operationalSection = `
export function OperationalDashboardSection({
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

const articleRegex = /<article className="glass-card rounded-2xl p-5">\s*<p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Operação de hoje<\/p>[\s\S]*?<\/article>/;
code = code.replace(articleRegex, '');

code = code.replace('className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]"', 'className="grid gap-6 xl:grid-cols-1"');

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

const replacementForEarlyReturns = `  const renderAnalytics = () => {
${earlyReturns.replace(/return \(/g, 'return (')}
    return (
      <>`;

code = code.replace(earlyReturns, replacementForEarlyReturns);

const mainReturnRegex = /  return \(\n    <motion\.section[\s\S]*?<div className="mx-auto max-w-\[1700px\] space-y-6">/;
const newMainReturn = `  return (
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
        {renderAnalytics()}`;

code = code.replace(mainReturnRegex, newMainReturn);

const endOfFileRegex = /        \)}\n      <\/div>\n\n      <ConfirmDialog[\s\S]*?<\/motion\.section>\n  \);\n}/;
const newEndOfFile = `        )}
      </>
    );
  };

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

code = code.replace(endOfFileRegex, newEndOfFile);

fs.writeFileSync('src/components/OverviewView.tsx', code);
