import type { ChildProcess } from "node:child_process";

export function portInUse(port: number): Promise<boolean>;

export function terminateProcessTree(
  child: ChildProcess,
  options?: { graceMs?: number; forceMs?: number },
): Promise<void>;
