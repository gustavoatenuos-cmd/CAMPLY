import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, subtitle, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl p-5 text-left transition hover:bg-white/[0.02]"
      >
        <div>
          <h2 className="text-base font-black text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-brand-muted">{subtitle}</p>}
        </div>
        {open
          ? <ChevronDown size={18} className="shrink-0 text-brand-muted" />
          : <ChevronRight size={18} className="shrink-0 text-brand-muted" />}
      </button>
      {open && <div className="border-t border-brand-line p-4 lg:p-5">{children}</div>}
    </section>
  );
}
