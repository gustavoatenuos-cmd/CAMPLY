import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface SearchableSelectProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  'data-testid'?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecione...',
  className = '',
  'data-testid': testId,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);
  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(!open)}
        className="flex h-full w-full items-center justify-between rounded-lg border border-brand-line bg-brand-ink px-3 py-2 text-left text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-green/50"
      >
        <span className="truncate pr-2">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={16} className="shrink-0 text-brand-soft" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-brand-line bg-brand-surface shadow-xl">
          <div className="sticky top-0 flex items-center border-b border-brand-line bg-brand-surface px-3 py-2">
            <Search size={14} className="mr-2 shrink-0 text-brand-soft" />
            <input
              type="text"
              autoFocus
              placeholder="Pesquisar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-white placeholder-brand-soft focus:outline-none"
            />
          </div>
          <div className="p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm ${
                    opt.value === value
                      ? 'bg-brand-green/20 text-brand-green'
                      : 'text-brand-soft hover:bg-brand-ink hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-brand-muted">Nenhum resultado</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
