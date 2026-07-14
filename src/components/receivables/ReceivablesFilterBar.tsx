import { ReceivablesFilter } from '../../data/receivablesForecast';

const FILTER_OPTIONS: Array<{ value: ReceivablesFilter; label: string }> = [
  { value: 'current', label: 'Este mês' },
  { value: 'next', label: 'Próximo mês' },
  { value: 'current_next', label: 'Este + próximo' },
  { value: 'overdue', label: 'Atrasados' },
  { value: 'all', label: 'Todos' },
];

interface ReceivablesFilterBarProps {
  value: ReceivablesFilter;
  onChange: (value: ReceivablesFilter) => void;
}

export function ReceivablesFilterBar({ value, onChange }: ReceivablesFilterBarProps) {
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
            value === option.value
              ? 'border-brand-green bg-brand-green/10 text-brand-green'
              : 'border-brand-line text-brand-soft hover:text-white'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
