import type { ChildProcess, SpawnOptions } from "node:child_process";

export function spawnPnpm(args: readonly string[], options?: SpawnOptions): ChildProcess;
