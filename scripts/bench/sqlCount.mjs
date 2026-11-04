import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { waitFor } from '../packagedServer.mjs';

/** The preload that counts SQL statements inside the benchmarked server. */
export const SQL_COUNTER_PRELOAD = fileURLToPath(new URL('./sqlCounter.cjs', import.meta.url));

/** Ask the server for its running SQL statement count; null when the counter is unavailable. */
export async function sqlCount(child, countFile) {
  rmSync(countFile, { force: true });
  child.processHandle.kill('SIGUSR2');
  try {
    return Number(
      await waitFor(
        'the SQL count',
        3000,
        () => existsSync(countFile) && readFileSync(countFile, 'utf8'),
        child,
      ),
    );
  } catch {
    return null;
  }
}
