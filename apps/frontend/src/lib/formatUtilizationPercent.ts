/**
 * Format utilisation without rounding a value across the product's strict 100% boundary.
 * One decimal is enough near capacity; ordinary values retain the compact whole-percent display.
 */
export function formatUtilizationPercent(ratio: number): string {
  const percent = ratio * 100;
  if (percent > 99 && percent < 100) return (Math.floor(percent * 10) / 10).toFixed(1);
  if (percent > 100 && percent < 101) return (Math.ceil(percent * 10) / 10).toFixed(1);
  return String(Math.round(percent));
}
