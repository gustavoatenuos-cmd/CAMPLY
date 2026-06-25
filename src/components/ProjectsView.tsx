import { ExternalLink, Link, Plus } from 'lucide-react';
import { formatDate, makeId, money, projectStatusLabels } from '../data/camplyStore';
import { CamplyData, Project, ProjectStatus } from '../types';

interface ProjectsViewProps {
  data: CamplyData;
  updateData: (updater: (data: CamplyData) => CamplyData) => void;
}

export function ProjectsView({ data, updateData }: ProjectsViewProps) {
  const addProject = () => {
    const name = window.prompt('Nome do projeto');
    if (!name) return;
    updateData((current) => ({
      ...current,
      projects: [
        {
          id: makeId('project'),
          clientId: current.clients[0]?.id ?? '',
          name,
          role: 'Definir papel',
          status: 'planning',
          progress: 0,
          dueDate: new Date().toISOString().slice(0, 10),
          amountCharged: 0,
          amountReceived: 0,
          deliveredUrl: '',
          visibility: 'private',
          nextAction: 'Definir próxima ação.',
        },
        ...current.projects,
      ],
    }));
  };

  const setStatus = (id: string, status: ProjectStatus) => {
    updateData((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === id ? { ...project, status } : project)),
    }));
  };

  const setDeliveredUrl = (project: Project) => {
    const deliveredUrl = window.prompt('Link do projeto finalizado', project.deliveredUrl);
    if (deliveredUrl === null) return;
    updateData((current) => ({
      ...current,
      projects: current.projects.map((item) => (item.id === project.id ? { ...item, deliveredUrl } : item)),
    }));
  };

  const setProjectValues = (project: Project) => {
    const amountCharged = Number(window.prompt('Valor cobrado pelo projeto', String(project.amountCharged)));
    if (Number.isNaN(amountCharged)) return;
    const amountReceived = Number(window.prompt('Valor já recebido', String(project.amountReceived)));
    if (Number.isNaN(amountReceived)) return;
    updateData((current) => ({
      ...current,
      projects: current.projects.map((item) => (item.id === project.id ? { ...item, amountCharged, amountReceived } : item)),
    }));
  };

  return (
    <section className="h-full overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Projetos</p>
          <h1 className="mt-1 text-2xl font-black text-white">Projetos e parcerias</h1>
        </div>
        <button onClick={addProject} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-brand-ink">
          <Plus size={18} />
          Novo projeto
        </button>
      </div>

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

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setProjectValues(project)} className="rounded-lg border border-brand-line px-3 py-2 text-sm font-semibold text-brand-soft hover:border-brand-green hover:text-white">
                Atualizar valores
              </button>
              <button onClick={() => setDeliveredUrl(project)} className="inline-flex items-center gap-2 rounded-lg border border-brand-line px-3 py-2 text-sm font-semibold text-brand-soft hover:border-brand-green hover:text-white">
                <Link size={15} />
                Link entregue
              </button>
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
