import type { ChildProcess, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";

/**
 * Builds a child environment with color output disabled.
 */
export function nonColourEnvironment(
  extra?: Record<string, string | undefined>,
  parent?: Record<string, string | undefined>,
): Record<string, string | undefined>;

/**
 * Spawns pnpm with the supplied literal arguments and options.
 */
export function spawnPnpm(args: readonly string[], options?: SpawnOptions): ChildProcess;
/**
 * Synchronously spawns pnpm with the supplied literal arguments and options.
 */
export function spawnPnpmSync(args: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<Buffer>;

/**
 * Describes exit status and failure details from a synchronous child process.
 */
export interface SynchronousSpawnResult {
  status: number | null;
  error?: Error;
  signal?: string | null;
}

/**
 * Reports spawn or signal failures and returns the child exit status.
 */
export function reportSpawnFailureAndResolveExitStatus(
  label: string,
  result: SynchronousSpawnResult,
  report?: (message: string) => void,
): number;
