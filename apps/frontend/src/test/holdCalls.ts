import { act, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

// Holds each call until the test settles it, oldest first, so reads and writes can race on cue.
export function holdCalls<T>(): {
  calls: ((result: T) => void)[];
  settleNext(result: T): Promise<void>;
} {
  const calls: ((result: T) => void)[] = [];
  return {
    calls,
    async settleNext(result) {
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      const settle = calls.shift();
      await act(async () => {
        settle?.(result);
        await Promise.resolve();
      });
    },
  };
}
