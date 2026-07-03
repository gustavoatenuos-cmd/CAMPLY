/**
 * ui/AlertBadge.tsx
 * Visual severity badge for cost alerts.
 */
import React from 'react';
import type { CostAlertSeverity } from '../../types';

const SEVERITY_CONFIG: Record<CostAlertSeverity, { bg: string; text: string; border: string; label: string; dot: string }> = {
  critical: {
    bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-500/30',
    dot: 'bg-rose-400', label: 'Crítico',
  },
  warning: {
    bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30',
    dot: 'bg-amber-400', label: 'Atenção',
  },
  info: {
    bg: 'bg-sky-500/15', text: 'text-sky-300', border: 'border-sky-500/30',
    dot: 'bg-sky-400', label: 'Info',
  },
};

interface AlertBadgeProps {
  severity: CostAlertSeverity;
  label?: string;
  showDot?: boolean;
  size?: 'sm' | 'md';
}

export function AlertBadge({ severity, label, showDot = true, size = 'sm' }: AlertBadgeProps) {
  const cfg = SEVERITY_CONFIG[severity];
  const displayLabel = label ?? cfg.label;
  const textSize = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${cfg.bg} ${cfg.text} ${cfg.border} ${textSize}`}
    >
      {showDot && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot} ${severity === 'critical' ? 'animate-pulse' : ''}`}
        />
      )}
      {displayLabel}
    </span>
  );
}
