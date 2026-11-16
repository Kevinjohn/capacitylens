/**
 * Maximum raw entry-bundle size in bytes.
 */
export const ENTRY_RAW_LIMIT_BYTES: number;
/**
 * Maximum gzip-compressed entry-bundle size in bytes.
 */
export const ENTRY_GZIP_LIMIT_BYTES: number;
/**
 * Entry-bundle raw-size limit in decimal kilobytes for Vite warnings.
 */
export const ENTRY_RAW_LIMIT_KB: number;

/**
 * Checks both entry-bundle limits.
 * @throws When either size exceeds its limit.
 */
export function assertEntryBundleWithinBudget(rawBytes: number, gzipBytes: number): void;
