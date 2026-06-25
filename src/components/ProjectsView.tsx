import { Plus } from 'lucide-react';
import { formatDate, makeId, projectStatusLabels } from '../data/camplyStore';
import { CamplyData, ProjectStatus } from '../types';

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
          name,
          role: 'Definir papel',
          status: 'planning',
          progress: 0,
          dueDate: new Date().toISOString().slice(0, 10),
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
                <p className="mt-1 text-sm text-brand-muted">{project.role}</p>
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
                <p className="text-xs text-brand-muted">Prazo</p>
                <p className="mt-1 font-semibold text-white">{formatDate(project.dueDate)}</p>
              </div>
              <div className="rounded-lg bg-brand-surface p-3">
                <p className="text-xs text-brand-muted">Próxima ação</p>
                <p className="mt-1 text-sm font-medium text-white">{project.nextAction}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
