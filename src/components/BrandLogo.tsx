interface BrandLogoProps {
  compact?: boolean;
  inverted?: boolean;
}

export function BrandLogo({ compact = false, inverted = false }: BrandLogoProps) {
  const textColor = inverted ? 'text-white' : 'text-brand-ink';

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CamplyMark />
      {!compact ? (
        <div className="min-w-0">
          <div className={`truncate text-[17px] font-semibold tracking-[-0.03em] ${textColor}`}>
            CAMPLY
          </div>
          <div className="mt-0.5 text-[10px] font-medium tracking-wide text-brand-muted">
            Operação de mídia
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CamplyMark() {
  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-brand-line bg-[#151A1F]">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-5 w-5">
        <path
          d="M22.5 6.5a10.5 10.5 0 1 0 0 19"
          fill="none"
          stroke="#3CCF91"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M7 23c3-7 7-4.8 10-7 3-2.2 5-4.8 8-9"
          fill="none"
          stroke="#3CCF91"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M23.5 6.5h3v3" fill="none" stroke="#3CCF91" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
