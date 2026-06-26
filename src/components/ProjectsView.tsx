import { ExternalLink, Plus, Save } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { createActivityLog, formatDate, makeId, money, normalizeMonthlyInvestment, projectStatusLabels } from '../data/camplyStore';
import { Modal } from './ui/Modal';
import { CamplyData, Project, ProjectStatus, ProjectType } from '../types';

interface ProjectsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function ProjectsView({ data, updateData }: ProjectsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProjectType, setSelectedProjectType] = useState<ProjectType | null>(null);
  const newProjectBillingType: Project['billingType'] = selectedProjectType === 'site' ? 'one_time' : 'recurring';
  const groupedClients = data.clients.filter((client) => client.projectId);
  const recurringRevenue = groupedClients
    .filter((client) => client.managementFeeType === 'recurring')
    .reduce((sum, client) => sum + client.monthlyFee, 0);
  const oneTimeRevenue = groupedClients
    .filter((client) => client.managementFeeType === 'one_time')
    .reduce((sum, client) => sum + client.monthlyFee, 0);

  const addProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    const project: Project = {
      id: makeId('project'),
      projectType: selectedProjectType ?? 'traffic',
      clientId: String(form.get('clientId') ?? ''),
      ownerName: String(form.get('ownerName') ?? ''),
      company: String(form.get('company') ?? ''),
      billingType: String(form.get('billingType') ?? 'recurring') as Project['billingType'],
      name,
      role: String(form.get('role') ?? ''),
      status: String(form.get('status') ?? 'active') as ProjectStatus,
      progress: newProjectBillingType === 'recurring' ? 0 : Number(form.get('progress') ?? 0),
      dueDate: newProjectBillingType === 'recurring' ? '' : String(form.get('dueDate') ?? new Date().toISOString().slice(0, 10)),
      amountCharged: newProjectBillingType === 'recurring' ? 0 : Number(form.get('amountCharged') ?? 0),
      amountReceived: newProjectBillingType === 'recurring' ? 0 : Number(form.get('amountReceived') ?? 0),
      deliveredUrl: String(form.get('deliveredUrl') ?? ''),
      visibility: String(form.get('visibility') ?? 'private') as Project['visibility'],
      nextAction: String(form.get('nextAction') ?? ''),
    };

    updateData((current) => ({
      ...current,
      projects: [project, ...current.projects],
      activityLogs: [
        createActivityLog({
          action: 'project_created',
          title: `Projeto criado: ${project.name}`,
          description: `${project.projectType === 'traffic' ? 'Projeto de tráfego recorrente' : 'Projeto de site pontual'} cadastrado para a operação.`,
          projectId: project.id,
          clientId: project.clientId,
          campaignId: '',
          receivableId: '',
          taskId: '',
        }),
        ...current.activityLogs,
      ],
    }));
    setModalOpen(false);
    setSelectedProjectType(null);
    event.currentTarget.reset();
  };

  const setStatus = (id: string, status: ProjectStatus) => {
    const project = data.projects.find((item) => item.id === id);
    updateData((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === id ? { ...project, status } : project)),
      activityLogs: project
        ? [
            createActivityLog({
              action: 'project_status_changed',
              title: `Status do projeto: ${project.name}`,
              description: `Projeto alterado para ${projectStatusLabels[status]}.`,
              projectId: project.id,
              clientId: project.clientId,
              campaignId: '',
              receivableId: '',
              taskId: '',
            }),
            ...current.activityLogs,
          ]
        : current.activityLogs,
    }));
  };

  const updateProjectDetails = (event: FormEvent<HTMLFormElement>, project: Project) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCharged = project.billingType === 'recurring' ? 0 : Number(form.get('amountCharged') ?? project.amountCharged);
    const amountReceived = project.billingType === 'recurring' ? 0 : Number(form.get('amountReceived') ?? project.amountReceived);
    const deliveredUrl = String(form.get('deliveredUrl') ?? project.deliveredUrl);
    updateData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === project.id ? { ...item, amountCharged, amountReceived, deliveredUrl } : item,
      ),
      activityLogs: [
        createActivityLog({
          action: 'project_updated',
          title: `Projeto atualizado: ${project.name}`,
          description: project.billingType === 'recurring'
            ? 'Link entregue ou dados complementares foram atualizados.'
            : `Valores atualizados: cobrado ${money(amountCharged)}, recebido ${money(amountReceived)}.`,
          projectId: project.id,
          clientId: project.clientId,
          campaignId: '',
          receivableId: '',
          taskId: '',
        }),
        ...current.activityLogs,
      ],
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-4 sm:p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Projetos</p>
          <h1 className="mt-1 text-2xl font-black text-white">Projetos e parcerias</h1>
        </div>
        <button onClick={() => setModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
          <Plus size={18} />
          Novo projeto
        </button>
      </div>

      <Modal
        title={selectedProjectType ? 'Novo projeto' : 'Escolha o modelo do projeto'}
        description={
          selectedProjectType
            ? selectedProjectType === 'traffic'
              ? 'Projeto de tráfego é recorrente e funciona como guarda-chuva para clientes vinculados.'
              : 'Projeto de site é pontual, com prazo, progresso e valor próprio.'
            : 'Selecione o tipo de projeto para o sistema montar a estrutura correta.'
        }
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedProjectType(null);
        }}
      >
        {!selectedProjectType ? (
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <button
              onClick={() => setSelectedProjectType('traffic')}
              className="rounded-2xl border border-brand-line bg-brand-surface p-5 text-left transition hover:border-brand-green"
            >
              <p className="text-lg font-black text-white">Projeto de tráfego</p>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted">
                Para operação recorrente, como SPX Assessoria. Os valores vêm dos clientes vinculados.
              </p>
              <p className="mt-4 text-sm font-bold text-brand-green">Recorrente • Sem prazo • Sem progresso</p>
            </button>
            <button
              onClick={() => setSelectedProjectType('site')}
              className="rounded-2xl border border-brand-line bg-brand-surface p-5 text-left transition hover:border-brand-green"
            >
              <p className="text-lg font-black text-white">Projeto de site</p>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted">
                Para entrega pontual, com valor fechado, prazo, progresso e link finalizado.
              </p>
              <p className="mt-4 text-sm font-bold text-brand-green">Pontual • Com prazo • Com progresso</p>
            </button>
          </div>
        ) : (
        <form onSubmit={addProject} className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do projeto" name="name" required />
            <Field label="Contratante / responsável" name="ownerName" placeholder="Ex: João" />
            <Field label="Empresa do projeto" name="company" placeholder="Ex: SPX" />
            <Field label="Papel / tipo de entrega" name="role" placeholder="Ex: landing page, funil, loja, automação" />
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Cliente principal / contratante</span>
              <select name="clientId" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Sem cliente</option>
                {data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <input type="hidden" name="billingType" value={newProjectBillingType} />
            <div className="rounded-lg border border-brand-line bg-brand-surface px-3 py-2">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Modelo do projeto</span>
              <p className="font-bold text-white">{selectedProjectType === 'traffic' ? 'Tráfego recorrente' : 'Site pontual'}</p>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Status</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="active">{projectStatusLabels.active}</option>
                <option value="planning">{projectStatusLabels.planning}</option>
                <option value="waiting">{projectStatusLabels.waiting}</option>
                <option value="done">{projectStatusLabels.done}</option>
              </select>
            </label>
            {newProjectBillingType === 'one_time' && (
              <>
                <Field label="Progresso (%)" name="progress" type="number" min="0" max="100" defaultValue="0" />
                <Field label="Prazo" name="dueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                <MoneyField label="Valor cobrado" name="amountCharged" />
                <MoneyField label="Valor recebido" name="amountReceived" />
              </>
            )}
            <Field label="Link finalizado" name="deliveredUrl" type="url" placeholder="https://..." />
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Visibilidade</span>
              <select name="visibility" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="private">Privado</option>
                <option value="portfolio">Portfólio</option>
                <option value="public">Público</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-brand-soft">Próxima ação</span>
            <textarea name="nextAction" rows={3} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" />
          </label>
          <div className="flex justify-end gap-3 border-t border-brand-line pt-5">
            <button type="button" onClick={() => setSelectedProjectType(null)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Voltar</button>
            <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink">Salvar projeto</button>
          </div>
        </form>
        )}
      </Modal>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Projetos ativos" value={data.projects.filter((project) => project.status !== 'done').length.toString()} />
        <Summary label="Clientes em projetos" value={groupedClients.length.toString()} />
        <Summary label="Recorrência dos clientes" value={`${money(recurringRevenue)}/mês`} highlight />
        <Summary label="Pontuais dos clientes" value={money(oneTimeRevenue)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {data.projects.map((project) => {
          const projectClients = data.clients.filter((client) => client.projectId === project.id);
          const recurringTotal = projectClients
            .filter((client) => client.managementFeeType === 'recurring')
            .reduce((sum, client) => sum + client.monthlyFee, 0);
          const oneTimeTotal = projectClients
            .filter((client) => client.managementFeeType === 'one_time')
            .reduce((sum, client) => sum + client.monthlyFee, 0);
          const monthlyMedia = projectClients.reduce((sum, client) => {
            const totalAds = client.adInvestmentMeta + client.adInvestmentGoogle + client.adInvestmentYoutube + client.adInvestmentTikTok;
            return sum + normalizeMonthlyInvestment(totalAds, client.adInvestmentPeriod);
          }, 0);
          const projectAmount = project.billingType === 'recurring' ? recurringTotal + oneTimeTotal : project.amountCharged;
          const projectReceived = project.billingType === 'recurring' ? 0 : project.amountReceived;
          const openAmount = project.billingType === 'recurring' ? recurringTotal : Math.max(0, projectAmount - projectReceived);

          return (
          <article key={project.id} className="rounded-xl border border-brand-line bg-brand-ink p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">{project.name}</h2>
                <p className="mt-1 text-sm text-brand-muted">
                  {project.company || 'Sem empresa'} • {project.ownerName || 'Sem responsável'} • {project.role}
                </p>
                <p className="mt-1 text-xs font-semibold text-brand-soft">
                  {project.projectType === 'traffic' ? 'Projeto de tráfego' : 'Projeto de site'}
                </p>
                <p className="mt-1 text-xs font-semibold text-brand-green">
                  {projectClients.length} cliente{projectClients.length === 1 ? '' : 's'} vinculado{projectClients.length === 1 ? '' : 's'}
                </p>
              </div>
              <select value={project.status} onChange={(event) => setStatus(project.id, event.target.value as ProjectStatus)} className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white">
                <option value="planning">{projectStatusLabels.planning}</option>
                <option value="active">{projectStatusLabels.active}</option>
                <option value="waiting">{projectStatusLabels.waiting}</option>
                <option value="done">{projectStatusLabels.done}</option>
              </select>
            </div>

            {project.billingType === 'one_time' && (
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-xs text-brand-muted">
                  <span>Progresso</span>
                  <span>{project.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-brand-surface2">
                  <div className="h-2 rounded-full bg-brand-green" style={{ width: `${project.progress}%` }} />
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Gestão recorrente dos clientes</p>
                <p className="mt-1 font-semibold text-brand-green">{money(recurringTotal)}/mês</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Serviços pontuais dos clientes</p>
                <p className="mt-1 font-semibold text-white">{money(oneTimeTotal)}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Mídia estimada mensal</p>
                <p className="mt-1 font-semibold text-white">{money(monthlyMedia)}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Modelo do projeto</p>
                <p className="mt-1 font-semibold text-white">{project.billingType === 'recurring' ? 'Trabalho recorrente' : 'Entrega pontual'}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">{project.billingType === 'recurring' ? 'Somatória do projeto' : 'Valor cobrado'}</p>
                <p className="mt-1 font-semibold text-white">{money(projectAmount)}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">{project.billingType === 'recurring' ? 'Recorrência mensal' : 'Em aberto'}</p>
                <p className="mt-1 font-semibold text-brand-green">{money(openAmount)}</p>
              </div>
              {project.billingType === 'one_time' && (
                <div className="rounded-lg bg-brand-surface p-3">
                  <p className="text-xs text-brand-muted">Prazo</p>
                  <p className="mt-1 font-semibold text-white">{project.dueDate ? formatDate(project.dueDate) : 'Sem prazo'}</p>
                </div>
              )}
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Próxima ação</p>
                <p className="mt-1 text-sm font-medium text-white">{project.nextAction}</p>
              </div>
            </div>

            <form onSubmit={(event) => updateProjectDetails(event, project)} className="mt-4 grid gap-3 rounded-xl border border-brand-line bg-brand-surface p-3 xl:grid-cols-[1fr_1fr_1.4fr_auto] xl:items-end">
              {project.billingType === 'one_time' ? (
                <>
                  <MoneyField label="Valor cobrado" name="amountCharged" defaultValue={project.amountCharged} />
                  <MoneyField label="Valor recebido" name="amountReceived" defaultValue={project.amountReceived} />
                </>
              ) : (
                <div className="rounded-lg border border-brand-line bg-brand-ink p-3 text-sm text-brand-muted xl:col-span-2">
                  Projeto recorrente: valores vêm automaticamente dos clientes vinculados.
                </div>
              )}
              <Field label="Link entregue" name="deliveredUrl" type="url" defaultValue={project.deliveredUrl} placeholder="https://..." />
              <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-sm font-semibold text-brand-soft hover:border-brand-green hover:text-white">
                <Save size={15} />
                Salvar
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              {project.deliveredUrl && (
                <a href={project.deliveredUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-3 py-2 text-sm font-bold text-brand-ink">
                  <ExternalLink size={15} />
                  Abrir projeto
                </a>
              )}
            </div>

            {project.deliveredUrl && (
              <div className="mt-4 overflow-hidden rounded-xl border border-brand-line bg-brand-surface">
                <div className="border-b border-brand-line px-3 py-2 text-xs text-brand-muted">
                  Preview do projeto entregue
                </div>
                <iframe
                  src={project.deliveredUrl}
                  title={`Preview de ${project.name}`}
                  className="h-56 w-full bg-brand-paper"
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            )}
          </article>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-brand-soft">{label}</span>
      <input name={name} className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green" {...props} />
    </label>
  );
}

function MoneyField({ label, name, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-brand-soft">{label}</span>
      <div className="flex rounded-lg border border-brand-line bg-brand-surface focus-within:border-brand-green">
        <span className="grid place-items-center border-r border-brand-line px-3 text-sm font-bold text-brand-green">R$</span>
        <input name={name} type="number" min="0" step="0.01" className="w-full bg-transparent px-3 py-2 text-white outline-none" {...props} />
      </div>
    </label>
  );
}

function Summary({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-ink p-5">
      <p className="text-sm text-brand-muted">{label}</p>
      <p className={`mt-3 text-2xl font-black ${highlight ? 'text-brand-green' : 'text-white'}`}>{value}</p>
    </div>
  );
}
