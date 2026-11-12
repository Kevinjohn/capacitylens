import { spawnPnpmSync } from '../scripts/pnpmSpawn.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Generate shared backend client and localization modules before any worker starts. */
export default function globalSetup(): void {
  const codegen = spawnPnpmSync(['--dir', 'apps/backend', 'codegen'], {
    cwd: root,
    stdio: 'inherit',
    // Code generation loads route configuration, which validates the app environment.
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'error',
      APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
      APP_URL: 'http://localhost',
      CAPACITYLENS_PUBLIC_URL: 'http://localhost',
      CAPACITYLENS_CREATE_ADMIN_ADMIN: '0',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
      CAPACITYLENS_E2E_WORKER_API: '0',
    },
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
