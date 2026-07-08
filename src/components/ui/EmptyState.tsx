import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Ação opcional (ex.: botão de criar) exibida abaixo do texto. */
  action?: ReactNode;
  /** Compacto para áreas internas; padrão ocupa mais respiro. */
  compact?: boolean;
}

/**
 * Estado vazio padrão do design system V2.0: ícone em pastilha com glow
 * suave, título Sora e ação opcional. Substitui os placeholders improvisados
 * de borda tracejada espalhados pelas telas.
 */
export function EmptyState({ icon: Icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-brand-line/70 bg-brand-ink/30 text-center ${compact ? 'gap-2 p-6' : 'gap-3 p-10'}`}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-brand-green/20 bg-brand-green/10 text-brand-green shadow-[0_0_18px_rgba(0,229,153,0.12)]">
        <Icon size={22} />
      </div>
      <p className="font-black text-white">{title}</p>
      {description && <p className="max-w-md text-sm leading-6 text-brand-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
