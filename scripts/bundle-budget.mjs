// The entry limit is a blowup detector, not a creep ratchet. It is intentionally far above the
// measured ~744 kB raw / ~225 kB gzip entry so ordinary feature work does not churn the threshold,
// while still catching a barrel import or dependency mistake that adds hundreds of kilobytes.
export const ENTRY_RAW_LIMIT_BYTES = 3_200_000;
export const ENTRY_GZIP_LIMIT_BYTES = 1_000_000;

// Vite compares chunkSizeWarningLimit against uncompressed decimal kilobytes. Keep its generic
// warning on the same raw boundary as the authoritative entry check so one build has one policy.
export const ENTRY_RAW_LIMIT_KB = ENTRY_RAW_LIMIT_BYTES / 1_000;

export function assertEntryBundleWithinBudget(rawBytes, gzipBytes) {
  if (rawBytes <= ENTRY_RAW_LIMIT_BYTES && gzipBytes <= ENTRY_GZIP_LIMIT_BYTES) return;
  throw new Error(
    `Bundle budget exceeded (limits: ${ENTRY_RAW_LIMIT_BYTES} raw / ${ENTRY_GZIP_LIMIT_BYTES} gzip; actual: ${rawBytes} raw / ${gzipBytes} gzip).`,
  );
}
