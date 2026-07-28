import { spawn } from "node:child_process";

/**
 * Spawn the repository package manager through the platform shell.
 *
 * pnpm is installed as a `.cmd` shim on Windows, which `child_process.spawn` cannot resolve there
 * without shell execution. Keep this policy in one helper so setup and long-running launchers do
 * not drift onto different platform behavior.
 */
export function spawnPnpm(args, options = {}) {
  return spawn("pnpm", args, {
    ...options,
    shell: true,
  });
}
