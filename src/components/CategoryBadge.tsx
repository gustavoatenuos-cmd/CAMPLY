/**
 * CategoryBadge.tsx
 * Visual badge showing client category with icon and color.
 */
import React from 'react';
import type { ClientCategory } from '../types';
import { CLIENT_CATEGORY_LABELS } from '../types';

const CATEGORY_STYLES: Record<ClientCategory, { bg: string; text: string; icon: string }> = {
  ecommerce:       { bg: 'bg-emerald-500/15', text: 'text-emerald-400',  icon: '🛒' },
  lead_generation: { bg: 'bg-violet-500/15',  text: 'text-violet-400',   icon: '🎯' },
  local_business:  { bg: 'bg-amber-500/15',   text: 'text-amber-400',    icon: '📍' },
  saas:            { bg: 'bg-sky-500/15',      text: 'text-sky-400',      icon: '💻' },
  content:         { bg: 'bg-pink-500/15',     text: 'text-pink-400',     icon: '📱' },
  other:           { bg: 'bg-zinc-500/15',     text: 'text-zinc-400',     icon: '⚙️' },
};

interface CategoryBadgeProps {
  category: ClientCategory | undefined;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function CategoryBadge({ category, size = 'md', showLabel = true }: CategoryBadgeProps) {
  if (!category) return null;
  const style = CATEGORY_STYLES[category];
  const label = CLIENT_CATEGORY_LABELS[category];

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
