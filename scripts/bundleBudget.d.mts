export const ENTRY_RAW_LIMIT_BYTES: number;
export const ENTRY_GZIP_LIMIT_BYTES: number;
export const ENTRY_RAW_LIMIT_KB: number;

export function assertEntryBundleWithinBudget(rawBytes: number, gzipBytes: number): void;
