interface SkeletonProps {
  /** Classes de dimensão/forma (ex.: "h-4 w-32", "h-24 w-full rounded-2xl"). */
  className?: string;
}

/** Bloco de carregamento com pulso suave, no tom das superfícies V2.0. */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`} />;
}

/** Conjunto pronto para listas de cards (3 blocos). */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3 rounded-2xl border border-brand-line/60 bg-brand-surface p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
