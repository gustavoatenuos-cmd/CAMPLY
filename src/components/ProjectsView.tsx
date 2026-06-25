import { ExternalLink, Plus, Save } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { formatDate, makeId, money, projectStatusLabels } from '../data/camplyStore';
import { Modal } from './ui/Modal';
import { CamplyData, Project, ProjectStatus } from '../types';

interface ProjectsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function ProjectsView({ data, updateData }: ProjectsViewProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const addProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    updateData((current) => ({
      ...current,
      projects: [
        {
          id: makeId('project'),
          clientId: String(form.get('clientId') ?? ''),
          name,
          role: String(form.get('role') ?? ''),
          status: String(form.get('status') ?? 'planning') as ProjectStatus,
          progress: Number(form.get('progress') ?? 0),
          dueDate: String(form.get('dueDate') ?? new Date().toISOString().slice(0, 10)),
          amountCharged: Number(form.get('amountCharged') ?? 0),
          amountReceived: Number(form.get('amountReceived') ?? 0),
          deliveredUrl: String(form.get('deliveredUrl') ?? ''),
          visibility: String(form.get('visibility') ?? 'private') as Project['visibility'],
          nextAction: String(form.get('nextAction') ?? ''),
        },
        ...current.projects,
      ],
    }));
    setModalOpen(false);
    event.currentTarget.reset();
  };

  const setStatus = (id: string, status: ProjectStatus) => {
    updateData((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === id ? { ...project, status } : project)),
    }));
  };

  const updateProjectDetails = (event: FormEvent<HTMLFormElement>, project: Project) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCharged = Number(form.get('amountCharged') ?? project.amountCharged);
    const amountReceived = Number(form.get('amountReceived') ?? project.amountReceived);
    const deliveredUrl = String(form.get('deliveredUrl') ?? project.deliveredUrl);
    updateData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === project.id ? { ...item, amountCharged, amountReceived, deliveredUrl } : item,
      ),
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
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

      <Modal title="Novo projeto" description="Cadastre entrega, cliente, valor cobrado, recebimento e link finalizado." open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={addProject} className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do projeto" name="name" required />
            <Field label="Papel / tipo de entrega" name="role" placeholder="Ex: landing page, funil, loja, automação" />
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Cliente vinculado</span>
              <select name="clientId" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="">Sem cliente</option>
                {data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-brand-soft">Status</span>
              <select name="status" className="w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-white outline-none focus:border-brand-green">
                <option value="planning">{projectStatusLabels.planning}</option>
                <option value="active">{projectStatusLabels.active}</option>
                <option value="waiting">{projectStatusLabels.waiting}</option>
                <option value="done">{projectStatusLabels.done}</option>
              </select>
            </label>
            <Field label="Progresso (%)" name="progress" type="number" min="0" max="100" defaultValue="0" />
            <Field label="Prazo" name="dueDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            <Field label="Valor cobrado" name="amountCharged" type="number" min="0" step="0.01" />
            <Field label="Valor recebido" name="amountReceived" type="number" min="0" step="0.01" />
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
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-brand-line px-4 py-2 font-semibold text-brand-soft">Cancelar</button>
            <button className="rounded-lg bg-brand-green px-4 py-2 font-bold text-brand-ink">Salvar projeto</button>
          </div>
        </form>
      </Modal>

      <div className="grid gap-5 lg:grid-cols-2">
        {data.projects.map((project) => (
          <article key={project.id} className="rounded-xl border border-brand-line bg-brand-ink p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">{project.name}</h2>
                <p className="mt-1 text-sm text-brand-muted">
                  {data.clients.find((client) => client.id === project.clientId)?.name ?? 'Sem cliente'} • {project.role}
                </p>
              </div>
              <select value={project.status} onChange={(event) => setStatus(project.id, event.target.value as ProjectStatus)} className="rounded-md border border-brand-line bg-brand-surface px-2 py-1 text-xs text-white">
                <option value="planning">{projectStatusLabels.planning}</option>
                <option value="active">{projectStatusLabels.active}</option>
                <option value="waiting">{projectStatusLabels.waiting}</option>
                <option value="done">{projectStatusLabels.done}</option>
              </select>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs text-brand-muted">
                <span>Progresso</span>
                <span>{project.progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-brand-surface2">
                <div className="h-2 rounded-full bg-brand-green" style={{ width: `${project.progress}%` }} />
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Valor cobrado</p>
                <p className="mt-1 font-semibold text-white">{money(project.amountCharged)}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Em aberto</p>
                <p className="mt-1 font-semibold text-brand-green">{money(Math.max(0, project.amountCharged - project.amountReceived))}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Prazo</p>
                <p className="mt-1 font-semibold text-white">{formatDate(project.dueDate)}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Próxima ação</p>
                <p className="mt-1 text-sm font-medium text-white">{project.nextAction}</p>
              </div>
            </div>

            <form onSubmit={(event) => updateProjectDetails(event, project)} className="mt-4 grid gap-3 rounded-xl border border-brand-line bg-brand-surface p-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
              <Field label="Valor cobrado" name="amountCharged" type="number" min="0" step="0.01" defaultValue={project.amountCharged} />
              <Field label="Valor recebido" name="amountReceived" type="number" min="0" step="0.01" defaultValue={project.amountReceived} />
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
        ))}
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
