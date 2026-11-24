import { fileURLToPath } from 'node:url';
import { gateCommands } from './gateCommands.mjs';
import { spawnSync } from 'node:child_process';
import { reportSpawnFailureAndResolveExitStatus } from '../shared/childProcess.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

function main() {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (extra.length)
      throw new Error('Expected app, backend, all, tooling or static with no extra arguments.');
    for (const args of gateCommands(mode)) {
      const label = `gate (${mode}): pnpm ${args.join(' ')}`;
      console.log(label);
      const env =
        args[0] === 'run' && args[1] === 'build'
          ? {
              ...process.env,
              NODE_ENV: 'production',
              CAPACITYLENS_PUBLIC_URL: 'https://127.0.0.1',
            }
          : process.env;
      const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit', env });
      const status = reportSpawnFailureAndResolveExitStatus(label, result);
      if (status !== 0) {
        process.exitCode = status;
        return;
      }
    }
  } catch (error) {
    // Surface orchestration failures separately from a check’s ordinary nonzero status.
    console.error(`gate failed: ${error.message}`);
    process.exitCode = 2;
  }
}

main();
