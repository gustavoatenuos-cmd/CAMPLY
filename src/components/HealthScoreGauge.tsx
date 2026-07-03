/**
 * HealthScoreGauge.tsx
 * Circular gauge showing campaign health score 0-100.
 */
import React from 'react';

interface HealthScoreGaugeProps {
  score: number; // 0-100
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function getScoreConfig(score: number) {
  if (score >= 80) return {
    color: '#34d399',     // emerald-400
    glow: 'drop-shadow(0 0 8px rgba(52,211,153,0.5))',
    label: 'Saudável',
    textColor: 'text-emerald-400',
  };
  if (score >= 50) return {
    color: '#fbbf24',     // amber-400
    glow: 'drop-shadow(0 0 8px rgba(251,191,36,0.5))',
    label: 'Atenção',
    textColor: 'text-amber-400',
  };
  return {
    color: '#f87171',     // rose-400
    glow: 'drop-shadow(0 0 8px rgba(248,113,113,0.5))',
    label: 'Crítico',
    textColor: 'text-rose-400',
  };
}

const SIZE_CONFIG = {
  sm:  { size: 64,  stroke: 5,  scoreText: 'text-sm',  labelText: 'text-[9px]' },
  md:  { size: 96,  stroke: 6,  scoreText: 'text-lg',  labelText: 'text-[10px]' },
  lg:  { size: 128, stroke: 8,  scoreText: 'text-2xl', labelText: 'text-xs' },
};

export function HealthScoreGauge({ score, size = 'md', showLabel = true }: HealthScoreGaugeProps) {
  const cfg = getScoreConfig(score);
  const dim = SIZE_CONFIG[size];
  const clampedScore = Math.max(0, Math.min(100, score));

  const center = dim.size / 2;
  const radius = center - dim.stroke - 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clampedScore / 100);

  return (
    <div className="relative inline-flex flex-col items-center gap-1">
      <svg
        width={dim.size}
        height={dim.size}
        viewBox={`0 0 ${dim.size} ${dim.size}`}
        style={{ filter: cfg.glow, transform: 'rotate(-90deg)' }}
      >
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={dim.stroke}
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={cfg.color}
          strokeWidth={dim.stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      {/* Score text overlay */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ transform: 'rotate(0deg)' }}
      >
        <span className={`font-bold tabular-nums ${cfg.textColor} ${dim.scoreText}`}>
          {clampedScore}
        </span>
        {showLabel && (
          <span className={`font-medium text-zinc-400 ${dim.labelText}`}>{cfg.label}</span>
        )}
      </div>
    </div>
  );
}
