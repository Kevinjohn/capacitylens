import { spawnPnpmSync } from '../scripts/pnpmSpawn.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Generate the localization modules once before any worker Vite starts. */
export default function globalSetup(): void {
  const codegen = spawnPnpmSync(['--dir', 'apps/backend', 'codegen'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (codegen.error) throw codegen.error;
  if (codegen.status !== 0)
    throw new Error(`Backend code generation failed (${codegen.status ?? codegen.signal}).`);

  const result = spawnPnpmSync(['run', 'paraglide:compile'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Paraglide compilation failed (${result.status ?? result.signal}).`);
}
