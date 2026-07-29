import { spawn } from "node:child_process";

/** Build deterministic non-colour child output without inheriting contradictory controls. */
export function nonColourEnvironment(extra = {}, parent = process.env) {
  const env = { ...parent, ...extra };
  delete env.NO_COLOR;
  env.FORCE_COLOR = "0";
  return env;
}

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
