/**
 * ui/TrendArrow.tsx
 * Shows a trend arrow (up/down/neutral) with color based on whether increase is good or bad.
 */
import React from 'react';
import type { calcTrend } from '../../lib/meta/metricsSelector';

type TrendDirection = ReturnType<typeof calcTrend>;

interface TrendArrowProps {
  trend: TrendDirection;
  deltaPercent?: number;
  showDelta?: boolean;
  size?: 'sm' | 'md';
}

const TREND_CONFIG: Record<TrendDirection, { icon: string; color: string; label: string }> = {
  up_good:  { icon: '↑', color: 'text-emerald-400', label: 'Subindo (bom)' },
  up_bad:   { icon: '↑', color: 'text-rose-400',    label: 'Subindo (ruim)' },
  down_good:{ icon: '↓', color: 'text-emerald-400', label: 'Caindo (bom)' },
  down_bad: { icon: '↓', color: 'text-rose-400',    label: 'Caindo (ruim)' },
  neutral:  { icon: '→', color: 'text-zinc-400',    label: 'Estável' },
};

export function TrendArrow({ trend, deltaPercent, showDelta = true, size = 'sm' }: TrendArrowProps) {
  const config = TREND_CONFIG[trend];
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-semibold ${config.color} ${textSize}`}
      title={config.label}
    >
      <span>{config.icon}</span>
      {showDelta && deltaPercent !== undefined && (
        <span>{Math.abs(deltaPercent).toFixed(1)}%</span>
      )}
    </span>
  );
}
