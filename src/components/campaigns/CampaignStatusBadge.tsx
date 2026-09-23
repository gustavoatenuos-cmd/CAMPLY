export function StatusBadge({ active }: { active: boolean }) {
  return active
    ? <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Ativa</span>
    : <span className="shrink-0 rounded-full bg-slate-400/15 px-2 py-0.5 text-[10px] font-bold text-slate-300">Pausada</span>;
}
