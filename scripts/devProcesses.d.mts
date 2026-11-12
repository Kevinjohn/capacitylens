import type { ChildProcess } from 'node:child_process';

export function portInUse(port: number): Promise<boolean>;

export function terminateProcessTree(
  child: ChildProcess,
  options?: { graceMs?: number; forceMs?: number },
): Promise<void>;

/** Check the owned POSIX process group, or the root process on Windows. */
export function isProcessTreeRunning(child: ChildProcess): boolean;
