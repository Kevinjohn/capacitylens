import crossSpawn from "cross-spawn";

/** Build deterministic non-colour child output without inheriting contradictory controls. */
export function nonColourEnvironment(extra = {}, parent = process.env) {
  const env = { ...parent, ...extra };
  delete env.NO_COLOR;
  env.FORCE_COLOR = "0";
  return env;
}

/**
 * Spawn the repository package manager without exposing arguments to a platform shell.
 *
 * cross-spawn resolves Windows' `pnpm.cmd` shim while preserving each argument as one literal argv
 * element. Keep this policy in one helper so setup and long-running launchers do not drift onto
 * shell-dependent quoting behavior.
 */
export function spawnPnpm(args, options = {}) {
  return crossSpawn("pnpm", args, {
    ...options,
    shell: false,
  });
}

/** Distinguish a test failure from a runner that could not start or was terminated. */
export function synchronousSpawnStatus(label, result, report = console.error) {
  if (result.error) {
    report(`${label} could not start: ${result.error.message}`);
    return 2;
  }
  if (result.signal) {
    report(`${label} was terminated by ${result.signal}.`);
    return 2;
  }
  if (result.status === null || result.status === undefined) {
    report(`${label} ended without an exit status.`);
    return 2;
  }
  return result.status;
}
