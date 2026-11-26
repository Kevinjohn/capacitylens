import type { spawn } from 'node:child_process';
import { portInUse, terminateProcessTree } from '@capacitylens/tooling/devProcesses';

export const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForReadiness(
  child: ReturnType<typeof spawn>,
  url: string,
  flavour: string,
  output: () => string
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`The ${flavour} E2E server exited before readiness. ${output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (flavour !== 'auth' || output().includes('Auth E2E fixture ready')))
        return;
    } catch {
      await wait(100);
      continue;
    }
    await wait(100);
  }
  throw new Error(`The ${flavour} E2E server did not become ready. ${output()}`);
}

export async function waitForPortRelease(port: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await portInUse(port))) return true;
    await wait(100);
  }
  return false;
}

export function signalOwnedProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') {
      return;
    }
    throw error;
  }
}

export async function stop(child: ReturnType<typeof spawn>, port: number) {
  if (child.pid === undefined) return;
  if (child.exitCode === null && child.signalCode === null) {
    await terminateProcessTree(child, { graceMs: 5000, forceMs: 1000 });
  } else {
    signalOwnedProcessGroup(child, 'SIGTERM');
  }
  if (await waitForPortRelease(port)) return;
  signalOwnedProcessGroup(child, 'SIGKILL');
  await waitForPortRelease(port);
}
