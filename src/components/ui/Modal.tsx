import { X } from 'lucide-react';
import { ReactNode } from 'react';

interface ModalProps {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, description, open, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-[min(48rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-brand-line bg-brand-ink shadow-brand sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-brand-line bg-brand-ink p-4 sm:p-5">
          <div>
            <h2 className="text-xl font-black text-white">{title}</h2>
            {description && <p className="mt-1 text-sm text-brand-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-brand-muted transition hover:bg-brand-surface hover:text-white" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
