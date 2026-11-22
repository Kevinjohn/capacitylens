import { createHash } from 'node:crypto';
import app from '@adonisjs/core/services/app';
import capacitylens from '#config/capacitylens';

const maxLimit = 1_000_000;

export function readApiLimit(): number {
  const raw = capacitylens.rateLimit;
  if (raw === undefined || raw === '') return app.inProduction ? 300 : 0;
  if (!/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= maxLimit ? value : 0;
}

/** Hashes the client address, which follows the HTTP server's proxy trust in `config/app.ts`. */
export function requestClientKey(clientAddress: string): string {
  return createHash('sha256').update(clientAddress).digest('hex');
}
