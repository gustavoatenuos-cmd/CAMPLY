interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'default',
  loading = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmClass = tone === 'danger'
    ? 'bg-rose-400 text-brand-ink hover:bg-rose-300'
    : 'bg-brand-green text-brand-ink hover:bg-emerald-300';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-2xl border border-brand-line bg-brand-surface p-5 text-white shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-black">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-brand-muted">{description}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-brand-line px-4 py-2 text-sm font-bold text-brand-soft disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-sm font-black transition disabled:cursor-wait disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
