// Each `pnpm run dev:demo` invocation owns a fresh `demo-l<lane>-*` directory beneath the backend's
// `tmp/` directory, with `.demo.db` as its database basename. Cleanup removes it only after the
// owned process groups have exited.

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProcessTreeRunning } from '../../tooling/devProcesses.mjs';

/** Allocate fresh storage; a later invocation never deletes an earlier invocation's database. */
export async function createDisposableDemoStorage(
  lane,
  {
    backendDirectory = fileURLToPath(new URL('../../apps/backend/', import.meta.url)),
    platform = process.platform,
  } = {},
) {
  const parent = join(backendDirectory, 'tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, `demo-l${lane}-`));
  return {
    directory,
    databasePath: join(directory, '.demo.db'),
    async cleanup(children) {
      if (children.some((child) => isProcessTreeRunning(child))) return false;
      // Windows has no POSIX process group to verify after a launcher exits. Retain uncertain
      // storage rather than unlink a database that an orphaned descendant could still be using.
      if (platform === 'win32' && children.length > 0) return false;
      await rm(directory, { recursive: true, force: true });
      return true;
    },
  };
}
