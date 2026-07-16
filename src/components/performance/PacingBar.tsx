/**
 * Mini barra de progresso (80px × 4px) + valor colorido, usada onde quer que
 * o pacing de orçamento apareça (tabela detalhada, cards de cliente).
 * A largura representa a SEVERIDADE do desvio (0% = perfeito, 100% = desvio extremo).
 * Verde < 10%, âmbar 10–25%, vermelho > 25%.
 */
export function PacingBar({ pct }: { pct: number }) {
  const abs = Math.abs(pct);
  const barWidth = Math.min(abs * 3, 100); // escala: desvio de 33% = barra cheia
  const colorClass =
    abs > 25 ? 'bg-red-500'   :
    abs > 10 ? 'bg-amber-400' :
               'bg-green-500';
  const textClass =
    abs > 25 ? 'text-red-400'   :
    abs > 10 ? 'text-amber-400' :
               'text-green-400';

  return (
    <div>
      <div className="mb-1 h-1 w-[80px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <p className={`text-[10px] font-semibold ${textClass}`}>
        {pct > 0 ? '+' : ''}{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
      </p>
    </div>
  );
}
