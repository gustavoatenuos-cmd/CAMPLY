import { motion } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';

export function SyncErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      role="alert"
      className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-rose-500/40 bg-brand-surface2/90 p-4 shadow-glass backdrop-blur-md"
    >
      <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
      <p className="flex-1 text-sm leading-5 text-rose-200">{message}</p>
      <button
        type="button"
        aria-label="Fechar notificação"
        onClick={onDismiss}
        className="shrink-0 rounded-lg p-1 text-rose-300/60 transition hover:bg-white/[0.06] hover:text-rose-200"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
