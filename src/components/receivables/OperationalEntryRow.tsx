import { Pencil } from 'lucide-react';
import { formatDate, money } from '../../data/camplyStore';
import { ForecastStatus, OperationalEntry } from '../../data/receivablesForecast';
import { PaymentStatus } from '../../types';

interface OperationalEntryRowProps {
  entry: OperationalEntry;
  onStatusChange: (entry: OperationalEntry, status: PaymentStatus) => void;
  onAmountEdit: (entry: OperationalEntry, amount: number) => void;
  onTitleClick?: (clientId: string) => void;
}

export function OperationalEntryRow({ entry, onStatusChange, onAmountEdit, onTitleClick }: OperationalEntryRowProps) {
  return (
    <div className="grid gap-3 border-b border-brand-line p-4 text-sm last:border-b-0 xl:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr] xl:items-center">
      <div>
        <button
          onClick={() => entry.clientId && onTitleClick?.(entry.clientId)}
          className="text-left font-semibold text-white transition-colors hover:text-brand-green"
          title="Ver configuração do cliente"
        >
          {entry.title}
        </button>
        <p className="mt-1 text-xs text-brand-muted">{entry.description}</p>
      </div>
      <p className="text-brand-muted">{entry.projectName || 'Cliente direto'}</p>
      <div>
        <p className="text-brand-muted">Vence: {formatDate(entry.dueDate)}</p>
        {entry.paidAt && <p className="mt-1 text-xs font-semibold text-brand-green">Pago: {formatDate(entry.paidAt)}</p>}
      </div>
      <div className="group flex items-center gap-2">
        <p className="font-bold text-brand-green">{money(entry.amount)}</p>
        <button
          onClick={() => {
            const value = window.prompt(`Novo valor para ${entry.title}:`, entry.amount.toString());
            if (value === null) return;
            const parsed = parseFloat(value.replace(',', '.'));
            if (!isNaN(parsed) && parsed >= 0) onAmountEdit(entry, parsed);
          }}
          className="p-1 text-brand-muted opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          title="Editar valor faturado deste mês"
        >
          <Pencil size={14} />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <select
          value={entry.status}
          onChange={(event) => onStatusChange(entry, event.target.value as PaymentStatus)}
          className={statusSelectClass(entry.status)}
        >
          {entry.status === 'upcoming' && <option value="upcoming">Próximo mês</option>}
          <option value="pending">Pendente</option>
          <option value="overdue">Atrasado</option>
          <option value="paid">Pago</option>
        </select>
      </div>
    </div>
  );
}

function statusSelectClass(status: ForecastStatus) {
  const tone =
    status === 'paid' ? 'bg-brand-green/20 text-brand-green' :
    status === 'overdue' ? 'bg-red-500/20 text-red-500' :
    status === 'upcoming' ? 'bg-blue-500/20 text-blue-400' :
    'bg-amber-500/20 text-amber-500';
  return `rounded-md border border-brand-line px-2 py-1 text-xs font-bold outline-none ${tone}`;
}
