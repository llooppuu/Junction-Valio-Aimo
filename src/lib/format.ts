const euro = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });

/** 1400 → "€1,400.00" */
export function formatEuro(value: number): string {
  return euro.format(value);
}

/** 0.934 → "93%" */
export function formatPercent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/** 0.142 → "+14.2%", 0 → "0%" */
export function formatChange(share: number): string {
  if (Math.abs(share) < 0.0005) return '0%';
  const sign = share > 0 ? '+' : '−';
  return `${sign}${Math.abs(share * 100).toFixed(1)}%`;
}

/** 2.375 → "2.38", 2 → "2" */
export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
