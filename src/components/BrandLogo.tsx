interface BrandLogoProps {
  compact?: boolean;
  inverted?: boolean;
}

export function BrandLogo({ compact = false, inverted = false }: BrandLogoProps) {
  const textColor = inverted ? 'text-white' : 'text-brand-ink';

  return (
    <div className="flex items-center gap-3">
      <CamplyMark />
      {!compact && (
        <div className="min-w-0">
          <div className={`text-xl font-black tracking-tight ${textColor}`}>
            Camp<span className="text-brand-green">l</span>y
          </div>
          <div className="text-[11px] tracking-[0.28em] text-brand-muted">
            Do <span className="font-bold text-brand-green">clique</span> ao cliente.
          </div>
        </div>
      )}
    </div>
  );
}

export function CamplyMark() {
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-paper shadow-brand">
      <svg viewBox="0 0 64 64" aria-hidden="true" className="h-10 w-10">
        <defs>
          <linearGradient id="camply-mark-gradient" x1="8" x2="56" y1="56" y2="8" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0F7A5A" />
            <stop offset="1" stopColor="#22C55E" />
          </linearGradient>
        </defs>
        <path
          d="M44.9 11.6A23.9 23.9 0 1 0 44.9 52"
          fill="none"
          stroke="url(#camply-mark-gradient)"
          strokeWidth="9"
          strokeLinecap="butt"
        />
        <path
          d="M10 49C18 30 28 36 35 31C42 26 47 20 53 11"
          fill="none"
          stroke="url(#camply-mark-gradient)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M51 11h9v9" fill="none" stroke="#22C55E" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="39" r="7" fill="#F3F4F6" stroke="#0F7A5A" strokeWidth="4.5" />
        <circle cx="33" cy="31" r="5.5" fill="#F3F4F6" stroke="#0F7A5A" strokeWidth="4" />
        <circle cx="45" cy="27" r="5" fill="#F3F4F6" stroke="#0F7A5A" strokeWidth="4" />
      </svg>
    </div>
  );
}
