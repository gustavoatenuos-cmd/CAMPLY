/**
 * CategoryBadge.tsx
 * Visual badge showing client category with icon and color.
 */
import React from 'react';
import type { ClientCategory } from '../types';
import { CLIENT_CATEGORY_LABELS } from '../types';

const CATEGORY_STYLES: Record<ClientCategory, { bg: string; text: string; icon: string }> = {
  ecommerce:        { bg: 'bg-emerald-500/15', text: 'text-emerald-400', icon: '🛒' },
  local_business:   { bg: 'bg-amber-500/15',   text: 'text-amber-400',   icon: '📍' },
  service_provider: { bg: 'bg-violet-500/15',  text: 'text-violet-400',  icon: '🛠️' },
  delivery:         { bg: 'bg-orange-500/15',  text: 'text-orange-400',  icon: '🛵' },
  infoproduct:      { bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-400', icon: '🎓' },
  saas:             { bg: 'bg-sky-500/15',     text: 'text-sky-400',     icon: '💻' },
  real_estate:      { bg: 'bg-teal-500/15',    text: 'text-teal-400',    icon: '🏠' },
  marketplace:      { bg: 'bg-indigo-500/15',  text: 'text-indigo-400',  icon: '🏬' },
  b2b:              { bg: 'bg-blue-500/15',    text: 'text-blue-400',    icon: '🤝' },
  wholesale:        { bg: 'bg-lime-500/15',    text: 'text-lime-400',    icon: '📦' },
  franchise:        { bg: 'bg-rose-500/15',    text: 'text-rose-400',    icon: '🏢' },
  events:           { bg: 'bg-cyan-500/15',    text: 'text-cyan-400',    icon: '🎫' },
  other:            { bg: 'bg-zinc-500/15',    text: 'text-zinc-400',    icon: '⚙️' },
};

interface CategoryBadgeProps {
  category: ClientCategory | undefined;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function CategoryBadge({ category, size = 'md', showLabel = true }: CategoryBadgeProps) {
  if (!category) return null;
  // Clientes salvos com uma categoria antiga/removida (ex: 'lead_generation',
  // 'content', de antes desta lista ser reorganizada) não têm mais entrada
  // aqui - cai no estilo neutro de 'other' em vez de quebrar o card.
  const style = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.other;
  const label = CLIENT_CATEGORY_LABELS[category] ?? category;

  const sizeClass = size === 'sm'
    ? 'px-2 py-0.5 text-xs gap-1'
    : 'px-2.5 py-1 text-xs gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${style.bg} ${style.text} ${sizeClass}`}
      title={label}
    >
      <span>{style.icon}</span>
      {showLabel && <span>{label}</span>}
    </span>
  );
}
