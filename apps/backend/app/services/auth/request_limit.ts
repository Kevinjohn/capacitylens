import { createHash } from 'node:crypto';

const maxLimit = 1_000_000;

/** The configured requests a minute, `raw`, or the default when unset; 0 turns the limit off. */
export function readApiLimit(raw: string | undefined, inProduction: boolean): number {
  if (raw === undefined || raw === '') return inProduction ? 300 : 0;
  if (!/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= maxLimit ? value : 0;
}

/** Hashes the client address, which follows the HTTP server's proxy trust in `config/app.ts`. */
export function requestClientKey(clientAddress: string): string {
  return createHash('sha256').update(clientAddress).digest('hex');
}
