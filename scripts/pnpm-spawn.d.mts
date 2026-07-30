import type { ChildProcess, SpawnOptions } from "node:child_process";

export function nonColourEnvironment(
  extra?: Record<string, string | undefined>,
  parent?: Record<string, string | undefined>,
): Record<string, string | undefined>;

export function spawnPnpm(args: readonly string[], options?: SpawnOptions): ChildProcess;

export interface SynchronousSpawnResult {
  status: number | null;
  error?: Error;
  signal?: string | null;
}

export function synchronousSpawnStatus(
  label: string,
  result: SynchronousSpawnResult,
  report?: (message: string) => void,
): number;
