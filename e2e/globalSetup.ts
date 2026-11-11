import { spawnPnpmSync } from '../scripts/pnpmSpawn.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Generate the localization modules once before any worker Vite starts. */
export default function globalSetup(): void {
  const result = spawnPnpmSync(['run', 'paraglide:compile'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Paraglide compilation failed (${result.status ?? result.signal}).`);
}
