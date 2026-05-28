const MILLION = 1_000_000;

export function formatMillionTokens(value: number) {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  return `${(safeValue / MILLION).toFixed(3)}M`;
}
