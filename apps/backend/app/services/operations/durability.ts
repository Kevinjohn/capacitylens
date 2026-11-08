import { closeSync, fsyncSync, openSync } from 'node:fs';

/** Persist a file or directory before the next installation archive step. */
export function syncPath(path: string): void {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
