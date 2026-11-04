// Latency summaries for the benchmark report.

export const ms = (value) => value.toFixed(2);
function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarise(samples, bytes, statements) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1),
    bytes,
    statements,
  };
}
